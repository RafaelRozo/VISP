"""
Test-only utility: delete every Stripe Connect test account and wipe the
matching provider_profiles columns so providers re-enter the v2 onboarding
from scratch.

Run from inside the backend container:

    docker exec -i visp-backend python /app/scripts/reset_stripe_test.py

This script is intentionally a no-op in live mode — it refuses to run if
the configured Stripe key is anything other than a test key (`sk_test_*`).
"""

from __future__ import annotations

import asyncio
import sys

import asyncpg
import stripe

from src.core.config import settings


def main() -> int:
    if not settings.stripe_secret_key.startswith("sk_test_"):
        print("Refusing to run: stripe_secret_key is not a test key.")
        return 1

    stripe.api_key = settings.stripe_secret_key

    accts = stripe.Account.list(limit=100).data
    print(f"Found {len(accts)} Stripe accounts.")
    for a in accts:
        try:
            r = stripe.Account.delete(a.id)
            print(f"  deleted {a.id}: {r.deleted}")
        except Exception as exc:
            print(f"  FAIL {a.id}: {exc}")

    # asyncpg ships in the backend container; psycopg2 does not.
    db_url = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

    async def wipe() -> str:
        conn = await asyncpg.connect(db_url)
        try:
            return await conn.execute("""
                UPDATE provider_profiles SET
                  stripe_account_id=NULL,
                  stripe_onboarding_step=NULL,
                  stripe_requirements_due='[]'::jsonb,
                  stripe_capabilities='{}'::jsonb,
                  stripe_external_account_id=NULL,
                  stripe_identity_session_id=NULL,
                  stripe_tos_accepted_at=NULL
                WHERE stripe_account_id IS NOT NULL
                   OR stripe_onboarding_step IS NOT NULL
            """)
        finally:
            await conn.close()

    result = asyncio.run(wipe())  # asyncpg returns "UPDATE N"
    print(f"DB: {result}")
    return 0


if __name__ == "__main__":
    sys.exit(main())
