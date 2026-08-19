"""
End-to-end smoke test for VISP for Business (SP1) — the company flow.

Runs the full flow IN-PROCESS against the FastAPI app using httpx
``AsyncClient`` + ``ASGITransport`` (no uvicorn), pointed at the dev
database ``visp_prod``. Every step asserts HTTP status + key fields, then a
``try/finally`` cleanup removes everything the script created so visp_prod is
left exactly as it was.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_company.py

The app reads ``DATABASE_URL`` via ``src/core/config.py`` at import time, so
it MUST be set in the environment before this module imports the app. The
command above does that. Prints ``SMOKE PASS`` on success; raises / exits
non-zero on any failure.
"""

from __future__ import annotations

import asyncio
import io
import os
import sys
import uuid
from pathlib import Path

# Ensure the backend root (parent of scripts/) is importable as ``src.*``
# regardless of the current working directory.
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
from src.services import auth_service, admin_service  # noqa: E402

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


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: int, msg: str) -> None:
    print(f"[step {n}] {msg}")


async def fetch_test_data(conn: asyncpg.Connection) -> dict:
    """Pick two users with no existing company membership (user A / user B) and
    two real service_task ids. Verify an active superuser exists."""
    users = await conn.fetch(
        """
        SELECT u.id, u.email FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = u.id)
        ORDER BY u.created_at NULLS LAST
        LIMIT 5
        """
    )
    check(len(users) >= 2, "Need at least 2 users with no company membership in visp_prod.")
    user_a = (users[0]["id"], users[0]["email"])
    user_b = (users[1]["id"], users[1]["email"])

    tasks = await conn.fetch("SELECT id FROM service_tasks ORDER BY id LIMIT 2")
    check(len(tasks) == 2, "Need at least 2 service_tasks in visp_prod.")
    task_ids = [t["id"] for t in tasks]

    su = await conn.fetchrow("SELECT id FROM superusers WHERE is_active = true LIMIT 1")
    check(su is not None, "No active superuser found in visp_prod.")
    superuser_id = su["id"]

    return {
        "user_a": user_a,
        "user_b": user_b,
        "task_ids": task_ids,
        "superuser_id": superuser_id,
    }


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    try:
        db = await conn.fetchval("SELECT current_database()")
        check(db == "visp_prod", f"Connected to wrong DB: {db!r} (expected visp_prod).")
        print(f"Connected to dev DB: {db}")

        data = await fetch_test_data(conn)
        (user_a_id, user_a_email) = data["user_a"]
        (user_b_id, user_b_email) = data["user_b"]
        task_ids = data["task_ids"]
        superuser_id = data["superuser_id"]
        print(f"user A (admin)        : {user_a_email} ({user_a_id})")
        print(f"user B (collaborator) : {user_b_email} ({user_b_id})")
        print(f"service tasks         : {[str(t) for t in task_ids]}")
        print(f"superuser (admin tok) : {superuser_id}")

        # Mint tokens directly (no login round-trip).
        token_a, _ = auth_service.create_access_token(user_a_id)
        token_b, _ = auth_service.create_access_token(user_b_id)
        admin_token = admin_service.create_admin_tokens(superuser_id)["accessToken"]

        hdr_a = {"Authorization": f"Bearer {token_a}"}
        hdr_b = {"Authorization": f"Bearer {token_b}"}
        hdr_admin = {"Authorization": f"Bearer {admin_token}"}

        company_id: str | None = None

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            # 1. user A creates a company -> 201, draft.
            step(1, "POST /companies (user A)")
            r = await client.post(
                f"{API}/companies",
                headers=hdr_a,
                json={"legal_name": "SMOKE TEST CO", "phone": "4165550000"},
            )
            check(r.status_code == 201, f"create company: expected 201, got {r.status_code}: {r.text}")
            body = r.json()["data"]
            check(body["status"] == "draft", f"new company status expected draft, got {body['status']!r}")
            company_id = body["id"]
            print(f"        -> 201, company {company_id}, status=draft")

            # 2. GET /companies/me -> 200, one admin member (user A), serialized cleanly.
            step(2, "GET /companies/me (user A) — validates selectinload of members/documents")
            r = await client.get(f"{API}/companies/me", headers=hdr_a)
            check(r.status_code == 200, f"get me: expected 200, got {r.status_code}: {r.text}")
            body = r.json()["data"]
            check(body["status"] == "draft", f"me status expected draft, got {body['status']!r}")
            members = body["members"]
            check(len(members) == 1, f"expected 1 member, got {len(members)}")
            check(members[0]["role"] == "admin", f"expected member role admin, got {members[0]['role']!r}")
            check(
                members[0]["user_id"] == str(user_a_id),
                f"expected member user_id {user_a_id}, got {members[0]['user_id']}",
            )
            check(body["documents"] == [], f"expected no documents yet, got {body['documents']}")
            print("        -> 200, 1 admin member (user A), members/documents serialized OK")

            # 3. PUT /companies/me/services -> 200, two enabled tasks.
            step(3, "PUT /companies/me/services (user A)")
            r = await client.put(
                f"{API}/companies/me/services",
                headers=hdr_a,
                json={"all": False, "task_ids": [str(t) for t in task_ids]},
            )
            check(r.status_code == 200, f"set services: expected 200, got {r.status_code}: {r.text}")
            enabled = r.json()["data"]["enabled_task_ids"]
            check(len(enabled) == 2, f"expected 2 enabled tasks, got {len(enabled)}: {enabled}")
            check(
                set(enabled) == {str(t) for t in task_ids},
                f"enabled task ids mismatch: {enabled}",
            )
            print(f"        -> 200, enabled_task_ids has 2")

            # 4. POST /companies/me/invites -> 201, returns a code.
            step(4, "POST /companies/me/invites (user A invites user B)")
            r = await client.post(
                f"{API}/companies/me/invites",
                headers=hdr_a,
                json={"email": user_b_email, "role": "collaborator"},
            )
            check(r.status_code == 201, f"create invite: expected 201, got {r.status_code}: {r.text}")
            inv = r.json()["data"]
            check(inv["role"] == "collaborator", f"invite role expected collaborator, got {inv['role']!r}")
            invite_code = inv["code"]
            check(bool(invite_code), "invite code missing")
            print(f"        -> 201, invite code={invite_code}")

            # 5. POST /companies/redeem-invite (user B) -> 200, collaborator, same company.
            step(5, "POST /companies/redeem-invite (user B)")
            r = await client.post(
                f"{API}/companies/redeem-invite",
                headers=hdr_b,
                json={"code": invite_code},
            )
            check(r.status_code == 200, f"redeem invite: expected 200, got {r.status_code}: {r.text}")
            mem = r.json()["data"]
            check(mem["role"] == "collaborator", f"redeem role expected collaborator, got {mem['role']!r}")
            check(
                mem["company_id"] == company_id,
                f"redeem company_id {mem['company_id']} != {company_id}",
            )
            print("        -> 200, user B is collaborator on the same company")

            # 6. POST /companies/me/documents (multipart) -> 201, pending.
            step(6, "POST /companies/me/documents (user A, banking)")
            file_bytes = b"%PDF-1.4 smoke-test banking document\n"
            files = {"file": ("banking.pdf", io.BytesIO(file_bytes), "application/pdf")}
            r = await client.post(
                f"{API}/companies/me/documents",
                headers=hdr_a,
                data={"doc_type": "banking"},
                files=files,
            )
            check(r.status_code == 201, f"upload doc: expected 201, got {r.status_code}: {r.text}")
            doc = r.json()["data"]
            check(doc["status"] == "pending", f"doc status expected pending, got {doc['status']!r}")
            check(doc["doc_type"] == "banking", f"doc_type expected banking, got {doc['doc_type']!r}")
            doc_id = doc["id"]
            print(f"        -> 201, document {doc_id}, status=pending")

            # 7. POST /companies/me/submit -> 200, pending_review.
            step(7, "POST /companies/me/submit (user A)")
            r = await client.post(f"{API}/companies/me/submit", headers=hdr_a)
            check(r.status_code == 200, f"submit: expected 200, got {r.status_code}: {r.text}")
            check(
                r.json()["data"]["status"] == "pending_review",
                f"submit status expected pending_review, got {r.json()['data']['status']!r}",
            )
            print("        -> 200, status=pending_review")

            # 8. admin lists pending_review companies -> includes ours.
            step(8, "GET /admin/companies?status=pending_review (admin)")
            r = await client.get(
                f"{API}/admin/companies", headers=hdr_admin, params={"status": "pending_review"}
            )
            check(r.status_code == 200, f"admin list: expected 200, got {r.status_code}: {r.text}")
            rows = r.json()["data"]
            ids = {c["id"] for c in rows}
            check(company_id in ids, f"our company {company_id} not in pending_review list")
            print(f"        -> 200, list of {len(rows)} includes our company")

            # 9. admin gets company detail -> documents include our doc (selectinload).
            step(9, "GET /admin/companies/{id} (admin) — validates get_company selectinload")
            r = await client.get(f"{API}/admin/companies/{company_id}", headers=hdr_admin)
            check(r.status_code == 200, f"admin get: expected 200, got {r.status_code}: {r.text}")
            detail = r.json()["data"]
            doc_ids = {d["id"] for d in detail["documents"]}
            check(doc_id in doc_ids, f"our doc {doc_id} not in admin company documents")
            print("        -> 200, documents include our banking doc")

            # 10. admin approves the document -> approved.
            step(10, "POST /admin/companies/documents/{doc_id}/approve (admin)")
            r = await client.post(
                f"{API}/admin/companies/documents/{doc_id}/approve", headers=hdr_admin
            )
            check(r.status_code == 200, f"approve doc: expected 200, got {r.status_code}: {r.text}")
            check(
                r.json()["data"]["status"] == "approved",
                f"doc status expected approved, got {r.json()['data']['status']!r}",
            )
            print("        -> 200, document status=approved")

            # 11. admin validates the company -> validated.
            step(11, "POST /admin/companies/{id}/validate (admin)")
            r = await client.post(f"{API}/admin/companies/{company_id}/validate", headers=hdr_admin)
            check(r.status_code == 200, f"validate: expected 200, got {r.status_code}: {r.text}")
            check(
                r.json()["data"]["status"] == "validated",
                f"company status expected validated, got {r.json()['data']['status']!r}",
            )
            print("        -> 200, company status=validated")

        print("\nAll 11 steps passed.")

    finally:
        # -------------------------------------------------------------------
        # Cleanup — runs even on failure. Delete the created company (FK
        # cascade removes members, documents, services, invites). Verify no
        # 'SMOKE TEST CO' row remains.
        # -------------------------------------------------------------------
        print("\n[cleanup] removing test data ...")
        try:
            deleted = await conn.execute("DELETE FROM companies WHERE legal_name = 'SMOKE TEST CO'")
            print(f"[cleanup] {deleted}")
            # Defensive: remove any stray membership for user B (cascade should
            # have handled it, but assert nothing leaks).
            await conn.execute(
                "DELETE FROM company_members WHERE company_id NOT IN (SELECT id FROM companies)"
            )
            remaining = await conn.fetchval(
                "SELECT count(*) FROM companies WHERE legal_name = 'SMOKE TEST CO'"
            )
            print(f"[cleanup] remaining 'SMOKE TEST CO' companies: {remaining}")
            check(remaining == 0, f"cleanup failed: {remaining} SMOKE TEST CO companies remain")
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
