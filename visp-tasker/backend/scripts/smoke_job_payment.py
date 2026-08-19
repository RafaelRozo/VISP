"""End-to-end smoke for PP4b job payment authorize/capture against visp_prod +
Stripe **test mode**.

  1. seed an approved job with total_charged + commission, an ACCEPTED assignment,
     and point the provider at a chargeable test connected account.
  2. POST /jobs/{id}/authorize-payment (pm_card_visa) -> hold total×1.30,
     status requires_capture, job.stripe_payment_intent_id set.
  3. POST /jobs/{id}/capture-payment -> capture the real total, status succeeded,
     job.final_price_cents == total.

REFUSES to run off the la base visp_prod or a non-test Stripe key. A try/finally
restores the provider's original stripe_account_id and removes seeded rows
(pricing_events first — FK jobs ON DELETE RESTRICT).

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      DEST_ACCOUNT=acct_1TnkjBIE9FBLLe0M ./venv/bin/python scripts/smoke_job_payment.py
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

from src.core.config import settings  # noqa: E402

# La conexión sale del .env (settings.database_url): este script NO lleva
# credenciales dentro. Se niega a correr si no es la base real.
_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

if not (settings.stripe_secret_key or "").startswith(("sk_test", "rk_test")):
    print("REFUSING TO RUN: not a Stripe TEST key.", file=sys.stderr)
    sys.exit(2)

API = "/api/v1"
DEST = os.environ.get("DEST_ACCOUNT", "acct_1TnkjBIE9FBLLe0M")


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: str, msg: str) -> None:
    print(f"[{n}] {msg}")


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    job_id = uuid.uuid4()
    provider_id = None
    orig_acct = None
    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "wrong DB")
        print(f"Connected to visp_prod | Stripe TEST | dest {DEST}")

        prov = await conn.fetchrow(
            "SELECT id, user_id, stripe_account_id FROM provider_profiles ORDER BY created_at NULLS LAST LIMIT 1")
        check(prov is not None, "need a provider_profile")
        provider_id, provider_user, orig_acct = prov["id"], prov["user_id"], prov["stripe_account_id"]

        customer = await conn.fetchrow(
            "SELECT id FROM users WHERE id <> $1 ORDER BY created_at NULLS LAST LIMIT 1", provider_user)
        check(customer is not None, "need a customer user")

        task_id = await conn.fetchval(
            "SELECT id FROM service_tasks WHERE pricing_unit <> 'CUSTOM_QUOTE' AND is_active LIMIT 1")

        # PP3 worked example.
        subtotal = 9500
        tax = int((Decimal(subtotal) * Decimal("0.13")).quantize(Decimal("1"), ROUND_HALF_UP))
        total = subtotal + tax                                  # 10735
        commission = int(Decimal(subtotal) * Decimal("0.20"))   # 1900
        auth_amount = int((Decimal(total) * Decimal("1.30")).quantize(Decimal("1"), ROUND_HALF_UP))

        step("setup", f"point provider at test account + seed approved job (total {total}c, fee {commission}c)")
        await conn.execute("UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1", provider_id, DEST)
        await conn.execute(
            """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                   service_latitude, service_longitude, service_address, service_province_state,
                   quoted_price_cents, commission_rate, commission_amount_cents, provider_payout_cents,
                   service_tax_cents, tax_rate_applied, tax_jurisdiction, total_charged_cents,
                   created_at, updated_at)
               VALUES ($1,$2,$3,$4,'PROVIDER_ACCEPTED',43.65,-79.38,'1 Smoke St','ON',
                   $5,0.20,$6,$7,$8,0.13000,'ON',$9,now(),now())""",
            job_id, f"PP4B-{job_id.hex[:8].upper()}", customer["id"], task_id,
            subtotal, commission, subtotal - commission, tax, total)
        await conn.execute(
            "INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, responded_at, created_at, updated_at) "
            "VALUES ($1,$2,$3,'ACCEPTED',now(),now(),now(),now())",
            uuid.uuid4(), job_id, provider_id)

        token_cust, _ = auth_service.create_access_token(customer["id"])
        hdr_cust = {"Authorization": f"Bearer {token_cust}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            step("1", "POST /authorize-payment (pm_card_visa) -> hold total × 1.30")
            r = await client.post(f"{API}/jobs/{job_id}/authorize-payment", headers=hdr_cust,
                                  json={"paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"authorize: {r.status_code}: {r.text}")
            d = r.json()["data"]
            check(d["status"] == "requires_capture", f"status {d['status']} != requires_capture")
            check(d["authorizedCents"] == auth_amount, f"authorized {d['authorizedCents']} != {auth_amount}")
            check(d["applicationFeeCents"] == commission, f"fee {d['applicationFeeCents']} != {commission}")
            pi_db = await conn.fetchval("SELECT stripe_payment_intent_id FROM jobs WHERE id=$1", job_id)
            check(pi_db == d["paymentIntentId"], "job.stripe_payment_intent_id not stored")
            print(f"        -> PI {d['paymentIntentId']} held {d['authorizedCents']}c (fee {d['applicationFeeCents']}c)")

            step("2", "POST /capture-payment -> capture real total, release the rest")
            r = await client.post(f"{API}/jobs/{job_id}/capture-payment", headers=hdr_cust)
            check(r.status_code == 200, f"capture: {r.status_code}: {r.text}")
            d2 = r.json()["data"]
            check(d2["status"] == "succeeded", f"capture status {d2['status']}")
            check(d2["capturedCents"] == total, f"captured {d2['capturedCents']} != {total}")
            final_db = await conn.fetchval("SELECT final_price_cents FROM jobs WHERE id=$1", job_id)
            check(final_db == total, f"job.final_price_cents {final_db} != {total}")
            print(f"        -> captured {d2['capturedCents']}c (released {auth_amount - total}c), provider gets {total - commission}c")

        print("\nAll PP4b payment steps passed.")

    finally:
        print("\n[cleanup] removing test data ...")
        try:
            await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", job_id)
            await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
            await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)
            if provider_id is not None:
                await conn.execute("UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1", provider_id, orig_acct)
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
