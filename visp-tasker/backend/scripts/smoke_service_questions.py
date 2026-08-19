"""Smoke de preguntas por servicio + gate de seguro (migraciones 039/040).

Cubre: alta de preguntas desde el admin (texto libre y opción cerrada), que
lleguen al cliente, que las obligatorias bloqueen la reserva, que una respuesta
inventada a una pregunta cerrada se rechace, y que las respuestas viajen en el
payload de la OFERTA. Más el checkbox de seguro. Se auto-limpia.

    ./venv/bin/python scripts/smoke_service_questions.py
"""

from __future__ import annotations

import asyncio
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


TORONTO = {"locationLat": 43.6532, "locationLng": -79.3832,
           "locationAddress": "Questions smoke", "city": "Toronto",
           "provinceState": "ON", "postalZip": "M4W 1A9", "country": "CA",
           # Foto y detalles SIEMPRE: algunos servicios del catálogo los exigen, y sin
           # ellos el 400 que salta es el de la foto y no el de la pregunta — que es lo
           # que este smoke quiere probar. Sin esto dos comprobaciones pasaban en verde
           # por el motivo equivocado.
           "evidence": ["https://smoke.invalid/foto.jpg"],
           "details": "Smoke de preguntas por servicio."}



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

async def main() -> int:  # noqa: C901
    print("=" * 72)
    print("SMOKE — preguntas por servicio y gate de seguro")
    print("=" * 72)

    from sqlalchemy import delete, select, text

    from src.models.job import Job
    from src.models.superuser import SuperUser
    from src.models.taxonomy import ServiceTask, ServiceTaskQuestion
    from src.models.user import User
    from src.services.admin_service import create_admin_tokens
    from src.services.auth_service import create_access_token

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
        await _asegurar_proveedor(db, task_id)

    tok, _ = create_access_token(cust.id)
    H = {"Authorization": f"Bearer {tok}"}
    H_ADMIN = (
        {"Authorization": f"Bearer {create_admin_tokens(su.id)['accessToken']}"}
        if su else None
    )
    if H_ADMIN is None:
        print("  sin superuser, no se puede probar el admin")
        return 1
    print(f"  servicio de prueba: {task_name}")

    created_jobs: list[uuid.UUID] = []
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test", timeout=90) as c:

        print("\n[1] El admin define las preguntas")
        # Guardarraíl: pregunta cerrada con menos de 2 opciones
        r = await c.patch(f"/api/v1/admin/taxonomy/tasks/{task_id}", headers=H_ADMIN, json={
            "questions": [{"questionEn": "Condition?", "answerType": "SINGLE_CHOICE",
                           "options": [{"en": "Light"}]}]})
        check("opción cerrada con 1 sola opción -> 400", r.status_code == 400,
              str(r.json().get("detail", ""))[:60] if r.status_code == 400 else str(r.status_code))

        r = await c.patch(f"/api/v1/admin/taxonomy/tasks/{task_id}", headers=H_ADMIN, json={
            "questions": [
                {"questionEn": "Describe the condition of the space",
                 "answerType": "SINGLE_CHOICE", "isRequired": True, "displayOrder": 0,
                 "options": [{"en": "Light cleaning", "fr": "Nettoyage léger"},
                             {"en": "Normal cleaning", "fr": "Nettoyage normal"},
                             {"en": "Heavy cleaning", "fr": "Grand nettoyage"}]},
                {"questionEn": "Anything fragile we should know about?",
                 "answerType": "TEXT", "isRequired": False, "displayOrder": 1},
            ]})
        ok = r.status_code == 200
        qs = r.json()["data"]["questions"] if ok else []
        check("2 preguntas guardadas -> 200", ok and len(qs) == 2,
              r.text[:130] if not ok else f"{len(qs)} preguntas")
        choice = next((q for q in qs if q["answerType"] == "SINGLE_CHOICE"), None)
        libre = next((q for q in qs if q["answerType"] == "TEXT"), None)
        check("la cerrada conserva sus 3 opciones",
              bool(choice) and len(choice["options"]) == 3,
              str(len(choice["options"])) if choice else "no encontrada")
        check("las opciones llevan EN y FR",
              bool(choice) and choice["options"][0].get("fr") == "Nettoyage léger",
              str(choice["options"][0]) if choice else "")

        print("\n[2] El cliente las recibe")
        r = await c.get(f"/api/v1/tasks/{task_id}")
        body = r.json()
        preguntas = body.get("questions", [])
        check("GET /tasks/{id} devuelve las preguntas", len(preguntas) == 2,
              f"{len(preguntas)}")
        check("con tipo y opciones",
              any(q["answer_type"] == "SINGLE_CHOICE" and len(q["options"]) == 3
                  for q in preguntas))

        print("\n[3] Validación al reservar")
        base = {"serviceTaskId": str(task_id), **TORONTO}

        r = await c.post("/api/v1/jobs/book", headers=H, json=base)
        check("sin responder la obligatoria -> 400", r.status_code == 400,
              str(r.json().get("detail", ""))[:60] if r.status_code == 400 else str(r.status_code))

        r = await c.post("/api/v1/jobs/book", headers=H, json={
            **base, "answers": [{"questionId": choice["id"], "answer": "Extreme cleaning"}]})
        check("respuesta inventada a la cerrada -> 400", r.status_code == 400,
              str(r.json().get("detail", ""))[:70] if r.status_code == 400 else str(r.status_code))

        r = await c.post("/api/v1/jobs/book", headers=H, json={
            **base, "answers": [
                {"questionId": choice["id"], "answer": "Heavy cleaning"},
                {"questionId": libre["id"], "answer": "Hay un jarrón de cristal"},
            ]})
        ok = r.status_code in (200, 201)
        check("respuestas válidas -> 201", ok, r.text[:150] if not ok else "")
        job_id = uuid.UUID(r.json()["data"]["job"]["id"]) if ok else None
        if job_id:
            created_jobs.append(job_id)
            async with async_session_factory() as db:
                j = (await db.execute(select(Job).where(Job.id == job_id))).scalar_one()
                guardadas = list(j.customer_answers_json or [])
            check("se guardaron las 2 respuestas", len(guardadas) == 2, str(len(guardadas)))
            check("se guardó el TEXTO de la pregunta, no solo el id",
                  all(a.get("question") for a in guardadas),
                  str(guardadas[0].get("question", ""))[:40])

        print("\n[4] Las respuestas llegan a la OFERTA del proveedor")
        # Se comprueba por HTTP y NO llamando al servicio: el bug real vivía entre
        # las dos capas — el dict del servicio traía las respuestas pero la ruta
        # no las pasaba al schema, así que el proveedor no las habría visto nunca.
        # Probar la capa de abajo daba verde con el bug presente.
        if job_id:
            async with async_session_factory() as db:
                from src.models.job import JobAssignment
                from src.models.provider import ProviderProfile
                from src.models.user import User as U
                asg = (
                    await db.execute(
                        select(JobAssignment).where(JobAssignment.job_id == job_id).limit(1)
                    )
                ).scalar_one_or_none()
                prov_user = None
                if asg is not None:
                    prov_user = (
                        await db.execute(
                            select(U)
                            .join(ProviderProfile, ProviderProfile.user_id == U.id)
                            .where(ProviderProfile.id == asg.provider_id)
                        )
                    ).scalar_one_or_none()
            if asg is None or prov_user is None:
                check("hubo matching para inspeccionar la oferta", False,
                      "sin providers cualificados en zona")
            else:
                tok_p, _ = create_access_token(prov_user.id)
                # Ofertas v2: la bolsa del proveedor es /provider/open-jobs. El
                # payload es lo que ve ANTES de ofertar, que es donde las respuestas
                # del cliente tienen que estar para que le sirvan de algo.
                r = await c.get("/api/v1/provider/open-jobs",
                                headers={"Authorization": f"Bearer {tok_p}"})
                items = r.json()["data"]["items"] if r.status_code == 200 else []
                mine = [o for o in items if o["jobId"] == str(job_id)]
                check("el trabajo sale en la bolsa del proveedor", bool(mine),
                      f"{r.status_code}, {len(items)} trabajo(s)")
                if mine:
                    o = mine[0]
                    check("la RESPUESTA HTTP trae las respuestas del cliente",
                          len(o.get("answers") or []) == 2,
                          str(len(o.get("answers") or [])))
                    check("y trae los detalles y la evidencia",
                          "details" in o and "evidence" in o)

        print("\n[5] Checkbox de seguro")
        r = await c.patch(f"/api/v1/admin/taxonomy/tasks/{task_id}", headers=H_ADMIN,
                          json={"requiresInsurance": True})
        ok = r.status_code == 200
        check("marcar requiere seguro -> 200", ok, r.text[:100] if not ok else "")
        check("el admin lo devuelve marcado",
              ok and r.json()["data"]["requiresInsurance"] is True)

        async with async_session_factory() as db:
            from src.services.provider_level_service import tasks_requiring_insurance
            req = await tasks_requiring_insurance(db, [task_id])
        check("el motor lo ve como que exige seguro", task_id in req)

        r = await c.patch(f"/api/v1/admin/taxonomy/tasks/{task_id}", headers=H_ADMIN,
                          json={"requiresInsurance": False})
        async with async_session_factory() as db:
            from src.services.provider_level_service import tasks_requiring_insurance
            req2 = await tasks_requiring_insurance(db, [task_id])
        check("desmarcarlo lo quita", task_id not in req2)

    # ---------------------------------------------------------------- limpieza
    print("\n[6] Limpieza")
    async with async_session_factory() as db:
        await db.execute(
            delete(ServiceTaskQuestion).where(ServiceTaskQuestion.task_id == task_id)
        )
        if created_jobs:
            hijas = (await db.execute(text("""
                SELECT tc.table_name, kcu.column_name
                FROM information_schema.table_constraints tc
                JOIN information_schema.key_column_usage kcu
                     ON tc.constraint_name = kcu.constraint_name
                JOIN information_schema.constraint_column_usage ccu
                     ON tc.constraint_name = ccu.constraint_name
                WHERE tc.constraint_type = 'FOREIGN KEY'
                  AND ccu.table_name = 'jobs' AND ccu.column_name = 'id'
            """))).all()
            for jid in created_jobs:
                for tabla, col in hijas:
                    await db.execute(text(f"DELETE FROM {tabla} WHERE {col} = :jid"),
                                     {"jid": str(jid)})
            await db.execute(delete(Job).where(Job.id.in_(created_jobs)))
        await db.commit()
        left = (await db.execute(
            select(ServiceTaskQuestion).where(ServiceTaskQuestion.task_id == task_id)
        )).scalars().all()
    print(f"        {len(created_jobs)} job(s) borrado(s), {len(left)} pregunta(s) restantes")

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
