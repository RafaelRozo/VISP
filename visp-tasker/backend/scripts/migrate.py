"""
Run raw SQL migration files against the database.

Executes all .sql files in the ``migrations/`` directory in sorted order
(001_create_users.sql, 002_create_providers.sql, ...).  Each file is run
inside a single transaction.

A ``_migrations_applied`` tracking table is used to record which files have
already been applied, providing idempotent execution.

Usage::

    python -m scripts.migrate

Or from the backend directory::

    python scripts/migrate.py
"""

from __future__ import annotations

import asyncio
import glob
import os
import sys

from sqlalchemy import text
from sqlalchemy.ext.asyncio import create_async_engine

# Ensure the project root (backend/) is on sys.path so ``src`` is importable
_backend_dir = os.path.dirname(os.path.dirname(os.path.abspath(__file__)))
if _backend_dir not in sys.path:
    sys.path.insert(0, _backend_dir)

from src.core.config import settings  # noqa: E402


# ---------------------------------------------------------------------------
# Migration tracking table DDL
# ---------------------------------------------------------------------------

_CREATE_TRACKING_TABLE = """
CREATE TABLE IF NOT EXISTS _migrations_applied (
    filename   TEXT PRIMARY KEY,
    applied_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
"""

_CHECK_APPLIED = """
SELECT 1 FROM _migrations_applied WHERE filename = :filename;
"""

_RECORD_APPLIED = """
INSERT INTO _migrations_applied (filename) VALUES (:filename);
"""


async def run_migrations() -> None:
    """Connect to the database and apply all pending SQL migrations."""
    engine = create_async_engine(settings.database_url)

    migration_dir = os.path.join(
        os.path.dirname(os.path.abspath(__file__)), "..", "migrations"
    )
    migration_dir = os.path.normpath(migration_dir)

    sql_files = sorted(glob.glob(os.path.join(migration_dir, "*.sql")))

    if not sql_files:
        print(f"No SQL files found in {migration_dir}")
        await engine.dispose()
        return

    print(f"Found {len(sql_files)} migration files in {migration_dir}")

    async with engine.begin() as conn:
        # Ensure the tracking table exists
        await conn.execute(text(_CREATE_TRACKING_TABLE))

        applied_count = 0
        skipped_count = 0

        for sql_file in sql_files:
            filename = os.path.basename(sql_file)

            # Check if already applied
            result = await conn.execute(
                text(_CHECK_APPLIED), {"filename": filename}
            )
            if result.scalar() is not None:
                print(f"  SKIP  {filename} (already applied)")
                skipped_count += 1
                continue

            # Read and execute the SQL file
            print(f"  APPLY {filename} ...")
            with open(sql_file, "r") as f:
                sql_content = f.read()

            # asyncpg cannot execute multiple statements via text() (prepared stmt).
            # Access the underlying asyncpg connection which supports multi-statement
            # via the simple query protocol.
            raw_conn = await conn.get_raw_connection()
            asyncpg_conn = raw_conn.dbapi_connection._connection
            await asyncpg_conn.execute(sql_content)

            # Record as applied
            await conn.execute(text(_RECORD_APPLIED), {"filename": filename})
            applied_count += 1

    print(
        f"\nDone. Applied: {applied_count}, Skipped: {skipped_count}, "
        f"Total: {len(sql_files)}"
    )
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(run_migrations())
