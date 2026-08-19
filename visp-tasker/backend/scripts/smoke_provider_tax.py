"""Smoke for the PP3 tax engine against visp_prod.

Proves the sales-tax layer of the provider-set pricing waterfall:
  CASE A — tax-registered provider, job in Ontario  -> 13% HST added,
           total_charged = subtotal + tax, jurisdiction 'ON', and the
           customer's pending-provider payload carries the tax line.
  CASE B — NON-registered provider, same Ontario job -> tax 0, no
           jurisdiction, total_charged = subtotal (open-item #1 behaviour).

Requires migrations 021 + 022 + 024 applied. A try/finally restores the
provider's original tax_registered flag and removes all seeded rows
(pricing_events first — they FK jobs with ON DELETE RESTRICT) so visp_prod is
left exactly as it was.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_provider_tax.py
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.main import app  # noqa: E402
from src.services import auth_service  # noqa: E402
from src.services.fee_service import compute_service_fee_cents  # noqa: E402

from src.core.config import settings  # noqa: E402

# La conexión sale del .env (settings.database_url): este script NO lleva
# credenciales dentro. Se niega a correr si no es la base real.
_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

API = "/api/v1"
ON_RATE = Decimal("0.13000")  # Ontario HST, must match province_tax_rates seed


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: str, msg: str) -> None:
    print(f"[{n}] {msg}")


def expected_qty(unit: str, dur_min: int | None) -> int:
    if unit == "HOURLY":
        return max(1, round((dur_min or 60) / 60))
    return 1


def round_cents(value: Decimal) -> int:
    return int(value.quantize(Decimal("1"), rounding=ROUND_HALF_UP))


async def seed_job(conn, job_id, customer_id, task_id, provider_id, quote, commission_rate) -> None:
    await conn.execute(
        """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
               service_latitude, service_longitude, service_address, service_province_state,
               quoted_price_cents, commission_rate, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'PENDING_MATCH',43.65,-79.38,'1 Smoke St','ON',$5,$6,now(),now())""",
        job_id, f"PP3-{job_id.hex[:8].upper()}", customer_id, task_id, quote, commission_rate,
    )
    await conn.execute(
        "INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, created_at, updated_at) "
        "VALUES ($1,$2,$3,'OFFERED',now(),now(),now())",
        uuid.uuid4(), job_id, provider_id,
    )


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    job_a = uuid.uuid4()
    job_b = uuid.uuid4()
    provider_id = None
    task = None
    seeded_qual = False
    orig_tax_registered = None
    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "wrong DB")
        print("Connected to dev DB: visp_prod")

        # Verify the ON rate matches the seed (guards against a drifted migration).
        on_rate = await conn.fetchval(
            "SELECT combined_rate FROM province_tax_rates WHERE province_code='ON'")
        check(on_rate == ON_RATE, f"ON rate in DB is {on_rate}, expected {ON_RATE}")

        prov = await conn.fetchrow(
            "SELECT id, user_id, tax_registered FROM provider_profiles ORDER BY created_at NULLS LAST LIMIT 1")
        check(prov is not None, "need a provider_profile")
        provider_id, provider_user = prov["id"], prov["user_id"]
        orig_tax_registered = prov["tax_registered"]

        task = await conn.fetchrow(
            """SELECT id, name, pricing_unit, base_price_min_cents, base_price_max_cents, estimated_duration_min
               FROM service_tasks
               WHERE pricing_unit <> 'CUSTOM_QUOTE' AND is_active = TRUE
                 AND base_price_min_cents IS NOT NULL AND base_price_max_cents > base_price_min_cents
               ORDER BY name LIMIT 1""")
        check(task is not None, "need a priceable task with a range")
        unit = task["pricing_unit"]

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

        customer = await conn.fetchrow(
            "SELECT id FROM users WHERE id <> $1 ORDER BY created_at NULLS LAST LIMIT 1", provider_user)
        check(customer is not None, "need a customer user")

        rate_cents = (task["base_price_min_cents"] + task["base_price_max_cents"]) // 2
        qty = expected_qty(unit, task["estimated_duration_min"])
        subtotal = rate_cents * qty
        commission_rate = 0.20
        expected_tax = round_cents(Decimal(subtotal) * ON_RATE)
        # PP4c: total_charged = subtotal + tax + grossed-up service fee.
        net_a = subtotal + expected_tax
        fee_a = compute_service_fee_cents(net_a)
        total_a = net_a + fee_a
        fee_b = compute_service_fee_cents(subtotal)   # case B: no tax
        total_b = subtotal + fee_b
        print(f"provider {provider_id} · task '{task['name']}' ({unit}) · rate {rate_cents}c x{qty} = {subtotal}c subtotal")
        print(f"expected ON HST {expected_tax}c + service fee {fee_a}c -> total {total_a}c")

        token_prov, _ = auth_service.create_access_token(provider_user)
        token_cust, _ = auth_service.create_access_token(customer["id"])
        hdr_prov = {"Authorization": f"Bearer {token_prov}"}
        hdr_cust = {"Authorization": f"Bearer {token_cust}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            r = await client.put(f"{API}/provider/rates/{task['id']}", headers=hdr_prov, json={"rate_cents": rate_cents})
            check(r.status_code == 200, f"set rate: {r.status_code}: {r.text}")

            # ---------------- CASE A: tax-registered -> HST applies ----------------
            step("A1", "mark provider tax_registered=TRUE")
            await conn.execute("UPDATE provider_profiles SET tax_registered=TRUE WHERE id=$1", provider_id)
            step("A2", "seed Ontario job + provider accepts -> reprice with tax")
            await seed_job(conn, job_a, customer["id"], task["id"], provider_id, task["base_price_max_cents"] + 999, commission_rate)
            r = await client.post(f"{API}/provider/open-jobs/{job_a}/offer",
                                   headers=hdr_prov, json={"magnitude": float(qty)})
            check(r.status_code == 201, f"offer job_a: {r.status_code}: {r.text}")
            _oid = r.json()["data"]["offerId"]
            r = await client.post(f"{API}/jobs/{job_a}/offers/{_oid}/accept",
                                   headers=hdr_cust)
            check(r.status_code == 200, f"accept A: {r.status_code}: {r.text}")
            row = await conn.fetchrow(
                "SELECT quoted_price_cents, service_tax_cents, tax_rate_applied, tax_jurisdiction, service_fee_cents, total_charged_cents FROM jobs WHERE id=$1", job_a)
            check(row["quoted_price_cents"] == subtotal, f"subtotal {row['quoted_price_cents']} != {subtotal}")
            check(row["service_tax_cents"] == expected_tax, f"tax {row['service_tax_cents']} != {expected_tax}")
            check(row["tax_rate_applied"] == ON_RATE, f"rate {row['tax_rate_applied']} != {ON_RATE}")
            check(row["tax_jurisdiction"] == "ON", f"jurisdiction {row['tax_jurisdiction']} != ON")
            check(row["service_fee_cents"] == fee_a, f"service fee {row['service_fee_cents']} != {fee_a}")
            check(row["total_charged_cents"] == total_a,
                  f"total {row['total_charged_cents']} != {total_a}")
            print(f"        -> tax {row['service_tax_cents']}c ({row['tax_jurisdiction']}) + fee {row['service_fee_cents']}c, total {row['total_charged_cents']}c")

            step("A3", "pricing_events snapshot written")
            ev = await conn.fetchrow(
                "SELECT subtotal_cents, service_tax_cents, tax_rate FROM pricing_events WHERE job_id=$1 ORDER BY created_at DESC LIMIT 1", job_a)
            check(ev is not None, "no pricing_event snapshot")
            check(ev["service_tax_cents"] == expected_tax and ev["subtotal_cents"] == subtotal, "pricing_event tax mismatch")
            print(f"        -> event subtotal {ev['subtotal_cents']}c tax {ev['service_tax_cents']}c rate {ev['tax_rate']}")

            # El cliente ya no ve el impuesto en `pending-provider` (endpoint del flujo
            # viejo, eliminado): lo ve en la tarjeta de la oferta ANTES de aceptar, que
            # es donde tiene que estar para poder decidir. Se comprueba el sellado
            # sobre el job, que es la fuente contable.
            step("A4", "el job queda sellado con la línea de impuesto")
            data = await conn.fetchrow(
                "SELECT service_tax_cents t, tax_jurisdiction j, service_fee_cents f, "
                "total_charged_cents tot FROM jobs WHERE id=$1", job_a)
            check(data["t"] == expected_tax, f"tax {data['t']} != {expected_tax}")
            check(data["j"] == "ON", f"jurisdiction {data['j']}")
            check(data["f"] == fee_a, f"fee {data['f']} != {fee_a}")
            check(data["tot"] == total_a, "total mismatch")
            oferta_tax = await conn.fetchval(
                "SELECT service_tax_cents FROM job_offers WHERE job_id=$1 AND status='accepted'", job_a)
            check(oferta_tax == expected_tax,
                  f"la oferta mostró {oferta_tax}c de impuesto y se cobró {expected_tax}c")
            print(f"        -> sellado: tax {data['t']}c + fee {data['f']}c, total {data['tot']}c "
                  f"(y la oferta ya mostraba {oferta_tax}c de impuesto)")

            # ---------------- CASE B: NOT registered -> tax 0 ----------------
            step("B1", "mark provider tax_registered=FALSE")
            await conn.execute("UPDATE provider_profiles SET tax_registered=FALSE WHERE id=$1", provider_id)
            step("B2", "seed Ontario job + provider accepts -> NO tax")
            await seed_job(conn, job_b, customer["id"], task["id"], provider_id, task["base_price_max_cents"] + 999, commission_rate)
            r = await client.post(f"{API}/provider/open-jobs/{job_b}/offer",
                                   headers=hdr_prov, json={"magnitude": float(qty)})
            check(r.status_code == 201, f"offer job_b: {r.status_code}: {r.text}")
            _oid = r.json()["data"]["offerId"]
            r = await client.post(f"{API}/jobs/{job_b}/offers/{_oid}/accept",
                                   headers=hdr_cust)
            check(r.status_code == 200, f"accept B: {r.status_code}: {r.text}")
            row = await conn.fetchrow(
                "SELECT quoted_price_cents, service_tax_cents, tax_rate_applied, tax_jurisdiction, total_charged_cents FROM jobs WHERE id=$1", job_b)
            check(row["service_tax_cents"] == 0, f"non-registered tax {row['service_tax_cents']} != 0")
            check(row["tax_rate_applied"] is None, f"non-registered rate should be NULL, got {row['tax_rate_applied']}")
            check(row["tax_jurisdiction"] is None, f"non-registered jurisdiction should be NULL, got {row['tax_jurisdiction']}")
            check(row["total_charged_cents"] == total_b, f"non-registered total {row['total_charged_cents']} != {total_b} (subtotal+fee, no tax)")
            print(f"        -> tax 0c, total {row['total_charged_cents']}c (subtotal {subtotal}c + fee {fee_b}c, no tax line)")

        print("\nAll tax cases passed.")

    finally:
        print("\n[cleanup] removing test data ...")
        try:
            for jid in (job_a, job_b):
                await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM jobs WHERE id=$1", jid)
            if provider_id is not None and orig_tax_registered is not None:
                await conn.execute("UPDATE provider_profiles SET tax_registered=$2 WHERE id=$1", provider_id, orig_tax_registered)
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
