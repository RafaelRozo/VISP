"""
Seed the initial superuser for the admin dashboard.

Idempotent: if a row with the same email already exists, this script updates
the password / name / role rather than failing.

Usage (from container):
    python scripts/seed_superuser.py
"""

from __future__ import annotations

import asyncio
import os
import sys

# Make sure we can import from the project root when run from /app
sys.path.insert(0, os.path.abspath(os.path.join(os.path.dirname(__file__), "..")))

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.api.deps import async_session_factory
from src.models.superuser import SuperUser
from src.services import admin_service


# Hard-coded initial admin per project request. Change/rotate after first login.
SEED_EMAIL = "richi_yanez20@hotmail.com"
SEED_PASSWORD = "Admin123."
SEED_FIRST_NAME = "Richie"
SEED_LAST_NAME = "Yanez"
SEED_ROLE = "super_admin"


async def main() -> None:
    async with async_session_factory() as db:  # type: AsyncSession
        existing = (
            await db.execute(select(SuperUser).where(SuperUser.email == SEED_EMAIL.lower()))
        ).scalars().first()

        if existing is not None:
            print(f"[seed_superuser] Updating existing superuser {SEED_EMAIL}")
            existing.password_hash = admin_service.hash_password(SEED_PASSWORD)
            existing.first_name = SEED_FIRST_NAME
            existing.last_name = SEED_LAST_NAME
            existing.role = SEED_ROLE
            existing.is_active = True
        else:
            print(f"[seed_superuser] Creating superuser {SEED_EMAIL}")
            su = SuperUser(
                email=SEED_EMAIL.lower(),
                password_hash=admin_service.hash_password(SEED_PASSWORD),
                first_name=SEED_FIRST_NAME,
                last_name=SEED_LAST_NAME,
                role=SEED_ROLE,
                is_active=True,
            )
            db.add(su)

        await db.commit()
        print("[seed_superuser] Done.")


if __name__ == "__main__":
    asyncio.run(main())
