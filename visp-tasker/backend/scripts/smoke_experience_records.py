"""Smoke del expediente de experiencia L1 (WP1c).

Cubre: subida, reemplazo del mismo tipo, cola del admin, validar/rechazar y el
aislamiento entre proveedores. Se auto-limpia.

    ./venv/bin/python scripts/smoke_experience_records.py
"""

from __future__ import annotations

import asyncio
import io
import sys
import uuid

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


def _doc(name: str = "cv.pdf") -> dict:
    return {"file": (name, io.BytesIO(b"%PDF-1.4 evidencia"), "application/pdf")}


async def main() -> int:
    print("=" * 72)
    print("SMOKE — expediente de experiencia L1 (WP1c)")
    print("=" * 72)

    from sqlalchemy import delete, select

    from src.models.provider import ProviderProfile
    from src.models.superuser import SuperUser
    from src.models.user import User
    from src.models.verification import ProviderExperienceRecord
    from src.services.admin_service import create_admin_tokens
    from src.services.auth_service import create_access_token

    async with async_session_factory() as db:
        rows = (
            await db.execute(
                select(ProviderProfile, User)
                .join(User, ProviderProfile.user_id == User.id)
                .limit(2)
            )
        ).all()
        if len(rows) < 2:
            print("  Hacen falta 2 providers para probar el aislamiento.")
            return 1
        (prof_a, user_a), (prof_b, user_b) = rows[0], rows[1]
        su = (await db.execute(select(SuperUser).limit(1))).scalar_one_or_none()

    tok_a, _ = create_access_token(user_a.id)
    tok_b, _ = create_access_token(user_b.id)
    H_A = {"Authorization": f"Bearer {tok_a}"}
    H_B = {"Authorization": f"Bearer {tok_b}"}
    H_ADMIN = (
        {"Authorization": f"Bearer {create_admin_tokens(su.id)['accessToken']}"}
        if su
        else None
    )

    touched = [prof_a.id, prof_b.id]
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:
        print("\n[1] Validaciones")
        r = await c.post("/api/v1/provider/experience", headers=H_A, files=_doc(),
                         data={"kind": "no_existe"})
        check("kind inválido -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/provider/experience", headers=H_A,
                         files={"file": ("x.pdf", io.BytesIO(b""), "application/pdf")},
                         data={"kind": "resume"})
        check("archivo vacío -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/provider/experience", files=_doc(), data={"kind": "resume"})
        check("sin token -> 401/403", r.status_code in (401, 403), str(r.status_code))

        print("\n[2] Subida del CV y de fotos de trabajos")
        r = await c.post("/api/v1/provider/experience", headers=H_A, files=_doc(),
                         data={"kind": "resume", "title": "CV 2026"})
        ok = r.status_code == 201
        check("CV creado -> 201", ok, r.text[:120] if not ok else "")
        cv_id = uuid.UUID(r.json()["data"]["id"]) if ok else None
        if ok:
            check("queda PENDING", r.json()["data"]["status"].upper() == "PENDING",
                  r.json()["data"]["status"])
            check("no marcado como reemplazo", r.json()["data"]["replaced"] is False)

        r = await c.post("/api/v1/provider/experience", headers=H_A, files=_doc("fotos.jpg"),
                         data={"kind": "work_photos", "title": "Trabajos previos"})
        check("fotos de trabajo -> 201", r.status_code == 201, str(r.status_code))

        # KIND ya existente -> reemplaza, no duplica (índice único de la mig 038)
        print("\n[3] Reemplazo del mismo tipo (no debe duplicar ni dar 500)")
        r = await c.post("/api/v1/provider/experience", headers=H_A, files=_doc("cv_v2.pdf"),
                         data={"kind": "resume", "title": "CV 2026 v2"})
        ok = r.status_code == 201
        check("segundo CV -> 201 y replaced=true",
              ok and r.json()["data"]["replaced"] is True,
              r.text[:120] if not ok else str(r.json()["data"]["replaced"]))
        if ok:
            check("conserva el mismo id (reemplazo, no alta)",
                  cv_id is not None and uuid.UUID(r.json()["data"]["id"]) == cv_id)

        r = await c.get("/api/v1/provider/experience", headers=H_A)
        items = r.json()["data"] if r.status_code == 200 else []
        resumes = [i for i in items if i["kind"] == "resume"]
        check("solo 1 CV en el expediente", len(resumes) == 1, f"{len(resumes)} CV(s)")
        check("el expediente tiene 2 documentos", len(items) == 2, f"{len(items)}")

        print("\n[4] Aislamiento entre proveedores")
        r = await c.get("/api/v1/provider/experience", headers=H_B)
        b_items = r.json()["data"] if r.status_code == 200 else []
        check("B no ve el expediente de A",
              all(uuid.UUID(i["id"]) != cv_id for i in b_items), f"B tiene {len(b_items)}")
        if cv_id:
            r = await c.delete(f"/api/v1/provider/experience/{cv_id}", headers=H_B)
            check("B no puede borrar el documento de A -> 404", r.status_code == 404,
                  str(r.status_code))

        print("\n[5] Cola del admin, validar y rechazar")
        if H_ADMIN is None:
            check("hay superuser para probar", False, "sin filas en superusers")
        else:
            r = await c.get("/api/v1/admin/experience-records", headers=H_ADMIN,
                            params={"status_filter": "pending"})
            ok = r.status_code == 200
            ids = [i["id"] for i in r.json()["data"]] if ok else []
            check("el CV aparece en la cola", ok and str(cv_id) in ids,
                  f"{r.status_code}, {len(ids)} en cola")

            r = await c.get("/api/v1/admin/experience-records", headers=H_ADMIN,
                            params={"status_filter": "nope"})
            check("status inválido -> 400", r.status_code == 400, str(r.status_code))

            r = await c.post(f"/api/v1/admin/experience-records/{cv_id}/validate",
                             headers=H_ADMIN)
            check("validar -> 200 VALIDATED",
                  r.status_code == 200 and r.json()["data"]["status"].upper() == "VALIDATED",
                  r.text[:100] if r.status_code != 200 else "")

            # Resubir un documento VALIDATED debe volver a PENDING: si no, se podría
            # sustituir un aprobado por otro sin revisión.
            r = await c.post("/api/v1/provider/experience", headers=H_A, files=_doc("cv_v3.pdf"),
                             data={"kind": "resume"})
            back_to_pending = (
                r.status_code == 201 and r.json()["data"]["status"].upper() == "PENDING"
            )
            check("resubir un validado vuelve a PENDING", back_to_pending,
                  r.json()["data"]["status"] if r.status_code == 201 else str(r.status_code))

            r = await c.post(f"/api/v1/admin/experience-records/{cv_id}/reject",
                             headers=H_ADMIN, json={"note": "CV ilegible"})
            ok = r.status_code == 200
            check("rechazar -> 200 con motivo",
                  ok and r.json()["data"]["rejectionReason"] == "CV ilegible",
                  r.text[:100] if not ok else "")

            r = await c.post(f"/api/v1/admin/experience-records/{uuid.uuid4()}/validate",
                             headers=H_ADMIN)
            check("registro inexistente -> 404", r.status_code == 404, str(r.status_code))

    # limpieza
    async with async_session_factory() as db:
        await db.execute(
            delete(ProviderExperienceRecord).where(
                ProviderExperienceRecord.provider_id.in_(touched)
            )
        )
        await db.commit()
        left = (
            await db.execute(select(ProviderExperienceRecord))
        ).scalars().all()
    print(f"\n  limpieza hecha — quedan {len(left)} registros en la tabla")

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
