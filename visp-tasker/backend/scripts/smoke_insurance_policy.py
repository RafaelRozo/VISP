"""Smoke del ciclo completo de la póliza de seguro (WP1b).

Cubre: subida autenticada del proveedor -> cola del admin -> aprobar/rechazar ->
que el gate de seguro del motor lo vea. Se auto-limpia.

    ./venv/bin/python scripts/smoke_insurance_policy.py
"""

from __future__ import annotations

import asyncio
import io
import sys
import uuid
from datetime import date, timedelta

import httpx

sys.path.insert(0, ".")

from src.api.deps import async_session_factory  # noqa: E402
from src.main import app  # noqa: E402

passed = 0
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        failed.append(name)
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


def _doc() -> dict:
    return {"file": ("policy.pdf", io.BytesIO(b"%PDF-1.4 fake policy"), "application/pdf")}


def _fields(effective: date, expiry: date, coverage: int = 200_000_000) -> dict:
    return {
        "policyNumber": f"SMOKE-{uuid.uuid4().hex[:8].upper()}",
        "insurerName": "Intact Insurance",
        "coverageAmountCents": str(coverage),
        "effectiveDate": effective.isoformat(),
        "expiryDate": expiry.isoformat(),
        "policyType": "general_liability",
    }


async def main() -> int:
    print("=" * 72)
    print("SMOKE — ciclo de la póliza de seguro (WP1b)")
    print("=" * 72)

    from sqlalchemy import delete, select

    from src.models.provider import ProviderProfile
    from src.models.user import User
    from src.models.verification import InsuranceStatus, ProviderInsurancePolicy
    from src.services import provider_level_service as level_svc
    from src.services.admin_service import create_admin_tokens
    from src.models.superuser import SuperUser

    created: list[uuid.UUID] = []

    # --- tokens -------------------------------------------------------------
    async with async_session_factory() as db:
        row = (
            await db.execute(
                select(ProviderProfile, User)
                .join(User, ProviderProfile.user_id == User.id)
                .limit(1)
            )
        ).first()
        if row is None:
            print("  SIN PROVIDERS en la BD — no se puede probar.")
            return 1
        profile, prov_user = row
        provider_id = profile.id

        su = (await db.execute(select(SuperUser).limit(1))).scalar_one_or_none()

    from src.services.auth_service import create_access_token

    prov_token, _exp = create_access_token(prov_user.id)
    H_PROV = {"Authorization": f"Bearer {prov_token}"}

    admin_headers = None
    if su is not None:
        tokens = create_admin_tokens(su.id)
        admin_headers = {"Authorization": f"Bearer {tokens['accessToken']}"}

    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
        today = date.today()

        # --- 1. validaciones de entrada (todas deben ser 400, nunca 5xx) ----
        print("\n[1] Validaciones (400, nunca 5xx — Cloudflare envuelve los 5xx)")

        r = await c.post("/api/v1/provider/insurance", headers=H_PROV, files=_doc(),
                         data=_fields(today + timedelta(days=30), today + timedelta(days=10)))
        check("vencimiento antes del inicio -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/provider/insurance", headers=H_PROV, files=_doc(),
                         data=_fields(today - timedelta(days=400), today - timedelta(days=30)))
        check("póliza ya vencida -> 400", r.status_code == 400,
              (r.json().get("detail", "") if r.status_code == 400 else str(r.status_code))[:55])

        r = await c.post("/api/v1/provider/insurance", headers=H_PROV, files=_doc(),
                         data=_fields(today, today + timedelta(days=365), coverage=0))
        check("cobertura 0 -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/provider/insurance", headers=H_PROV, files=_doc(),
                         data={**_fields(today, today + timedelta(days=365)),
                               "effectiveDate": "no-es-fecha"})
        check("fecha basura -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/provider/insurance", files=_doc(),
                         data=_fields(today, today + timedelta(days=365)))
        check("sin token -> 401/403", r.status_code in (401, 403), str(r.status_code))

        # --- 2. subida válida ----------------------------------------------
        print("\n[2] Subida válida")
        r = await c.post("/api/v1/provider/insurance", headers=H_PROV, files=_doc(),
                         data=_fields(today - timedelta(days=10), today + timedelta(days=355)))
        ok = r.status_code == 201
        check("póliza creada -> 201", ok, str(r.status_code) if not ok else "")
        if not ok:
            print("   ", r.text[:300])
        else:
            data = r.json()["data"]
            policy_id = uuid.UUID(data["id"])
            created.append(policy_id)
            check("queda en PENDING_REVIEW",
                  data["status"].upper() == "PENDING_REVIEW", data["status"])
            check("guarda el documento", bool(data["documentUrl"]), data["documentUrl"])
            check("guarda el vencimiento", bool(data["expiryDate"]), data["expiryDate"])

            # el gate del motor NO debe verla todavía
            async with async_session_factory() as db:
                has = await level_svc._has_verified_insurance(db, provider_id, today)
            check("gate del motor: pendiente NO cuenta", has is False, f"has={has}")

            # --- 3. cola del admin + aprobación ---------------------------
            print("\n[3] Cola del admin y aprobación")
            if admin_headers is None:
                check("hay superuser para probar el admin", False, "no hay filas en superusers")
            else:
                r = await c.get("/api/v1/admin/insurance-policies",
                                headers=admin_headers, params={"status_filter": "PENDING_REVIEW"})
                ok = r.status_code == 200
                ids = [p["id"] for p in r.json()["data"]] if ok else []
                check("la póliza aparece en la cola", ok and str(policy_id) in ids,
                      f"{r.status_code}, {len(ids)} en cola")

                r = await c.get("/api/v1/admin/insurance-policies",
                                headers=admin_headers, params={"status_filter": "NO_EXISTE"})
                check("status inválido -> 400", r.status_code == 400, str(r.status_code))

                r = await c.post(f"/api/v1/admin/insurance-policies/{policy_id}/approve",
                                 headers=admin_headers)
                check("aprobar -> 200 VERIFIED",
                      r.status_code == 200
                      and r.json()["data"]["status"].upper() == "VERIFIED",
                      r.text[:80] if r.status_code != 200 else "")

                async with async_session_factory() as db:
                    has = await level_svc._has_verified_insurance(db, provider_id, today)
                check("gate del motor: verificada SÍ cuenta", has is True, f"has={has}")

                # --- 4. rechazo guarda el motivo (migración 037) ----------
                print("\n[4] Rechazo — el motivo tiene que persistir")
                r = await c.post(f"/api/v1/admin/insurance-policies/{policy_id}/reject",
                                 headers=admin_headers, json={"note": "Certificado ilegible"})
                check("rechazar -> 200 REJECTED",
                      r.status_code == 200
                      and r.json()["data"]["status"].upper() == "REJECTED",
                      r.text[:80] if r.status_code != 200 else "")

                async with async_session_factory() as db:
                    p = (await db.execute(
                        select(ProviderInsurancePolicy).where(
                            ProviderInsurancePolicy.id == policy_id)
                    )).scalar_one()
                    reason = p.rejection_reason
                check("el motivo se guardó en la BD", reason == "Certificado ilegible",
                      repr(reason))

                r = await c.post(f"/api/v1/admin/insurance-policies/{uuid.uuid4()}/approve",
                                 headers=admin_headers)
                check("póliza inexistente -> 404", r.status_code == 404, str(r.status_code))

    # --- limpieza ---------------------------------------------------------
    if created:
        async with async_session_factory() as db:
            await db.execute(
                delete(ProviderInsurancePolicy).where(ProviderInsurancePolicy.id.in_(created))
            )
            await db.commit()
        print(f"\n  limpieza: {len(created)} póliza(s) borrada(s)")

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
