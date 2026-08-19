"""Smoke de detalles + evidencia en la reserva (migración 038).

Cubre: subida de evidencia, tope de 5, los dos flags obligatorios, el guardarraíl
del prompt en el admin, y —lo más importante— que los detalles y las fotos
LLEGUEN AL PAYLOAD DE LA OFERTA, porque es con eso que el proveedor decide si
acepta a su rango de precio. Se auto-limpia.

    ./venv/bin/python scripts/smoke_booking_details.py
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


def _photo(n: int = 1) -> tuple:
    return (f"foto{n}.jpg", io.BytesIO(b"\xff\xd8\xff\xe0 fake jpeg"), "image/jpeg")


TORONTO = {"locationLat": 43.6532, "locationLng": -79.3832,
           "locationAddress": "1 Bloor St E", "city": "Toronto",
           "provinceState": "ON", "postalZip": "M4W 1A9", "country": "CA"}



async def _asegurar_proveedor(db, task_id) -> None:
    """Garantiza que HAYA un proveedor que el matching pueda encontrar.

    Sin esto el smoke depende de que alguien, en algún momento, calificara a un
    proveedor activo y con domicilio para justo este servicio — y eso cambia cada vez
    que el cliente toca el catálogo. Cuando falla, el smoke parece un bug del código
    y no lo es: es que no hay a quién ofrecerle el trabajo.
    """
    from sqlalchemy import select as _sel

    from src.models.provider import ProviderProfile
    from src.models.taxonomy import ProviderTaskQualification

    prov = (
        await db.execute(
            _sel(ProviderProfile)
            .where(
                ProviderProfile.status == "ACTIVE",
                ProviderProfile.home_latitude.is_not(None),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if prov is None:
        return
    q = (
        await db.execute(
            _sel(ProviderTaskQualification).where(
                ProviderTaskQualification.provider_id == prov.id,
                ProviderTaskQualification.task_id == task_id,
            )
        )
    ).scalar_one_or_none()
    if q is None:
        db.add(ProviderTaskQualification(
            provider_id=prov.id, task_id=task_id, qualified=True, auto_granted=True))
    else:
        q.qualified = True
    await db.commit()

async def main() -> int:
    print("=" * 72)
    print("SMOKE — detalles y evidencia en la reserva (WP booking)")
    print("=" * 72)

    from sqlalchemy import delete, select

    from src.models.job import Job
    from src.models.superuser import SuperUser
    from src.models.taxonomy import ServiceTask
    from src.models.user import User
    from src.services.admin_service import create_admin_tokens
    from src.services.auth_service import create_access_token
    from src.services.jobService import MAX_CUSTOMER_EVIDENCE_PHOTOS

    async with async_session_factory() as db:
        cust = (
            await db.execute(select(User).where(User.role_customer.is_(True)).limit(1))
        ).scalar_one()
        task = (
            await db.execute(
                select(ServiceTask)
                .where(ServiceTask.is_active.is_(True), ServiceTask.level == "LEVEL_0")
                .limit(1)
            )
        ).scalar_one()
        su = (await db.execute(select(SuperUser).limit(1))).scalar_one_or_none()
        task_id, task_name = task.id, task.name
        orig_flags = (task.requires_details, task.requires_evidence, task.details_prompt_en)
        await _asegurar_proveedor(db, task_id)

    tok, _ = create_access_token(cust.id)
    H = {"Authorization": f"Bearer {tok}"}
    H_ADMIN = (
        {"Authorization": f"Bearer {create_admin_tokens(su.id)['accessToken']}"}
        if su else None
    )
    print(f"  servicio de prueba: {task_name} (L0)")

    created_jobs: list[uuid.UUID] = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=90) as c:

        print("\n[1] Subida de evidencia")
        r = await c.post("/api/v1/jobs/booking-evidence", headers=H,
                         files=[("files", _photo(1)), ("files", _photo(2))])
        ok = r.status_code == 201
        urls = r.json()["data"]["urls"] if ok else []
        check("2 fotos -> 201 con 2 URLs", ok and len(urls) == 2,
              r.text[:110] if not ok else f"{len(urls)} urls")

        r = await c.post("/api/v1/jobs/booking-evidence", headers=H,
                         files=[("files", _photo(i)) for i in range(6)])
        check(f"6 fotos -> 400 (tope {MAX_CUSTOMER_EVIDENCE_PHOTOS})",
              r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/jobs/booking-evidence", headers=H,
                         files=[("files", ("doc.pdf", io.BytesIO(b"x"), "application/pdf"))])
        check("formato no imagen -> 400", r.status_code == 400, str(r.status_code))

        r = await c.post("/api/v1/jobs/booking-evidence",
                         files=[("files", _photo())])
        check("sin token -> 401/403", r.status_code in (401, 403), str(r.status_code))

        print("\n[2] Reserva con detalles y evidencia (flags apagados)")
        r = await c.post("/api/v1/jobs/book", headers=H, json={
            "serviceTaskId": str(task_id), **TORONTO,
            "details": "Limpiar mi casa, 2 habitaciones y 2 banos, hay un perro",
            "extraNote": "El perro es amistoso pero ladra al timbre",
            "evidence": urls,
        })
        ok = r.status_code in (200, 201)
        check("reserva -> 201", ok, r.text[:160] if not ok else "")
        job_id = uuid.UUID(r.json()["data"]["job"]["id"]) if ok else None
        if job_id:
            created_jobs.append(job_id)
            async with async_session_factory() as db:
                j = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()
                saved = (j.customer_details, list(j.customer_evidence_json or []),
                         j.customer_extra_note)
            check("detalles guardados", "2 habitaciones" in (saved[0] or ""), (saved[0] or "")[:45])
            check("evidencia guardada (2)", len(saved[1]) == 2, str(len(saved[1])))
            check("nota extra guardada", "ladra" in (saved[2] or ""), (saved[2] or "")[:35])

        r = await c.post("/api/v1/jobs/book", headers=H, json={
            "serviceTaskId": str(task_id), **TORONTO,
            "evidence": [f"/fake/{i}.jpg" for i in range(6)],
        })
        check("reservar con 6 fotos -> 400", r.status_code == 400,
              str(r.json().get("detail", ""))[:50] if r.status_code == 400 else str(r.status_code))

        print("\n[3] Flags obligatorios (se encienden desde el admin)")
        if H_ADMIN is None:
            check("hay superuser", False, "sin filas en superusers")
        else:
            # Guardarraíl: obligar detalles sin prompt debe fallar
            r = await c.patch(f"/api/v1/admin/taxonomy/tasks/{task_id}", headers=H_ADMIN,
                              json={"requiresDetails": True})
            check("requiresDetails sin prompt -> 400", r.status_code == 400,
                  str(r.json().get("detail", ""))[:60] if r.status_code == 400 else str(r.status_code))

            r = await c.patch(f"/api/v1/admin/taxonomy/tasks/{task_id}", headers=H_ADMIN,
                              json={"requiresDetails": True, "requiresEvidence": True,
                                    "detailsPromptEn": "How many rooms and bathrooms? Pets? Access?"})
            ok = r.status_code == 200
            check("con prompt -> 200", ok, r.text[:110] if not ok else "")
            if ok:
                d = r.json()["data"]
                check("el admin devuelve los flags",
                      d["requiresDetails"] is True and d["requiresEvidence"] is True
                      and bool(d["detailsPromptEn"]))

            r = await c.post("/api/v1/jobs/book", headers=H, json={
                "serviceTaskId": str(task_id), **TORONTO, "evidence": urls})
            check("sin detalles -> 400", r.status_code == 400,
                  str(r.json().get("detail", ""))[:50] if r.status_code == 400 else str(r.status_code))

            r = await c.post("/api/v1/jobs/book", headers=H, json={
                "serviceTaskId": str(task_id), **TORONTO, "details": "2 habitaciones"})
            check("sin evidencia -> 400", r.status_code == 400,
                  str(r.json().get("detail", ""))[:50] if r.status_code == 400 else str(r.status_code))

            r = await c.post("/api/v1/jobs/book", headers=H, json={
                "serviceTaskId": str(task_id), **TORONTO,
                "details": "   ", "evidence": urls})
            check("detalles en blanco no cuentan -> 400", r.status_code == 400,
                  str(r.status_code))

            r = await c.post("/api/v1/jobs/book", headers=H, json={
                "serviceTaskId": str(task_id), **TORONTO,
                "details": "2 habitaciones, 2 banos", "evidence": urls})
            ok2 = r.status_code in (200, 201)
            check("con ambos -> 201", ok2, r.text[:130] if not ok2 else "")
            if ok2:
                created_jobs.append(uuid.UUID(r.json()["data"]["job"]["id"]))

    print("\n[4] Los detalles llegan al payload de la OFERTA (requisito duro)")
    if job_id:
        async with async_session_factory() as db:
            from src.services import providerService
            from src.models.job import JobAssignment
            asg = (
                await db.execute(
                    select(JobAssignment).where(JobAssignment.job_id == job_id).limit(1)
                )
            ).scalar_one_or_none()
            if asg is None:
                check("hubo matching para inspeccionar la oferta", False,
                      "el job no generó asignación (sin providers cualificados en zona)")
            else:
                offers = await providerService.get_pending_offers(db, asg.provider_id)
                mine = [o for o in offers if o["job_id"] == job_id]
                check("la oferta existe", bool(mine), f"{len(offers)} oferta(s)")
                if mine:
                    o = mine[0]
                    check("la oferta trae customer_details",
                          "2 habitaciones" in (o.get("customer_details") or ""),
                          (o.get("customer_details") or "(vacío)")[:45])
                    check("la oferta trae la evidencia",
                          len(o.get("customer_evidence") or []) == 2,
                          str(len(o.get("customer_evidence") or [])))
                    check("la oferta trae la nota extra",
                          "ladra" in (o.get("customer_extra_note") or ""),
                          (o.get("customer_extra_note") or "(vacío)")[:35])

    # ---- limpieza: flags del servicio y jobs de prueba ----
    async with async_session_factory() as db:
        t = (await db.execute(select(ServiceTask).where(ServiceTask.id == task_id))).scalar_one()
        t.requires_details, t.requires_evidence, t.details_prompt_en = orig_flags
        if created_jobs:
            from src.models.job import JobAssignment
            await db.execute(delete(JobAssignment).where(JobAssignment.job_id.in_(created_jobs)))
            await db.execute(delete(Job).where(Job.id.in_(created_jobs)))
        await db.commit()
        left = (
            await db.execute(select(Job).where(Job.service_address == "1 Bloor St E"))
        ).scalars().all()
    print(f"\n  limpieza: {len(created_jobs)} job(s) borrado(s), flags restaurados "
          f"{orig_flags}, quedan {len(left)} con esa dirección")

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
