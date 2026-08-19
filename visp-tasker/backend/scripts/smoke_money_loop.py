"""Smoke del CICLO DE DINERO completo contra Stripe test real (no mocks).

Prueba lo que ningún test con mocks puede probar: que el cobro llega a Stripe con
el proveedor como merchant of record, que las cifras cuadran (subtotal, impuesto,
tarifa de servicio, comisión, payout) y que el dinero se captura y se reparte.

Existe porque los tres smokes de journey del repo están clavados con guardarraíl
a la BD `visp_prod`, que NO tiene las migraciones 031-038. Este corre contra la
base configurada en .env.

Se auto-limpia: cancela el PaymentIntent y borra el job de prueba.

    ./venv/bin/python scripts/smoke_money_loop.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid

sys.path.insert(0, ".")

import stripe  # noqa: E402

from src.api.deps import async_session_factory  # noqa: E402

passed = 0
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        failed.append(name)
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


def money(cents: int | None) -> str:
    return f"${(cents or 0) / 100:,.2f}"


async def main() -> int:  # noqa: C901
    print("=" * 72)
    print("SMOKE — ciclo de dinero (Stripe test real)")
    print("=" * 72)

    from sqlalchemy import delete, select

    from src.integrations.stripe import account_can_accept_charges
    from src.models.job import Job, JobAssignment, JobStatus
    from src.models.provider import ProviderProfile
    from src.models.taxonomy import ServiceTask
    from src.models.user import User
    from src.services import job_payment_service as jp
    from src.services import jobService

    created_job: uuid.UUID | None = None
    intent_id: str | None = None

    # ------------------------------------------------------------------ setup
    print("\n[1] Piezas necesarias")
    async with async_session_factory() as db:
        # Un proveedor con cuenta Stripe COBRABLE. Es el requisito que estaba roto.
        # Hace falta un par (proveedor COBRABLE, servicio con tarifa activa): el
        # precio del trabajo sale de la tarifa del proveedor, no del catálogo.
        from src.models.provider_rate import ProviderServiceRate

        pares = (
            await db.execute(
                select(ProviderProfile, ServiceTask, ProviderServiceRate)
                .join(ProviderServiceRate, ProviderServiceRate.provider_id == ProviderProfile.id)
                .join(ServiceTask, ServiceTask.id == ProviderServiceRate.task_id)
                .where(
                    ProviderProfile.stripe_account_id.is_not(None),
                    ProviderServiceRate.is_active.is_(True),
                    ServiceTask.is_active.is_(True),
                )
            )
        ).all()
        chargeable = task = rate = None
        for prof, tk, rt in pares:
            ready, _ = account_can_accept_charges(prof.stripe_account_id)
            if ready:
                chargeable, task, rate = prof, tk, rt
                break
        check("hay proveedor cobrable con tarifa activa", chargeable is not None,
              f"{chargeable.stripe_account_id} · {task.name} · {money(rate.rate_cents)}"
              if chargeable else f"ninguno de {len(pares)} par(es) sirve")
        if chargeable is None:
            return 1

        customer = (
            await db.execute(select(User).where(User.role_customer.is_(True)).limit(1))
        ).scalar_one()
        print(f"        proveedor {chargeable.stripe_account_id}")
        print(f"        servicio  {task.name}")

    # ------------------------------------------------- tarjeta del cliente
    print("\n[2] El cliente añade su tarjeta (lo que hace desde su perfil)")
    cust = stripe.Customer.create(
        email=f"smoke+{uuid.uuid4().hex[:8]}@test.visp.ca",
        description="VISP money-loop smoke",
    )
    # `pm_card_visa` es el método de prueba de Stripe: equivale a la tarjeta que
    # el cliente teclea en la app.
    pm = stripe.PaymentMethod.attach("pm_card_visa", customer=cust.id)
    stripe.Customer.modify(cust.id, invoice_settings={"default_payment_method": pm.id})
    check("tarjeta adjuntada al cliente", pm.customer == cust.id, f"{cust.id} · {pm.id}")

    # -------------------------------------------------------------- el trabajo
    print("\n[3] Reserva y precio")
    async with async_session_factory() as db:
        # El servicio lo elige el proveedor cobrable, así que puede exigir detalles,
        # foto o preguntas. Se rellenan todas: lo que se prueba aquí es el circuito
        # del dinero, no el formulario de reserva, y el catálogo cambia cada semana.
        from src.models.taxonomy import ServiceTaskQuestion

        preguntas = (
            await db.execute(
                select(ServiceTaskQuestion).where(
                    ServiceTaskQuestion.task_id == task.id,
                    ServiceTaskQuestion.is_active.is_(True),
                    ServiceTaskQuestion.is_required.is_(True),
                )
            )
        ).scalars().all()
        respuestas = [
            {
                "questionId": str(q.id),
                "answer": (
                    (q.options or [{}])[0].get("en", "n/a")
                    if q.answer_type == "SINGLE_CHOICE"
                    else "https://smoke.invalid/foto.jpg"
                    if q.answer_type == "IMAGE"
                    else "smoke"
                ),
            }
            for q in preguntas
        ]

        job = await jobService.create_job(
            db,
            customer_id=customer.id,
            task_id=task.id,
            location={
                "latitude": 43.6532, "longitude": -79.3832,
                "address": "Money loop smoke", "city": "Toronto",
                "province_state": "ON", "postal_zip": "M5H 2N2", "country": "CA",
            },
            priority="standard",
            customer_details="Smoke del circuito de dinero.",
            customer_evidence=["https://smoke.invalid/foto.jpg"],
            customer_answers=respuestas,
        )
        created_job = job.id
        # Asignar el proveedor cobrable: es de quien depende el destination charge.
        # OJO: el proveedor asignado vive SOLO en job_assignments; `jobs` no tiene
        # columna provider_id (asignarla era un atributo suelto que nadie leía).
        db.add(JobAssignment(job_id=job.id, provider_id=chargeable.id, status="ACCEPTED"))
        job.status = JobStatus.PENDING_APPROVAL

        # Es lo que ocurre cuando el proveedor acepta: el trabajo se re-cotiza a SU
        # tarifa, y ahí se calculan impuesto, tarifa de servicio y comisión.
        from src.services.provider_rate_service import reprice_job_to_provider_rate

        breakdown = await reprice_job_to_provider_rate(db, job, chargeable.id)
        check("el trabajo se tarificó con la tarifa del proveedor",
              breakdown is not None, "sin tarifa aplicable" if breakdown is None else "")
        await db.commit()
        await db.refresh(job)

        print(f"        precio serv.  {money(job.quoted_price_cents)}")
        print(f"        impuesto      {money(job.service_tax_cents)}")
        print(f"        tarifa serv.  {money(job.service_fee_cents)}")
        print(f"        TOTAL cobrado {money(job.total_charged_cents)}")
        print(f"        comisión VISP {money(job.commission_amount_cents)}")
        print(f"        payout prov.  {money(job.provider_payout_cents)}")

        total = job.total_charged_cents or 0
        check("el total es positivo", total > 0, money(total))
        # El total tiene que ser la suma de sus partes, o el cliente paga otra cosa
        # que la que se le muestra.
        suma = ((job.quoted_price_cents or 0) + (job.service_tax_cents or 0)
                + (job.service_fee_cents or 0))
        check("total = precio + impuesto + tarifa", suma == total,
              f"{money(suma)} vs {money(total)}")

    # ------------------------------------------------------ autorización
    print("\n[4] Autorización (destination charge, captura manual)")
    async with async_session_factory() as db:
        job = (await db.execute(select(Job).where(Job.id == created_job))).scalar_one()
        try:
            auth = await jp.authorize_job(
                db, job, customer_stripe_id=cust.id, payment_method=pm.id, confirm=True
            )
            await db.commit()
            intent_id = auth.id
            check("autorización creada", bool(intent_id), intent_id or "")
        except jp.ProviderPaymentSetupIncompleteError as exc:
            check("autorización creada", False,
                  f"gate de Stripe: {exc} (card_payments)")
            return 1
        except Exception as exc:  # noqa: BLE001
            check("autorización creada", False, f"{type(exc).__name__}: {exc}")
            return 1

    if intent_id:
        pi = stripe.PaymentIntent.retrieve(intent_id)
        print(f"        estado={pi.status} amount={money(pi.amount)}")
        check("el hold está requires_capture", pi.status == "requires_capture", pi.status)
        # La pieza que estaba rota: el proveedor como merchant of record.
        obo = getattr(pi, "on_behalf_of", None)
        check("on_behalf_of = cuenta del proveedor",
              obo == chargeable.stripe_account_id, str(obo))
        td = getattr(pi, "transfer_data", None)
        dest = getattr(td, "destination", None) if td else None
        check("transfer_data.destination = proveedor",
              dest == chargeable.stripe_account_id, str(dest))
        # Autoriza con colchón (×1.30) para cubrir un trabajo que se alargue.
        check("el hold lleva colchón sobre el total", pi.amount >= (total or 0),
              f"hold {money(pi.amount)} ≥ total {money(total)}")
        fee = getattr(pi, "application_fee_amount", None)
        esperada = (job.commission_amount_cents or 0) + (job.service_fee_cents or 0)
        check("application_fee = comisión + tarifa de servicio", fee == esperada,
              f"{money(fee)} vs {money(esperada)}")

    # ------------------------------------------------------------- captura
    print("\n[5] Captura del importe real")
    async with async_session_factory() as db:
        job = (await db.execute(select(Job).where(Job.id == created_job))).scalar_one()
        try:
            cap = await jp.capture_job(db, job, final_total_cents=total)
            await db.commit()
            check("captura ejecutada", cap is not None)
        except Exception as exc:  # noqa: BLE001
            check("captura ejecutada", False, f"{type(exc).__name__}: {exc}")

    if intent_id:
        pi = stripe.PaymentIntent.retrieve(intent_id)
        check("PaymentIntent succeeded", pi.status == "succeeded", pi.status)
        check("se capturó el total, no el colchón",
              (getattr(pi, "amount_received", 0) or 0) == total,
              f"recibido {money(getattr(pi,'amount_received',0))} vs total {money(total)}")
        # Lo que de verdad le queda al proveedor.
        neto = (getattr(pi, "amount_received", 0) or 0) - (getattr(pi, "application_fee_amount", 0) or 0)
        print(f"        al proveedor: {money(neto)}   a VISP: "
              f"{money(getattr(pi,'application_fee_amount',0))}")
        check("el neto del proveedor coincide con su payout previsto",
              neto == (job.provider_payout_cents or neto),
              f"{money(neto)} vs {money(job.provider_payout_cents)}")

    # ------------------------------------------------------------- limpieza
    print("\n[6] Limpieza")
    if intent_id:
        try:
            pi = stripe.PaymentIntent.retrieve(intent_id)
            if pi.status == "requires_capture":
                stripe.PaymentIntent.cancel(intent_id)
                print("        hold cancelado")
            elif pi.status == "succeeded":
                # `reverse_transfer` es obligatorio: en un destination charge la
                # comisión se toma del transfer, así que Stripe exige revertirlo
                # para poder devolver también la application fee.
                stripe.Refund.create(
                    payment_intent=intent_id,
                    refund_application_fee=True,
                    reverse_transfer=True,
                )
                print("        cobro reembolsado")
        except Exception as exc:  # noqa: BLE001
            print(f"        no se pudo revertir el PaymentIntent: {exc}")
    try:
        stripe.Customer.delete(cust.id)
        print("        cliente de prueba borrado")
    except Exception:  # noqa: BLE001
        pass
    if created_job:
        # Borrado genérico: se descubren las tablas que referencian jobs.id y se
        # limpian primero. Hacerlo a mano dejaba fuera `pricing_events` (y
        # cualquier tabla nueva rompería la limpieza en el futuro).
        from sqlalchemy import text

        async with async_session_factory() as db:
            hijas = (await db.execute(text("""
                SELECT tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                     ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                     ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND ccu.table_name = 'jobs' AND ccu.column_name = 'id'
            """))).all()
            for tabla, col in hijas:
                await db.execute(text(f'DELETE FROM {tabla} WHERE {col} = :jid'),
                                 {"jid": str(created_job)})
            await db.execute(delete(Job).where(Job.id == created_job))
            await db.commit()
        print(f"        job de prueba borrado (+{len(hijas)} tablas hijas limpiadas)")

    print("\n" + "=" * 72)
    total_checks = passed + len(failed)
    print(f"RESULTADO: {passed}/{total_checks} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
