"""
End-to-end smoke test for VISP for Business (SP4 Stage 1) — the company
supervisor->collaborator job-assignment flow.

Runs the full flow IN-PROCESS against the FastAPI app using httpx
``AsyncClient`` + ``ASGITransport`` (no uvicorn), pointed at the dev database
``visp_prod``. Every step asserts HTTP status + key fields. A ``try/finally``
cleanup removes everything the script created so visp_prod is left exactly as it
was, and prints verification counts.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_company_assignment.py

The app reads ``DATABASE_URL`` via ``src/core/config.py`` at import time, so it
MUST be set in the environment before this module imports the app. Prints
``SMOKE PASS`` on success; raises / exits non-zero on any failure.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from pathlib import Path

# Ensure the backend root (parent of scripts/) is importable as ``src.*``.
_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

# ---------------------------------------------------------------------------
# Safety: refuse to run against anything other than the la base visp_prod.
# ---------------------------------------------------------------------------

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

# Importing the app triggers settings load (reads DATABASE_URL from env).
from src.main import app  # noqa: E402
from src.api.deps import async_session_factory  # noqa: E402
from src.services import auth_service  # noqa: E402
from src.services import company_assignment_service as casvc  # noqa: E402

from src.core.config import settings  # noqa: E402

# La conexión sale del .env (settings.database_url): este script NO lleva
# credenciales dentro. Se niega a correr si no es la base real.
_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)


API = "/api/v1"

# Raw asyncpg connection params (mirrors DATABASE_URL above) for setup/cleanup
# queries that bypass the app.

SMOKE_TAG = "SMOKE-ASSIGN"  # used in legal_name / reference_number to find our rows


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: int, msg: str) -> None:
    print(f"[step {n}] {msg}")


# ---------------------------------------------------------------------------
# Setup helpers (raw SQL, bypassing the app)
# ---------------------------------------------------------------------------


async def fetch_seed(conn: asyncpg.Connection) -> dict:
    """Pick three users with no company membership (A=supervisor, B/C=collabs)
    and a credential-requiring service task, plus a non-cred task for variety."""
    users = await conn.fetch(
        """
        SELECT u.id, u.email, u.first_name, u.last_name FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = u.id)
          AND NOT EXISTS (SELECT 1 FROM provider_profiles p WHERE p.user_id = u.id)
        ORDER BY u.created_at NULLS LAST
        LIMIT 5
        """
    )
    check(len(users) >= 3, "Need at least 3 free users (no company, no provider profile) in visp_prod.")

    cred_task = await conn.fetchrow(
        """
        SELECT id, level FROM service_tasks
        WHERE (license_required OR certification_required) AND is_active
        ORDER BY id LIMIT 1
        """
    )
    check(cred_task is not None, "Need at least one credential-requiring active service_task in visp_prod.")

    return {
        "user_a": (users[0]["id"], users[0]["email"]),
        "user_b": (users[1]["id"], users[1]["email"]),
        "user_c": (users[2]["id"], users[2]["email"]),
        # Collaborator B's name, used to assert the customer-facing
        # assigned-collaborator endpoint surfaces the right person.
        "user_b_first_name": users[1]["first_name"],
        "user_b_last_name": users[1]["last_name"],
        "task_id": cred_task["id"],
        "task_level": cred_task["level"],
    }


async def insert_company(conn: asyncpg.Connection) -> uuid.UUID:
    return await conn.fetchval(
        """
        INSERT INTO companies (legal_name, status, stripe_account_id)
        VALUES ($1, 'VALIDATED', 'acct_smoke')
        RETURNING id
        """,
        f"{SMOKE_TAG} CO",
    )


async def insert_member(
    conn: asyncpg.Connection, company_id: uuid.UUID, user_id: uuid.UUID, role: str
) -> None:
    await conn.execute(
        """
        INSERT INTO company_members (company_id, user_id, role, status)
        VALUES ($1, $2, $3, 'ACTIVE')
        """,
        company_id,
        user_id,
        role,
    )


async def insert_provider_profile(
    conn: asyncpg.Connection, user_id: uuid.UUID, level: str
) -> uuid.UUID:
    # ``level`` is the stored provider_level enum label (e.g. 'LEVEL_3'), read
    # straight off the task row — pass it through unchanged.
    return await conn.fetchval(
        """
        INSERT INTO provider_profiles (user_id, status, current_level)
        VALUES ($1, 'ACTIVE', $2)
        RETURNING id
        """,
        user_id,
        level,
    )


async def insert_credential(
    conn: asyncpg.Connection, provider_id: uuid.UUID, task_id: uuid.UUID
) -> uuid.UUID:
    return await conn.fetchval(
        """
        INSERT INTO provider_credentials
            (provider_id, credential_type, task_id, name, status, verified_at)
        VALUES ($1, 'LICENSE', $2, $3, 'VERIFIED', now())
        RETURNING id
        """,
        provider_id,
        task_id,
        f"{SMOKE_TAG} license",
    )


async def enable_company_service(
    conn: asyncpg.Connection, company_id: uuid.UUID, task_id: uuid.UUID
) -> None:
    await conn.execute(
        "INSERT INTO company_services (company_id, task_id) VALUES ($1, $2)",
        company_id,
        task_id,
    )


async def insert_claimable_job(
    conn: asyncpg.Connection, customer_id: uuid.UUID, task_id: uuid.UUID
) -> uuid.UUID:
    # reference_number is varchar(20); keep the prefix short but identifiable.
    ref = f"SMK-{uuid.uuid4().hex[:8].upper()}"
    return await conn.fetchval(
        """
        INSERT INTO jobs (
            reference_number, customer_id, task_id, status, priority,
            is_emergency, service_latitude, service_longitude, service_address,
            service_city, requested_date, service_country, currency
        )
        VALUES (
            $1, $2, $3, 'PENDING_MATCH', 'STANDARD',
            false, 43.6532, -79.3832, '123 Smoke St',
            'Toronto', CURRENT_DATE + 1, 'CA', 'CAD'
        )
        RETURNING id
        """,
        ref,
        customer_id,
        task_id,
    )


# ---------------------------------------------------------------------------
# Main flow
# ---------------------------------------------------------------------------


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    company_id: uuid.UUID | None = None
    job_id: uuid.UUID | None = None
    provider_ids: list[uuid.UUID] = []
    try:
        dbname = await conn.fetchval("SELECT current_database()")
        check(dbname == "visp_prod", f"Connected to wrong DB: {dbname!r} (expected visp_prod).")
        print(f"Connected to dev DB: {dbname}")

        seed = await fetch_seed(conn)
        (user_a_id, user_a_email) = seed["user_a"]
        (user_b_id, user_b_email) = seed["user_b"]
        (user_c_id, user_c_email) = seed["user_c"]
        user_b_first_name = seed["user_b_first_name"]
        user_b_last_name = seed["user_b_last_name"]
        task_id = seed["task_id"]
        task_level = seed["task_level"]
        print(f"supervisor (A)   : {user_a_email} ({user_a_id})")
        print(f"collab w/cred (B): {user_b_email} ({user_b_id})")
        print(f"collab no-cred(C): {user_c_email} ({user_c_id})")
        print(f"cred-required task: {task_id} (level={task_level})")

        # ---------------------------------------------------------------
        # DB setup (bypassing the app).
        # ---------------------------------------------------------------
        print("\n[setup] inserting validated company + members + service + job ...")
        company_id = await insert_company(conn)
        await insert_member(conn, company_id, user_a_id, "SUPERVISOR")
        await insert_member(conn, company_id, user_b_id, "COLLABORATOR")
        await insert_member(conn, company_id, user_c_id, "COLLABORATOR")

        pid_b = await insert_provider_profile(conn, user_b_id, str(task_level))
        pid_c = await insert_provider_profile(conn, user_c_id, str(task_level))
        provider_ids = [pid_b, pid_c]
        # Only B holds the required VERIFIED credential for the task.
        await insert_credential(conn, pid_b, task_id)

        await enable_company_service(conn, company_id, task_id)
        # Customer of the job: reuse supervisor's user as the customer party
        # (any users row works for the FK; this user is otherwise free).
        job_id = await insert_claimable_job(conn, user_a_id, task_id)
        print(f"[setup] company={company_id} job={job_id} providers={provider_ids}")

        # Mint JWTs for each role.
        token_a, _ = auth_service.create_access_token(user_a_id)
        token_b, _ = auth_service.create_access_token(user_b_id)
        hdr_a = {"Authorization": f"Bearer {token_a}"}
        hdr_b = {"Authorization": f"Bearer {token_b}"}

        cid = str(company_id)
        jid = str(job_id)

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            # 1. Supervisor lists claimable jobs -> the job appears.
            step(1, "GET claimable-jobs (supervisor A)")
            r = await client.get(f"{API}/companies/{cid}/claimable-jobs", headers=hdr_a)
            check(r.status_code == 200, f"claimable: expected 200, got {r.status_code}: {r.text}")
            ids = [j["job_id"] for j in r.json()["data"]]
            check(jid in ids, f"job {jid} not in claimable list: {ids}")
            print(f"        -> 200, job present in claimable list ({len(ids)} total)")

            # 2. Supervisor claims the job -> CLAIMED.
            step(2, "POST claim (supervisor A)")
            r = await client.post(f"{API}/companies/{cid}/jobs/{jid}/claim", headers=hdr_a)
            check(r.status_code == 201, f"claim: expected 201, got {r.status_code}: {r.text}")
            data = r.json()["data"]
            check(data["status"] == "claimed", f"claim status expected claimed, got {data['status']!r}")
            check(data["payout_target"] == "company", f"payout_target expected company, got {data['payout_target']!r}")
            assignment_id = data["id"]
            print(f"        -> 201, assignment {assignment_id}, status=claimed")

            db_status = await conn.fetchval(
                "SELECT status FROM company_job_assignments WHERE job_id = $1", job_id
            )
            check(str(db_status) == "CLAIMED", f"DB assignment status expected CLAIMED, got {db_status!r}")

            # 3. Supervisor lists eligible collaborators -> B present, C absent.
            step(3, "GET eligible-collaborators (supervisor A)")
            r = await client.get(
                f"{API}/companies/{cid}/jobs/{jid}/eligible-collaborators", headers=hdr_a
            )
            check(r.status_code == 200, f"eligible: expected 200, got {r.status_code}: {r.text}")
            elig_ids = {c["user_id"] for c in r.json()["data"]}
            check(str(user_b_id) in elig_ids, f"user B (has cred) missing from eligible: {elig_ids}")
            check(str(user_c_id) not in elig_ids, f"user C (no cred) wrongly eligible: {elig_ids}")
            print(f"        -> 200, B eligible, C absent ({len(elig_ids)} eligible)")

            # 4. Supervisor assigns to user C -> rejected (no credential).
            step(4, "POST assign to C — expect 400 (no required credential)")
            r = await client.post(
                f"{API}/companies/{cid}/jobs/{jid}/assign",
                headers=hdr_a,
                json={"collaborator_user_id": str(user_c_id)},
            )
            check(r.status_code == 400, f"assign C: expected 400, got {r.status_code}: {r.text}")
            print(f"        -> 400 rejected: {r.json().get('detail')!r}")

            # 5. Supervisor assigns to user B -> ASSIGNED.
            step(5, "POST assign to B — expect success (ASSIGNED)")
            r = await client.post(
                f"{API}/companies/{cid}/jobs/{jid}/assign",
                headers=hdr_a,
                json={"collaborator_user_id": str(user_b_id)},
            )
            check(r.status_code == 200, f"assign B: expected 200, got {r.status_code}: {r.text}")
            data = r.json()["data"]
            check(data["status"] == "assigned", f"assign status expected assigned, got {data['status']!r}")
            check(
                data["assigned_collaborator_id"] == str(user_b_id),
                f"assigned_collaborator_id expected {user_b_id}, got {data['assigned_collaborator_id']}",
            )
            print(f"        -> 200, status=assigned to B")

            # 6. As user B: list my assignments -> present; accept it -> ACCEPTED.
            step(6, "GET my-assignments + POST accept (collaborator B)")
            r = await client.get(f"{API}/companies/my-assignments", headers=hdr_b)
            check(r.status_code == 200, f"my-assignments: expected 200, got {r.status_code}: {r.text}")
            mine = r.json()["data"]
            check(
                any(a["id"] == assignment_id for a in mine),
                f"assignment {assignment_id} not in B's assignments: {[a['id'] for a in mine]}",
            )
            r = await client.post(
                f"{API}/companies/assignments/{assignment_id}/accept", headers=hdr_b
            )
            check(r.status_code == 200, f"accept: expected 200, got {r.status_code}: {r.text}")
            check(
                r.json()["data"]["status"] == "accepted",
                f"accept status expected accepted, got {r.json()['data']['status']!r}",
            )
            print("        -> 200, assignment in B's list, status=accepted")

            db_status = await conn.fetchval(
                "SELECT status FROM company_job_assignments WHERE job_id = $1", job_id
            )
            check(str(db_status) == "ACCEPTED", f"DB status expected ACCEPTED, got {db_status!r}")

            # 6b. Customer (job owner = user A) sees WHO was assigned, by name.
            step("6b", "GET assigned-collaborator (customer A) — expect B's name")
            r = await client.get(
                f"{API}/companies/jobs/{jid}/assigned-collaborator", headers=hdr_a
            )
            check(
                r.status_code == 200,
                f"assigned-collaborator: expected 200, got {r.status_code}: {r.text}",
            )
            cdata = r.json()["data"]
            check(cdata is not None, "assigned-collaborator data should not be None for a claimed job")
            check(
                cdata["assigned_collaborator_id"] == str(user_b_id),
                f"assigned_collaborator_id expected {user_b_id}, got {cdata['assigned_collaborator_id']}",
            )
            check(
                cdata["collaborator_first_name"] == user_b_first_name,
                f"collaborator_first_name expected {user_b_first_name!r}, got {cdata['collaborator_first_name']!r}",
            )
            check(
                cdata["collaborator_last_name"] == user_b_last_name,
                f"collaborator_last_name expected {user_b_last_name!r}, got {cdata['collaborator_last_name']!r}",
            )
            expected_name = (
                f"{user_b_first_name} {user_b_last_name[0]}.".strip()
                if user_b_last_name
                else (user_b_first_name or "")
            ).strip() or None
            check(
                cdata["collaborator_name"] == expected_name,
                f"collaborator_name expected {expected_name!r}, got {cdata['collaborator_name']!r}",
            )
            print(f"        -> 200, customer sees collaborator: {cdata['collaborator_name']!r}")

        # 7. resolve_payout_account -> the company's 'acct_smoke'.
        step(7, "resolve_payout_account(db, job_id) — expect 'acct_smoke'")
        async with async_session_factory() as db:
            acct = await casvc.resolve_payout_account(db, job_id)
        check(acct == "acct_smoke", f"resolve_payout_account expected 'acct_smoke', got {acct!r}")
        print(f"        -> payout routes to company account: {acct!r}")

    finally:
        # -------------------------------------------------------------------
        # Cleanup — runs even on failure, in dependency order.
        # -------------------------------------------------------------------
        print("\n[cleanup] removing test data ...")
        try:
            if job_id is not None:
                await conn.execute(
                    "DELETE FROM company_job_assignments WHERE job_id = $1", job_id
                )
                await conn.execute("DELETE FROM jobs WHERE id = $1", job_id)
            for pid in provider_ids:
                await conn.execute(
                    "DELETE FROM provider_credentials WHERE provider_id = $1", pid
                )
                await conn.execute("DELETE FROM provider_profiles WHERE id = $1", pid)
            if company_id is not None:
                # Cascade removes company_members + company_services.
                await conn.execute("DELETE FROM companies WHERE id = $1", company_id)

            # Verify nothing we created remains.
            remaining_companies = await conn.fetchval(
                "SELECT count(*) FROM companies WHERE legal_name = $1", f"{SMOKE_TAG} CO"
            )
            remaining_jobs = await conn.fetchval(
                "SELECT count(*) FROM jobs WHERE reference_number LIKE 'SMK-%'"
            )
            remaining_creds = await conn.fetchval(
                "SELECT count(*) FROM provider_credentials WHERE name = $1", f"{SMOKE_TAG} license"
            )
            remaining_profiles = (
                await conn.fetchval(
                    "SELECT count(*) FROM provider_profiles WHERE id = ANY($1::uuid[])",
                    provider_ids,
                )
                if provider_ids
                else 0
            )
            remaining_assigns = (
                await conn.fetchval(
                    "SELECT count(*) FROM company_job_assignments WHERE job_id = $1", job_id
                )
                if job_id is not None
                else 0
            )
            print(f"[cleanup] remaining companies        : {remaining_companies}")
            print(f"[cleanup] remaining jobs             : {remaining_jobs}")
            print(f"[cleanup] remaining credentials      : {remaining_creds}")
            print(f"[cleanup] remaining provider_profiles: {remaining_profiles}")
            print(f"[cleanup] remaining assignments      : {remaining_assigns}")
            check(
                remaining_companies == 0
                and remaining_jobs == 0
                and remaining_creds == 0
                and remaining_profiles == 0
                and remaining_assigns == 0,
                "cleanup failed: some smoke rows remain",
            )
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
