"""End-to-end smoke for the full money loop (PP4b + PP5-3) against visp_prod +
Stripe test mode: authorize a hold, drive the job to COMPLETED, and confirm the
held payment is AUTO-captured by the completion transition.

  1. seed an approved job + accepted assignment + provider→test account.
  2. POST /authorize-payment (pm_card_visa) -> hold total × 1.30.
  3. PATCH /status in_progress -> completed (system actor).
  4. completion auto-captures: job.final_price_cents == total, completed_at set,
     PaymentIntent succeeded.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      DEST_ACCOUNT=acct_1TnkjBIE9FBLLe0M ./venv/bin/python scripts/smoke_job_complete_capture.py
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
import stripe  # noqa: E402
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

if not (settings.stripe_secret_key or "").startswith(("sk_test", "rk_test")):
    print("REFUSING TO RUN: not a Stripe TEST key.", file=sys.stderr)
    sys.exit(2)
stripe.api_key = settings.stripe_secret_key

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
        provider_id, provider_user, orig_acct = prov["id"], prov["user_id"], prov["stripe_account_id"]
        customer = await conn.fetchrow(
            "SELECT id FROM users WHERE id <> $1 ORDER BY created_at NULLS LAST LIMIT 1", provider_user)
        task_id = await conn.fetchval(
            "SELECT id FROM service_tasks WHERE pricing_unit <> 'CUSTOM_QUOTE' AND is_active LIMIT 1")

        subtotal, tax = 9500, 1235
        net = subtotal + tax
        fee = compute_service_fee_cents(net)
        total = net + fee
        commission = 1900
        ceiling = int((Decimal(total) * Decimal("1.30")).quantize(Decimal("1"), ROUND_HALF_UP))
        print(f"total {total}c | ceiling {ceiling}c")

        await conn.execute("UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1", provider_id, DEST)
        await conn.execute(
            """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                   service_latitude, service_longitude, service_address, service_province_state,
                   quoted_price_cents, commission_rate, commission_amount_cents, provider_payout_cents,
                   service_tax_cents, tax_rate_applied, tax_jurisdiction, service_fee_cents, total_charged_cents,
                   created_at, updated_at)
               VALUES ($1,$2,$3,$4,'PROVIDER_ACCEPTED',43.65,-79.38,'1 Smoke St','ON',
                   $5,0.20,$6,$7,$8,0.13000,'ON',$9,$10,now(),now())""",
            job_id, f"PP5C-{job_id.hex[:8].upper()}", customer["id"], task_id,
            subtotal, commission, subtotal - commission, tax, fee, total)
        await conn.execute(
            "INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, responded_at, created_at, updated_at) "
            "VALUES ($1,$2,$3,'ACCEPTED',now(),now(),now(),now())",
            uuid.uuid4(), job_id, provider_id)

        token_cust, _ = auth_service.create_access_token(customer["id"])
        hdr = {"Authorization": f"Bearer {token_cust}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            step("1", "authorize hold (pm_card_visa)")
            r = await client.post(f"{API}/jobs/{job_id}/authorize-payment", headers=hdr, json={"paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"authorize: {r.status_code}: {r.text}")
            pi_id = r.json()["data"]["paymentIntentId"]
            check(r.json()["data"]["authorizedCents"] == ceiling, "ceiling mismatch")
            print(f"        -> held {ceiling}c on {pi_id}")

            step("2", "PATCH status en_route -> in_progress -> completed (system)")
            for tgt in ("provider_en_route", "in_progress", "completed"):
                r = await client.patch(f"{API}/jobs/{job_id}/status", json={
                    "new_status": tgt, "actor_id": str(customer["id"]), "actor_type": "system"})
                check(r.status_code == 200, f"status {tgt}: {r.status_code}: {r.text}")

            step("3", "completion auto-captured the hold")
            row = await conn.fetchrow("SELECT status, final_price_cents, completed_at FROM jobs WHERE id=$1", job_id)
            check(str(row["status"]).upper().endswith("COMPLETED"), f"status {row['status']}")
            check(row["completed_at"] is not None, "completed_at not set")
            check(row["final_price_cents"] == total, f"final_price {row['final_price_cents']} != {total}")
            pi = stripe.PaymentIntent.retrieve(pi_id)
            check(pi.status == "succeeded", f"PI status {pi.status} != succeeded")
            check(pi.amount_received == total, f"amount_received {pi.amount_received} != {total}")
            print(f"        -> COMPLETED, auto-captured {total}c (PI {pi.status}), provider gets {total - commission - fee}c + tax")

        print("\nFull money loop passed.")

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
