"""Smoke for customer-confirmed booking quantity (Provider-Set Pricing · PP4a).

Proves the quantity multiplier against visp_prod:
  PART A — POST /jobs/book with quantity=3 on a PER_UNIT (allows_quantity) task
           stores jobs.quantity = 3.
  PART B — provider sets a rate, a job for that task carries quantity=3, the
           provider accepts -> subtotal = rate × 3 (not the ×1 estimate), and
           commission/total flow off that subtotal.
  PART C — resolve_quantity ignores the customer quantity when the task does not
           allow it (falls back to the estimate).

Requires migrations 021 + 022 + 024 + 025 applied. A try/finally removes every
seeded row (pricing_events first — FK jobs ON DELETE RESTRICT) so visp_prod is
left exactly as it was.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_provider_quantity.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.main import app  # noqa: E402
from src.services import auth_service, provider_rate_service  # noqa: E402

from src.core.config import settings  # noqa: E402

# La conexión sale del .env (settings.database_url): este script NO lleva
# credenciales dentro. Se niega a correr si no es la base real.
_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

API = "/api/v1"
QTY = 3


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: str, msg: str) -> None:
    print(f"[{n}] {msg}")


async def cleanup_job(conn, jid) -> None:
    await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", jid)
    await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", jid)
    await conn.execute("DELETE FROM jobs WHERE id=$1", jid)


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    booked_id = None
    job_b = uuid.uuid4()
    provider_id = None
    # Set once the provider is picked; the cleanup runs even if we fail before that.
    home_original = None
    task = None
    seeded_qual = False
    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "wrong DB")
        print("Connected to dev DB: visp_prod")

        # ACTIVE + L0/L1 + ORDER BY id. `ORDER BY created_at` picked a different
        # provider on every run (the seeded ones share created_at) and sometimes
        # landed on an L3, which needs a verified licence and insurance. It went
        # unnoticed while the smoke inserted the job_assignment by hand; the
        # provider job list is now computed live, so the real filter applies.
        prov = await conn.fetchrow(
            "SELECT id, user_id, home_latitude, home_longitude, service_radius_km "
            "FROM provider_profiles "
            "WHERE status = 'ACTIVE' AND current_level IN ('LEVEL_0', 'LEVEL_1') "
            "ORDER BY id LIMIT 1")
        check(prov is not None, "need an ACTIVE L0/L1 provider_profile")
        provider_id, provider_user = prov["id"], prov["user_id"]
        # Put the provider where the job is (43.65, -79.38): that distance is what
        # matching measures. Restored in the cleanup.
        home_original = (prov["home_latitude"], prov["home_longitude"], prov["service_radius_km"])
        await conn.execute(
            "UPDATE provider_profiles SET home_latitude=43.65, home_longitude=-79.38, "
            "service_radius_km=50, updated_at=now() WHERE id=$1", provider_id)

        # A PER_UNIT task that allows quantity and has a price range.
        task = await conn.fetchrow(
            """SELECT id, name, pricing_unit, allows_quantity, min_quantity,
                      base_price_min_cents, base_price_max_cents, estimated_duration_min
               FROM service_tasks
               WHERE pricing_unit = 'PER_UNIT' AND allows_quantity = TRUE AND is_active = TRUE
                 AND base_price_min_cents IS NOT NULL AND base_price_max_cents > base_price_min_cents
                 AND NOT requires_details AND NOT requires_evidence
                 -- Sin preguntas obligatorias: se prueba la cantidad, no el formulario.
                 AND NOT EXISTS (
                     SELECT 1 FROM service_task_questions q
                      WHERE q.task_id = service_tasks.id AND q.is_active AND q.is_required
                 )
               ORDER BY name LIMIT 1""")
        check(task is not None, "need a PER_UNIT allows_quantity task with a range")
        print(f"task '{task['name']}' (PER_UNIT, allows_quantity, min_qty={task['min_quantity']})")

        customer = await conn.fetchrow(
            "SELECT id FROM users WHERE id <> $1 ORDER BY created_at NULLS LAST LIMIT 1", provider_user)
        check(customer is not None, "need a customer user")

        # Qualify the provider for the task.
        q = await conn.fetchrow(
            "SELECT id, qualified FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
            provider_id, task["id"])
        if q is None:
            await conn.execute(
                "INSERT INTO provider_task_qualifications (id, provider_id, task_id, qualified, auto_granted, qualified_at, created_at, updated_at) "
                "VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
                uuid.uuid4(), provider_id, task["id"])
            seeded_qual = True
        elif not q["qualified"]:
            await conn.execute("UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1", q["id"])

        rate_cents = (task["base_price_min_cents"] + task["base_price_max_cents"]) // 2
        expected_subtotal = rate_cents * QTY
        commission_rate = 0.20

        token_prov, _ = auth_service.create_access_token(provider_user)
        token_cust, _ = auth_service.create_access_token(customer["id"])
        hdr_prov = {"Authorization": f"Bearer {token_prov}"}
        hdr_cust = {"Authorization": f"Bearer {token_cust}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            # ---------------- PART A: booking stores quantity ----------------
            step("A", f"POST /jobs/book with quantity={QTY}")
            r = await client.post(f"{API}/jobs/book", headers=hdr_cust, json={
                "serviceTaskId": str(task["id"]),
                "locationAddress": "1 Smoke St",
                "locationLat": 43.65, "locationLng": -79.38,
                "provinceState": "ON",
                "quantity": QTY,
            })
            check(r.status_code in (200, 201), f"book: {r.status_code}: {r.text}")
            booked_id = uuid.UUID(r.json()["data"]["job"]["id"])
            stored = await conn.fetchval("SELECT quantity FROM jobs WHERE id=$1", booked_id)
            check(stored == Decimal(QTY), f"stored quantity {stored} != {QTY}")
            print(f"        -> job {booked_id} stored quantity={stored}")

            # ---------------- PART B: reprice uses rate × quantity ----------------
            step("B1", f"provider sets rate {rate_cents}c")
            r = await client.put(f"{API}/provider/rates/{task['id']}", headers=hdr_prov, json={"rate_cents": rate_cents})
            check(r.status_code == 200, f"set rate: {r.status_code}: {r.text}")

            step("B2", f"seed OFFERED job with quantity={QTY} + provider accepts")
            await conn.execute(
                """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                       service_latitude, service_longitude, service_address, service_province_state,
                       quantity, quoted_price_cents, commission_rate, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,'PENDING_MATCH',43.65,-79.38,'1 Smoke St','ON',$5,$6,$7,now(),now())""",
                job_b, f"PP4A-{job_b.hex[:8].upper()}", customer["id"], task["id"],
                Decimal(QTY), task["base_price_max_cents"] + 999, commission_rate)
            # Sin sembrar job_assignments: la bolsa del proveedor ya no las lee.
            # Ofertas v2: el proveedor OFERTA y el cliente elige. En PER_UNIT la
            # magnitud la puso el cliente al reservar, así que la oferta no lleva
            # ninguna: es justo lo que se está comprobando aquí.
            r = await client.post(f"{API}/provider/open-jobs/{job_b}/offer",
                                  headers=hdr_prov, json={})
            check(r.status_code == 201, f"offer: {r.status_code}: {r.text}")
            _oid = r.json()["data"]["offerId"]
            check(r.json()["data"]["magnitude"] == float(QTY),
                  f"la oferta tomó magnitud {r.json()['data']['magnitude']} en vez de {QTY}")
            r = await client.post(f"{API}/jobs/{job_b}/offers/{_oid}/accept", headers=hdr_cust)
            check(r.status_code == 200, f"accept: {r.status_code}: {r.text}")
            row = await conn.fetchrow(
                "SELECT quoted_price_cents, commission_amount_cents, provider_payout_cents, total_charged_cents FROM jobs WHERE id=$1", job_b)
            check(row["quoted_price_cents"] == expected_subtotal,
                  f"subtotal {row['quoted_price_cents']} != rate {rate_cents} x {QTY} = {expected_subtotal}")
            # La comisión la recalcula el reprice desde el NIVEL del proveedor que se
            # queda el trabajo; la sembrada era un marcador. Se comprueba la relación,
            # no un número fijo que se rompe cuando cambian los niveles.
            tasa = await conn.fetchval("SELECT commission_rate FROM jobs WHERE id=$1", job_b)
            exp_comm = int(Decimal(expected_subtotal) * tasa)
            check(row["commission_amount_cents"] == exp_comm, f"commission {row['commission_amount_cents']} != {exp_comm}")
            check(row["provider_payout_cents"] == expected_subtotal - exp_comm, "payout mismatch")
            print(f"        -> subtotal {row['quoted_price_cents']}c (rate {rate_cents} x {QTY}), commission {exp_comm}c, total {row['total_charged_cents']}c")

            step("B3", "la oferta aceptada lleva la cantidad real del cliente")
            of = await conn.fetchrow(
                "SELECT magnitude, magnitude_source, subtotal_cents FROM job_offers "
                "WHERE job_id=$1 AND status='accepted'", job_b)
            check(of["magnitude"] == Decimal(QTY), f"magnitud {of['magnitude']} != {QTY}")
            check(of["magnitude_source"] == "CUSTOMER",
                  f"origen {of['magnitude_source']} != CUSTOMER")
            check(of["subtotal_cents"] == expected_subtotal, "subtotal de la oferta mal")
            print(f"        -> la oferta cobra {QTY} unidades (puestas por el cliente) "
                  f"-> ${expected_subtotal/100:.2f}")

        # ---------------- PART C: resolve_quantity ----------------
        #
        # CAMBIO DE COMPORTAMIENTO (ofertas v2, 2026-08-19). Antes esta función solo
        # hacía caso a `job.quantity` si el servicio tenía `allows_quantity`. Ese flag
        # ahora significa "el CLIENTE teclea la cantidad", y es falso en todo lo que no
        # sea por ítem — así que la puerta habría tirado la magnitud de la oferta
        # aceptada y repreciado con la estimación del catálogo: el cliente acepta 8
        # horas y le facturan 2. Ahora la cantidad del job manda siempre, venga del
        # cliente (PER_UNIT) o del proveedor al ofertar (horas, m²).
        step("C", "resolve_quantity hace caso a la cantidad del job, venga de quien venga")

        class _T:
            pricing_unit = task["pricing_unit"]
            allows_quantity = True
            estimated_duration_min = task["estimated_duration_min"]

        check(provider_rate_service.resolve_quantity(_T(), QTY) == Decimal(QTY),
              "no respetó la cantidad del cliente")
        _T.allows_quantity = False
        check(provider_rate_service.resolve_quantity(_T(), QTY) == Decimal(QTY),
              "tiró la magnitud de la oferta por allows_quantity=False — ese era el bug")
        check(provider_rate_service.resolve_quantity(_T(), None) == Decimal(1),
              "sin cantidad debe caer en la estimación del catálogo")
        print("        -> la cantidad del job manda; sin ella, estimación del catálogo")

        print("\nAll quantity cases passed.")

    finally:
        print("\n[cleanup] removing test data ...")
        try:
            if booked_id is not None:
                await cleanup_job(conn, booked_id)
            await cleanup_job(conn, job_b)
            if provider_id and home_original is not None:
                await conn.execute(
                    "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
                    "service_radius_km=$4, updated_at=now() WHERE id=$1",
                    provider_id, *home_original)
            if provider_id and task:
                await conn.execute("DELETE FROM provider_service_rates WHERE provider_id=$1 AND task_id=$2", provider_id, task["id"])
                if seeded_qual:
                    await conn.execute("DELETE FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2", provider_id, task["id"])
            print("[cleanup] visp_prod is clean.")
        finally:
            await conn.close()


def main() -> None:
    try:
        asyncio.run(run())
    except BaseException as exc:  # noqa: BLE001
        print(f"\nSMOKE FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
    print("\nSMOKE PASS")


if __name__ == "__main__":
    main()
