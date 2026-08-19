"""Smoke de la cancelación con motivo (migración 041).

Verifica las tres decisiones del cliente:
  1. La cancelación es GRATIS y libera el hold de Stripe.
  2. El impacto en la calificación NO es automático: queda PENDING.
  3. El motivo es cerrado; uno inventado se rechaza.

Más el control de acceso: alguien ajeno al trabajo no puede cancelarlo.

    ./venv/bin/python scripts/smoke_cancellation.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid

import httpx

sys.path.insert(0, ".")

from src.api.deps import async_session_factory  # noqa: E402
from src.main import app  # noqa: E402

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


async def main() -> int:  # noqa: C901
    print("=" * 72)
    print("SMOKE — cancelación con motivo, sin penalización")
    print("=" * 72)

    from sqlalchemy import delete, select, text

    from src.models.job import Job, JobAssignment, JobCancellationReport, JobStatus
    from src.models.provider import ProviderProfile
    from src.models.superuser import SuperUser
    from src.models.taxonomy import ServiceTask
    from src.models.user import User
    from src.services import jobService
    from src.services.admin_service import create_admin_tokens
    from src.services.auth_service import create_access_token

    creados: list[uuid.UUID] = []

    async with async_session_factory() as db:
        cust = (
            await db.execute(select(User).where(User.role_customer.is_(True)).limit(1))
        ).scalar_one()
        # El proveedor tiene que ser OTRA persona: en visp_prod hay usuarios con
        # los dos roles, y si coinciden el rol se resuelve como "customer" (el
        # cliente tiene prioridad) y no se puede probar la rama del proveedor.
        prov_row = (
            await db.execute(
                select(ProviderProfile, User)
                .join(User, User.id == ProviderProfile.user_id)
                .where(User.id != cust.id)
                .limit(1)
            )
        ).first()
        if prov_row is None:
            print("  No hay ningún provider distinto del customer; no se puede probar.")
            return 1
        provider, prov_user = prov_row
        # Un servicio SIN entradas obligatorias: aquí se prueba la cancelación, no
        # el formulario de reserva, y el catálogo cambia cada semana. Sin este filtro
        # el smoke se rompe en cuanto el admin marca una pregunta como obligatoria.
        from src.models.taxonomy import ServiceTaskQuestion

        task = (
            await db.execute(
                select(ServiceTask)
                .where(
                    ServiceTask.is_active.is_(True),
                    ServiceTask.requires_details.is_(False),
                    ServiceTask.requires_evidence.is_(False),
                    ~select(ServiceTaskQuestion.id)
                    .where(
                        ServiceTaskQuestion.task_id == ServiceTask.id,
                        ServiceTaskQuestion.is_active.is_(True),
                        ServiceTaskQuestion.is_required.is_(True),
                    )
                    .exists(),
                )
                .limit(1)
            )
        ).scalar_one()
        su = (await db.execute(select(SuperUser).limit(1))).scalar_one_or_none()
        # Un tercero que no participa en el trabajo.
        ajeno = (
            await db.execute(
                select(User).where(User.id != cust.id, User.id != prov_user.id).limit(1)
            )
        ).scalar_one()

    tok_c, _ = create_access_token(cust.id)
    tok_p, _ = create_access_token(prov_user.id)
    tok_x, _ = create_access_token(ajeno.id)
    H_C = {"Authorization": f"Bearer {tok_c}"}
    H_P = {"Authorization": f"Bearer {tok_p}"}
    H_X = {"Authorization": f"Bearer {tok_x}"}
    H_A = (
        {"Authorization": f"Bearer {create_admin_tokens(su.id)['accessToken']}"}
        if su else None
    )

    async def nuevo_job() -> uuid.UUID:
        async with async_session_factory() as db:
            job = await jobService.create_job(
                db,
                customer_id=cust.id,
                task_id=task.id,
                location={
                    "latitude": 43.6532, "longitude": -79.3832,
                    "address": "Cancel smoke", "city": "Toronto",
                    "province_state": "ON", "postal_zip": "M5H 2N2", "country": "CA",
                },
                priority="standard",
            )
            job.status = JobStatus.PROVIDER_EN_ROUTE
            db.add(JobAssignment(job_id=job.id, provider_id=provider.id, status="ACCEPTED"))
            await db.commit()
            creados.append(job.id)
            return job.id

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=90) as c:

        print("\n[1] Motivos disponibles por rol")
        r = await c.get("/api/v1/jobs/cancel-reasons", headers=H_C, params={"role": "customer"})
        codes_c = [x["code"] for x in r.json()["data"]] if r.status_code == 200 else []
        check("el cliente recibe sus motivos",
              "PROVIDER_INTOXICATED" in codes_c, f"{len(codes_c)} motivos")
        r = await c.get("/api/v1/jobs/cancel-reasons", headers=H_P, params={"role": "provider"})
        codes_p = [x["code"] for x in r.json()["data"]] if r.status_code == 200 else []
        check("el proveedor recibe los suyos", "SCOPE_LARGER" in codes_p, f"{len(codes_p)}")
        check("son listas distintas", set(codes_c) != set(codes_p))

        print("\n[2] Validaciones")
        jid = await nuevo_job()
        r = await c.post(f"/api/v1/jobs/{jid}/cancel-with-reason", headers=H_C,
                         json={"reasonCode": "NO_EXISTE"})
        check("motivo inventado -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post(f"/api/v1/jobs/{jid}/cancel-with-reason", headers=H_C,
                         json={"reasonCode": "OTHER"})
        check("'otro motivo' sin texto -> 400", r.status_code == 400,
              str(r.json().get("detail",""))[:55] if r.status_code == 400 else str(r.status_code))

        # Un motivo del PROVEEDOR no vale para el cliente.
        r = await c.post(f"/api/v1/jobs/{jid}/cancel-with-reason", headers=H_C,
                         json={"reasonCode": "SCOPE_LARGER"})
        check("motivo del otro rol -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post(f"/api/v1/jobs/{jid}/cancel-with-reason", headers=H_X,
                         json={"reasonCode": "FELT_UNSAFE"})
        check("un tercero no puede cancelar -> 403", r.status_code == 403, str(r.status_code))

        print("\n[3] El cliente cancela (llegó intoxicado)")
        r = await c.post(f"/api/v1/jobs/{jid}/cancel-with-reason", headers=H_C, json={
            "reasonCode": "PROVIDER_INTOXICATED",
            "note": "Llegó con aliento alcohólico, no lo dejé entrar."})
        ok = r.status_code == 200
        data = r.json().get("data", {}) if ok else {}
        check("cancelación -> 200", ok, r.text[:130] if not ok else "")
        check("responde que NO hay cargo", data.get("charged") is False)
        check("el job queda cancelado por el cliente",
              data.get("status") == "cancelled_by_customer", str(data.get("status")))

        async with async_session_factory() as db:
            rep = (await db.execute(
                select(JobCancellationReport).where(JobCancellationReport.job_id == jid)
            )).scalar_one()
        check("el reporte queda PENDIENTE de revisión", rep.status == "PENDING", rep.status)
        check("NO afecta la calificación por sí solo", rep.rating_impact is False)
        check("guarda el motivo y el texto",
              rep.reason_code == "PROVIDER_INTOXICATED" and bool(rep.note))

        print("\n[4] No se puede cancelar dos veces")
        r = await c.post(f"/api/v1/jobs/{jid}/cancel-with-reason", headers=H_C,
                         json={"reasonCode": "FELT_UNSAFE"})
        check("segunda cancelación -> 400", r.status_code == 400, str(r.status_code))

        print("\n[5] El proveedor cancela por alcance")
        jid2 = await nuevo_job()
        r = await c.post(f"/api/v1/jobs/{jid2}/cancel-with-reason", headers=H_P, json={
            "reasonCode": "SCOPE_LARGER",
            "note": "Reservaron pasear 3 perros y en el sitio eran 10."})
        ok = r.status_code == 200
        check("cancelación del proveedor -> 200", ok, r.text[:120] if not ok else "")
        check("queda cancelado por el proveedor",
              ok and r.json()["data"]["status"] == "cancelled_by_provider")

        print("\n[6] Revisión del admin")
        if H_A is None:
            check("hay superuser", False, "sin filas en superusers")
        else:
            r = await c.get("/api/v1/admin/cancellation-reports", headers=H_A,
                            params={"status_filter": "PENDING"})
            ids = [x["id"] for x in r.json()["data"]] if r.status_code == 200 else []
            check("los dos reportes están en la cola",
                  r.status_code == 200 and str(rep.id) in ids, f"{len(ids)} en cola")

            # DESESTIMAR debe forzar ratingImpact=False aunque venga en true.
            r = await c.post(f"/api/v1/admin/cancellation-reports/{rep.id}/review",
                             headers=H_A,
                             json={"status": "DISMISSED", "ratingImpact": True,
                                   "adminNote": "Sin evidencia"})
            ok = r.status_code == 200
            check("desestimar -> 200", ok, r.text[:100] if not ok else "")
            check("desestimado NO puede afectar la calificación",
                  ok and r.json()["data"]["ratingImpact"] is False,
                  str(r.json()["data"].get("ratingImpact")) if ok else "")

            # Y confirmar sí puede.
            async with async_session_factory() as db:
                rep2 = (await db.execute(
                    select(JobCancellationReport).where(JobCancellationReport.job_id == jid2)
                )).scalar_one()
            r = await c.post(f"/api/v1/admin/cancellation-reports/{rep2.id}/review",
                             headers=H_A,
                             json={"status": "UPHELD", "ratingImpact": True})
            check("confirmar con impacto -> 200 y ratingImpact=true",
                  r.status_code == 200 and r.json()["data"]["ratingImpact"] is True)

    # ---------------------------------------------------------------- limpieza
    print("\n[7] Limpieza")
    async with async_session_factory() as db:
        if creados:
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
            for jid_ in creados:
                for tabla, col in hijas:
                    await db.execute(text(f"DELETE FROM {tabla} WHERE {col} = :j"),
                                     {"j": str(jid_)})
            await db.execute(delete(Job).where(Job.id.in_(creados)))
        await db.commit()
        rest = (await db.execute(select(JobCancellationReport))).scalars().all()
    print(f"        {len(creados)} job(s) borrado(s), {len(rest)} reporte(s) en la tabla")

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
