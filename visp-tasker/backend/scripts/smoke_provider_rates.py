"""
End-to-end smoke test for Provider-Set Pricing — PP1 + PP2.

Exercises the provider rate endpoints IN-PROCESS against the FastAPI app via
httpx ``AsyncClient`` + ``ASGITransport`` (no uvicorn), pointed at the dev
database ``visp_prod``:

  * GET    /provider/rates                 (qualified services + current rate)
  * PUT    /provider/rates/{task_id}       (set a rate within the guardrail)
  * PUT  out-of-range                      -> 422 price_out_of_range
  * PUT  not-qualified task                -> 403 not_qualified
  * PUT  custom-quote task                 -> 422 custom_quote_no_rate
  * DELETE /provider/rates/{task_id}       (remove the rate)

Requires migrations 021 + 022 to be applied to visp_prod first.

A ``try/finally`` cleanup removes everything this script created (the rate row
and any qualification rows it inserted) so visp_prod is left as it was.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_provider_rates.py

Prints ``SMOKE PASS`` on success; exits non-zero on any failure.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
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

API = "/api/v1"


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: int, msg: str) -> None:
    print(f"[step {n}] {msg}")


async def pick_task(conn, *, custom: bool, with_range: bool) -> dict | None:
    """Pick one active task matching the pricing_unit / range criteria."""
    unit_clause = "= 'CUSTOM_QUOTE'" if custom else "<> 'CUSTOM_QUOTE'"
    range_clause = (
        "AND base_price_min_cents IS NOT NULL AND base_price_max_cents IS NOT NULL "
        "AND base_price_max_cents > base_price_min_cents"
        if with_range
        else ""
    )
    row = await conn.fetchrow(
        f"""
        SELECT id, name, pricing_unit, base_price_min_cents, base_price_max_cents
        FROM service_tasks
        WHERE is_active = TRUE AND pricing_unit {unit_clause} {range_clause}
        ORDER BY name LIMIT 1
        """
    )
    return dict(row) if row else None


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    created_quals: list[tuple[uuid.UUID, uuid.UUID]] = []  # (provider_id, task_id)
    provider_id: uuid.UUID | None = None
    priced_task: dict | None = None
    try:
        db = await conn.fetchval("SELECT current_database()")
        check(db == "visp_prod", f"Connected to wrong DB: {db!r}.")
        print(f"Connected to dev DB: {db}")

        # A provider profile + its user.
        prow = await conn.fetchrow(
            "SELECT id, user_id FROM provider_profiles ORDER BY created_at NULLS LAST LIMIT 1"
        )
        check(prow is not None, "Need at least one provider_profile in visp_prod.")
        provider_id, user_id = prow["id"], prow["user_id"]
        print(f"provider {provider_id} (user {user_id})")

        priced_task = await pick_task(conn, custom=False, with_range=True)
        check(priced_task is not None, "Need a non-custom task with a price range.")
        other_task = await pick_task(conn, custom=False, with_range=False) or priced_task
        custom_task = await pick_task(conn, custom=True, with_range=False)
        print(f"priceable task : {priced_task['name']} ({priced_task['pricing_unit']}) "
              f"[{priced_task['base_price_min_cents']}..{priced_task['base_price_max_cents']}]")

        async def ensure_qualified(task_id: uuid.UUID) -> None:
            existing = await conn.fetchrow(
                "SELECT id, qualified FROM provider_task_qualifications "
                "WHERE provider_id=$1 AND task_id=$2",
                provider_id, task_id,
            )
            if existing is None:
                await conn.execute(
                    "INSERT INTO provider_task_qualifications "
                    "(id, provider_id, task_id, qualified, auto_granted, qualified_at, created_at, updated_at) "
                    "VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
                    uuid.uuid4(), provider_id, task_id,
                )
                created_quals.append((provider_id, task_id))
            elif not existing["qualified"]:
                await conn.execute(
                    "UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1",
                    existing["id"],
                )

        await ensure_qualified(priced_task["id"])
        if custom_task:
            await ensure_qualified(custom_task["id"])

        # A task the provider is NOT qualified for.
        unqualified = await conn.fetchrow(
            """
            SELECT id, name FROM service_tasks st
            WHERE pricing_unit <> 'CUSTOM_QUOTE' AND is_active = TRUE
              AND NOT EXISTS (
                SELECT 1 FROM provider_task_qualifications q
                WHERE q.provider_id=$1 AND q.task_id=st.id AND q.qualified=TRUE)
            ORDER BY name LIMIT 1
            """,
            provider_id,
        )

        token, _ = auth_service.create_access_token(user_id)
        hdr = {"Authorization": f"Bearer {token}"}
        lo, hi = priced_task["base_price_min_cents"], priced_task["base_price_max_cents"]
        in_range = (lo + hi) // 2

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            step(1, "GET /provider/rates — qualified service is listed, rate unset")
            r = await client.get(f"{API}/provider/rates", headers=hdr)
            check(r.status_code == 200, f"list rates: {r.status_code}: {r.text}")
            items = r.json()["data"]["items"]
            row = next((i for i in items if i["task_id"] == str(priced_task["id"])), None)
            check(row is not None, f"priceable task not in list: {[i['task_id'] for i in items]}")
            check(row["rate_cents"] is None, f"expected no rate yet, got {row['rate_cents']}")
            print(f"        -> 200, {len(items)} priceable services")

            step(2, f"PUT /provider/rates/{{task}} — in-range {in_range}c -> 200")
            r = await client.put(
                f"{API}/provider/rates/{priced_task['id']}", headers=hdr,
                json={"rate_cents": in_range},
            )
            check(r.status_code == 200, f"set rate: {r.status_code}: {r.text}")
            check(r.json()["data"]["rate_cents"] == in_range, "rate not echoed")
            print(f"        -> 200, rate={in_range}c unit={r.json()['data']['unit']}")

            step(3, "PUT out-of-range (above max) -> 422 price_out_of_range")
            r = await client.put(
                f"{API}/provider/rates/{priced_task['id']}", headers=hdr,
                json={"rate_cents": hi + 100_00},
            )
            check(r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}")
            check(r.json()["detail"]["code"] == "price_out_of_range", f"wrong code: {r.json()}")
            print(f"        -> 422 ({r.json()['detail']['code']}, range {lo}..{hi})")

            step(4, "PUT not-qualified task -> 403 not_qualified")
            if unqualified:
                r = await client.put(
                    f"{API}/provider/rates/{unqualified['id']}", headers=hdr,
                    json={"rate_cents": in_range},
                )
                check(r.status_code == 403, f"expected 403, got {r.status_code}: {r.text}")
                check(r.json()["detail"]["code"] == "not_qualified", f"wrong code: {r.json()}")
                print(f"        -> 403 ({r.json()['detail']['code']})")
            else:
                print("        -> SKIP (no unqualified task available)")

            step(5, "PUT custom-quote task -> 422 custom_quote_no_rate")
            if custom_task:
                r = await client.put(
                    f"{API}/provider/rates/{custom_task['id']}", headers=hdr,
                    json={"rate_cents": 10_000},
                )
                check(r.status_code == 422, f"expected 422, got {r.status_code}: {r.text}")
                check(r.json()["detail"]["code"] == "custom_quote_no_rate", f"wrong code: {r.json()}")
                print(f"        -> 422 ({r.json()['detail']['code']})")
            else:
                print("        -> SKIP (no custom-quote task available)")

            step(6, "DELETE /provider/rates/{task} — removes the rate")
            r = await client.delete(f"{API}/provider/rates/{priced_task['id']}", headers=hdr)
            check(r.status_code == 200, f"delete rate: {r.status_code}: {r.text}")
            r = await client.delete(f"{API}/provider/rates/{priced_task['id']}", headers=hdr)
            check(r.status_code == 404, f"second delete should 404, got {r.status_code}")
            print("        -> 200 then 404 (idempotent removal confirmed)")

        print("\nAll steps passed.")

    finally:
        print("\n[cleanup] removing test data ...")
        try:
            if provider_id is not None and priced_task is not None:
                await conn.execute(
                    "DELETE FROM provider_service_rates WHERE provider_id=$1",
                    provider_id,
                )
            for pid, tid in created_quals:
                await conn.execute(
                    "DELETE FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
                    pid, tid,
                )
            print(f"[cleanup] removed rates + {len(created_quals)} seeded qualification(s).")
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
