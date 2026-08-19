"""End-to-end smoke for PP4c overage approval against visp_prod + Stripe test mode.

  CASE A — actual ≤ ceiling: authorize then capture the actual; succeeds.
  CASE B — actual > ceiling, NOT approved: capture-payment returns 409
           overage_approval_required (no charge).
  CASE C — approve-overage then capture: the ceiling is captured on the held PI
           and the delta is collected as a second charge; final price = actual.

Requires migrations 021/022/024/025/026 + a Stripe TEST key. A try/finally
restores the provider's stripe_account_id and removes seeded rows.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      DEST_ACCOUNT=acct_1TnkjBIE9FBLLe0M ./venv/bin/python scripts/smoke_provider_overage.py
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


async def seed_approved_job(conn, job_id, customer_id, task_id, provider_id, total, commission, fee):
    await conn.execute(
        """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
               service_latitude, service_longitude, service_address, service_province_state,
               quoted_price_cents, commission_rate, commission_amount_cents, provider_payout_cents,
               service_tax_cents, tax_rate_applied, tax_jurisdiction, service_fee_cents, total_charged_cents,
               created_at, updated_at)
           VALUES ($1,$2,$3,$4,'PROVIDER_ACCEPTED',43.65,-79.38,'1 Smoke St','ON',
               $5,0.20,$6,$7,$8,0.13000,'ON',$9,$10,now(),now())""",
        job_id, f"PP4C-{job_id.hex[:8].upper()}", customer_id, task_id,
        9500, commission, 9500 - commission, total - 9500 - fee, fee, total)
    await conn.execute(
        "INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, responded_at, created_at, updated_at) "
        "VALUES ($1,$2,$3,'ACCEPTED',now(),now(),now(),now())",
        uuid.uuid4(), job_id, provider_id)


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    job_a = uuid.uuid4()
    job_b = uuid.uuid4()
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
        print(f"total {total}c (sub {subtotal} + tax {tax} + fee {fee}) | ceiling = total×1.30 = {ceiling}c")

        await conn.execute("UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1", provider_id, DEST)
        await seed_approved_job(conn, job_a, customer["id"], task_id, provider_id, total, commission, fee)
        await seed_approved_job(conn, job_b, customer["id"], task_id, provider_id, total, commission, fee)

        token_cust, _ = auth_service.create_access_token(customer["id"])
        hdr = {"Authorization": f"Bearer {token_cust}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            # ---------------- CASE A: actual within ceiling ----------------
            step("A1", "authorize job A (hold total × 1.30)")
            r = await client.post(f"{API}/jobs/{job_a}/authorize-payment", headers=hdr, json={"paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"authorize A: {r.status_code}: {r.text}")
            check(r.json()["data"]["authorizedCents"] == ceiling, "ceiling mismatch A")
            step("A2", "capture actual = total (≤ ceiling) -> succeeds")
            r = await client.post(f"{API}/jobs/{job_a}/capture-payment", headers=hdr)
            check(r.status_code == 200, f"capture A: {r.status_code}: {r.text}")
            check(r.json()["data"]["capturedCents"] == total, f"captured {r.json()['data']['capturedCents']} != {total}")
            print(f"        -> captured {total}c within ceiling")

            # ---------------- CASE B: actual over ceiling, NOT approved ----------------
            step("B1", "authorize job B")
            r = await client.post(f"{API}/jobs/{job_b}/authorize-payment", headers=hdr, json={"paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"authorize B: {r.status_code}: {r.text}")
            over_actual = ceiling + 3000
            step("B2", f"capture actual {over_actual} > ceiling {ceiling}, not approved -> 409")
            r = await client.post(f"{API}/jobs/{job_b}/capture-payment", headers=hdr, json={"finalTotalCents": over_actual})
            check(r.status_code == 409, f"expected 409, got {r.status_code}: {r.text}")
            detail = r.json()["detail"]
            check(detail.get("error") == "overage_approval_required", f"detail {detail}")
            check(detail["overageCents"] == over_actual - ceiling, "overage delta mismatch")
            print(f"        -> 409 overage_approval_required (overage {detail['overageCents']}c)")
            # nothing captured yet
            fp = await conn.fetchval("SELECT final_price_cents FROM jobs WHERE id=$1", job_b)
            check(fp is None, f"should not have captured, final_price={fp}")

            # ---------------- CASE C: approve then capture (ceiling + delta) ----------------
            step("C1", "POST /approve-overage")
            r = await client.post(f"{API}/jobs/{job_b}/approve-overage", headers=hdr)
            check(r.status_code == 200, f"approve: {r.status_code}: {r.text}")
            step("C2", f"capture {over_actual} with pm -> ceiling {ceiling} + delta {over_actual - ceiling}")
            r = await client.post(f"{API}/jobs/{job_b}/capture-payment", headers=hdr,
                                  json={"finalTotalCents": over_actual, "paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"capture C: {r.status_code}: {r.text}")
            d = r.json()["data"]
            check(d["capturedCents"] == ceiling, f"ceiling capture {d['capturedCents']} != {ceiling}")
            check(d["finalPriceCents"] == over_actual, f"final {d['finalPriceCents']} != {over_actual} (ceiling+delta)")
            check(d["actualTotalCents"] == over_actual, "actual_total mismatch")
            print(f"        -> captured ceiling {ceiling}c + delta {over_actual - ceiling}c = {d['finalPriceCents']}c collected")

        print("\nAll overage cases passed.")

    finally:
        print("\n[cleanup] removing test data ...")
        try:
            for jid in (job_a, job_b):
                await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM jobs WHERE id=$1", jid)
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
