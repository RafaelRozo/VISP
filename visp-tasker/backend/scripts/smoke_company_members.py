"""
End-to-end smoke test for VISP for Business — member & invite management.

Exercises the additive company-dashboard endpoints IN-PROCESS against the
FastAPI app via httpx ``AsyncClient`` + ``ASGITransport`` (no uvicorn),
pointed at the dev database ``visp_prod``:

  * enriched members list (real first_name / last_name / email)
  * GET    /companies/me/invites      (list pending invites, with code)
  * DELETE /companies/me/invites/{id} (revoke a pending invite)
  * DELETE /companies/me/members/{id} (soft-remove -> DISABLED)
  * admin-only guards (a non-admin gets 403)

Every step asserts; a ``try/finally`` cleanup removes everything created so
visp_prod is left exactly as it was.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_company_members.py

Prints ``SMOKE PASS`` on success; exits non-zero on any failure.
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
COMPANY_NAME = "SMOKE MEMBERS CO"



class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: int, msg: str) -> None:
    print(f"[step {n}] {msg}")


async def fetch_test_data(conn: asyncpg.Connection) -> dict:
    """Pick three users (A admin, B + C collaborators) with no existing company
    membership, each with a populated first_name/last_name/email."""
    users = await conn.fetch(
        """
        SELECT u.id, u.email, u.first_name, u.last_name FROM users u
        WHERE NOT EXISTS (SELECT 1 FROM company_members m WHERE m.user_id = u.id)
          AND u.first_name IS NOT NULL AND u.last_name IS NOT NULL
        ORDER BY u.created_at NULLS LAST
        LIMIT 5
        """
    )
    check(len(users) >= 3, "Need at least 3 unaffiliated users with names in visp_prod.")
    return {
        "user_a": users[0],
        "user_b": users[1],
        "user_c": users[2],
    }


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    try:
        db = await conn.fetchval("SELECT current_database()")
        check(db == "visp_prod", f"Connected to wrong DB: {db!r} (expected visp_prod).")
        print(f"Connected to dev DB: {db}")

        data = await fetch_test_data(conn)
        ua, ub, uc = data["user_a"], data["user_b"], data["user_c"]
        print(f"user A (admin)        : {ua['email']} ({ua['id']})")
        print(f"user B (collaborator) : {ub['email']} ({ub['id']})")
        print(f"user C (non-member)   : {uc['email']} ({uc['id']})")

        token_a, _ = auth_service.create_access_token(ua["id"])
        token_b, _ = auth_service.create_access_token(ub["id"])
        token_c, _ = auth_service.create_access_token(uc["id"])
        hdr_a = {"Authorization": f"Bearer {token_a}"}
        hdr_b = {"Authorization": f"Bearer {token_b}"}
        hdr_c = {"Authorization": f"Bearer {token_c}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            # 1. user A creates a company.
            step(1, "POST /companies (user A)")
            r = await client.post(
                f"{API}/companies",
                headers=hdr_a,
                json={"legal_name": COMPANY_NAME, "phone": "4165550001"},
            )
            check(r.status_code == 201, f"create company: {r.status_code}: {r.text}")
            company_id = r.json()["data"]["id"]
            print(f"        -> 201, company {company_id}")

            # 2. admin member is serialized WITH the real identity fields.
            step(2, "GET /companies/me — admin member has first_name/last_name/email")
            r = await client.get(f"{API}/companies/me", headers=hdr_a)
            check(r.status_code == 200, f"get me: {r.status_code}: {r.text}")
            members = r.json()["data"]["members"]
            check(len(members) == 1, f"expected 1 member, got {len(members)}")
            adm = members[0]
            for f in ("first_name", "last_name", "display_name", "email"):
                check(f in adm, f"member missing field {f!r}: {adm}")
            check(adm["first_name"] == ua["first_name"], f"admin first_name {adm['first_name']!r} != {ua['first_name']!r}")
            check(adm["last_name"] == ua["last_name"], f"admin last_name {adm['last_name']!r} != {ua['last_name']!r}")
            check(adm["email"] == ua["email"], f"admin email {adm['email']!r} != {ua['email']!r}")
            print(f"        -> 200, admin enriched: {adm['first_name']} {adm['last_name']} <{adm['email']}>")

            # 3. invite user B and a second invite user C.
            step(3, "POST /companies/me/invites x2 (B, C)")
            r = await client.post(
                f"{API}/companies/me/invites", headers=hdr_a,
                json={"email": ub["email"], "role": "collaborator"},
            )
            check(r.status_code == 201, f"invite B: {r.status_code}: {r.text}")
            invite_b = r.json()["data"]
            code_b = invite_b["code"]
            r = await client.post(
                f"{API}/companies/me/invites", headers=hdr_a,
                json={"email": uc["email"], "role": "supervisor"},
            )
            check(r.status_code == 201, f"invite C: {r.status_code}: {r.text}")
            invite_c_id = r.json()["data"]["id"]
            print(f"        -> 201 x2 (B code={code_b}, C id={invite_c_id})")

            # 4. list invites — both pending, codes present.
            step(4, "GET /companies/me/invites — lists both pending with codes")
            r = await client.get(f"{API}/companies/me/invites", headers=hdr_a)
            check(r.status_code == 200, f"list invites: {r.status_code}: {r.text}")
            inv_rows = r.json()["data"]
            by_email = {i["email"]: i for i in inv_rows}
            check(ub["email"] in by_email, f"B invite missing from list: {inv_rows}")
            check(uc["email"] in by_email, f"C invite missing from list: {inv_rows}")
            check(by_email[ub["email"]]["code"] == code_b, "B invite code mismatch in list")
            check(by_email[ub["email"]]["status"] == "pending", "B invite not pending")
            check(by_email[uc["email"]]["role"] == "supervisor", "C invite role mismatch")
            print(f"        -> 200, {len(inv_rows)} invites, both pending with codes")

            # 5. non-admin (user C, not a member) -> 403 on admin-only endpoints.
            step(5, "admin-only guard: user C gets 403 on list/revoke/remove")
            r = await client.get(f"{API}/companies/me/invites", headers=hdr_c)
            check(r.status_code in (403, 404), f"guard list invites: expected 403/404, got {r.status_code}")
            r = await client.delete(f"{API}/companies/me/invites/{invite_c_id}", headers=hdr_c)
            check(r.status_code in (403, 404), f"guard revoke: expected 403/404, got {r.status_code}")
            r = await client.delete(f"{API}/companies/me/members/{adm['id']}", headers=hdr_c)
            check(r.status_code in (403, 404), f"guard remove member: expected 403/404, got {r.status_code}")
            print("        -> 403/404 for non-member on all admin-only endpoints")

            # 6. user B redeems invite -> becomes a member.
            step(6, "POST /companies/redeem-invite (user B)")
            r = await client.post(f"{API}/companies/redeem-invite", headers=hdr_b, json={"code": code_b})
            check(r.status_code == 200, f"redeem B: {r.status_code}: {r.text}")
            print("        -> 200, user B is now a member")

            # 7. members list now includes B with real identity.
            step(7, "GET /companies/me — B appears enriched")
            r = await client.get(f"{API}/companies/me", headers=hdr_a)
            check(r.status_code == 200, f"get me: {r.status_code}: {r.text}")
            members = r.json()["data"]["members"]
            mb = next((m for m in members if m["user_id"] == str(ub["id"])), None)
            check(mb is not None, f"user B not in members: {members}")
            check(mb["first_name"] == ub["first_name"], f"B first_name {mb['first_name']!r} != {ub['first_name']!r}")
            check(mb["last_name"] == ub["last_name"], f"B last_name {mb['last_name']!r} != {ub['last_name']!r}")
            check(mb["email"] == ub["email"], f"B email {mb['email']!r} != {ub['email']!r}")
            check(mb["status"] == "active", f"B status expected active, got {mb['status']!r}")
            member_b_id = mb["id"]
            print(f"        -> 200, B enriched: {mb['first_name']} {mb['last_name']} <{mb['email']}>")

            # 8. guard: admin cannot remove self (last admin).
            step(8, "DELETE /companies/me/members/{self} — 400 (cannot remove self / last admin)")
            r = await client.delete(f"{API}/companies/me/members/{adm['id']}", headers=hdr_a)
            check(r.status_code == 400, f"remove self: expected 400, got {r.status_code}: {r.text}")
            print(f"        -> 400 ({r.json().get('detail')!r})")

            # 9. remove member B -> DISABLED.
            step(9, "DELETE /companies/me/members/{B} — soft-remove to DISABLED")
            r = await client.delete(f"{API}/companies/me/members/{member_b_id}", headers=hdr_a)
            check(r.status_code == 200, f"remove B: {r.status_code}: {r.text}")
            check(r.json()["data"]["status"] == "disabled", f"B status after remove: {r.json()['data']}")
            # Confirm in DB.
            b_status = await conn.fetchval(
                "SELECT status FROM company_members WHERE id = $1", uuid.UUID(member_b_id)
            )
            check(str(b_status).lower().endswith("disabled"), f"B member DB status: {b_status!r}")
            print(f"        -> 200, B status=disabled (DB confirms: {b_status})")

            # 10. revoke C's pending invite -> 204, gone from list.
            step(10, "DELETE /companies/me/invites/{C} — revoke pending invite")
            r = await client.delete(f"{API}/companies/me/invites/{invite_c_id}", headers=hdr_a)
            check(r.status_code == 204, f"revoke C: expected 204, got {r.status_code}: {r.text}")
            r = await client.get(f"{API}/companies/me/invites", headers=hdr_a)
            check(r.status_code == 200, f"list after revoke: {r.status_code}")
            remaining_ids = {i["id"] for i in r.json()["data"]}
            check(invite_c_id not in remaining_ids, f"C invite still present after revoke: {remaining_ids}")
            print("        -> 204, C invite removed from list")

            # 11. revoking a redeemed invite -> 400.
            step(11, "DELETE /companies/me/invites/{B-redeemed} — 400 already redeemed")
            r = await client.delete(f"{API}/companies/me/invites/{invite_b['id']}", headers=hdr_a)
            check(r.status_code == 400, f"revoke redeemed: expected 400, got {r.status_code}: {r.text}")
            print(f"        -> 400 ({r.json().get('detail')!r})")

            # 12. revoking / removing a non-existent id -> 404.
            step(12, "404 guards for unknown invite/member ids")
            ghost = str(uuid.uuid4())
            r = await client.delete(f"{API}/companies/me/invites/{ghost}", headers=hdr_a)
            check(r.status_code == 404, f"revoke unknown: expected 404, got {r.status_code}")
            r = await client.delete(f"{API}/companies/me/members/{ghost}", headers=hdr_a)
            check(r.status_code == 404, f"remove unknown: expected 404, got {r.status_code}")
            print("        -> 404 for unknown ids")

        print("\nAll 12 steps passed.")

    finally:
        # -------------------------------------------------------------------
        # Cleanup — runs even on failure. Deleting the company FK-cascades
        # members, documents, services, invites.
        # -------------------------------------------------------------------
        print("\n[cleanup] removing test data ...")
        try:
            deleted = await conn.execute(
                "DELETE FROM companies WHERE legal_name = $1", COMPANY_NAME
            )
            print(f"[cleanup] {deleted}")
            await conn.execute(
                "DELETE FROM company_members WHERE company_id NOT IN (SELECT id FROM companies)"
            )
            remaining = await conn.fetchval(
                "SELECT count(*) FROM companies WHERE legal_name = $1", COMPANY_NAME
            )
            print(f"[cleanup] remaining '{COMPANY_NAME}' companies: {remaining}")
            check(remaining == 0, f"cleanup failed: {remaining} {COMPANY_NAME} companies remain")
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
