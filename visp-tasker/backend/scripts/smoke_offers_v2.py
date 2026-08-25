"""Smoke del modelo de ofertas v2 + materiales (migraciones 042 y 043).

Prueba el ciclo completo contra visp_prod, por HTTP (ASGI in-process) y no llamando
a los servicios: los bugs que nos han costado caro vivían ENTRE capas — un campo que
la ruta no pasaba al servicio, un schema que se comía un dato— y probando el servicio
directamente no se ven.

  PARTE A — el trabajo nace SIN precio, con ventana de ofertas y con el rango del
            catálogo como respuesta (no un total inventado).
  PARTE B — la bolsa del proveedor, ofertar con magnitud, y los tres rechazos:
            sin tarifa, sin magnitud y oferta duplicada.
  PARTE C — el cliente ve las dos ofertas, acepta una: precio sellado = tarifa ×
            magnitud, la otra oferta queda rechazada y las asignaciones cuadran.
  PARTE D — aritmética del dinero: comisión e impuesto SOLO sobre la mano de obra.
  PARTE E — materiales: presupuesto fuera de rango rechazado, dentro aceptado, y la
            pregunta de material solo se exige cuando se piden materiales.

Las credenciales salen del .env — este script no lleva ninguna dentro.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_offers_v2.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from decimal import Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.core.config import settings  # noqa: E402
from src.main import app  # noqa: E402
from src.services import auth_service  # noqa: E402

API = "/api/v1"
_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

HOURS = Decimal("8")       # magnitud que oferta el proveedor A
HOURS_B = Decimal("5")     # magnitud que oferta el proveedor B


class SmokeError(AssertionError):
    pass


_checks = 0


def check(cond: bool, msg: str) -> None:
    global _checks
    _checks += 1
    if not cond:
        raise SmokeError(msg)


def step(n: str, msg: str) -> None:
    print(f"[{n}] {msg}")


async def _qualify(conn, provider_id, task_id) -> None:
    row = await conn.fetchrow(
        "SELECT id FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
        provider_id, task_id,
    )
    if row is None:
        await conn.execute(
            "INSERT INTO provider_task_qualifications "
            "(id, provider_id, task_id, qualified, auto_granted, qualified_at, created_at, updated_at) "
            "VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
            uuid.uuid4(), provider_id, task_id,
        )
    else:
        await conn.execute(
            "UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1", row["id"]
        )


async def _place_near(conn, provider_id, lat, lng, radius_km: int = 50) -> None:
    """Coloca la base del proveedor cerca del trabajo, que es lo que el matching mide.

    Esto sustituye al viejo `_invite()`, que insertaba a mano la fila de
    `job_assignments` "para no depender del motor de matching". Era justo lo que no
    había que hacer: el smoke se fabricaba la invitación que el broadcast real nunca
    creaba, así que pasaba en verde mientras en el dispositivo NINGÚN proveedor veía
    NINGÚN trabajo (24 de 36 acabaron huérfanos). Ahora se prepara el dato de entrada
    —dónde vive el proveedor— y se deja que el producto decida solo si lo ve.
    """
    await conn.execute(
        "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
        "service_radius_km=$4, updated_at=now() WHERE id=$1",
        provider_id, lat, lng, radius_km,
    )


async def _drop_job(conn, job_id) -> None:
    if job_id is None:
        return
    # Las notificaciones no cuelgan del job por FK: se borran por el jobId que llevan
    # en el payload, o el centro de notificaciones se llena de basura de las pruebas.
    await conn.execute(
        "DELETE FROM notifications WHERE data_json->>'jobId' = $1", str(job_id))
    await conn.execute("DELETE FROM job_material_receipts WHERE job_id=$1", job_id)
    await conn.execute("UPDATE jobs SET accepted_offer_id=NULL WHERE id=$1", job_id)
    await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", job_id)
    await conn.execute("DELETE FROM job_offers WHERE job_id=$1", job_id)
    await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
    await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    job_id = None
    mat_job_id = None
    task_id = None
    mat_task_id = None
    prov_a = prov_b = None
    tax_reg_original = None
    created_tasks: list[uuid.UUID] = []
    # Vacío hasta que se elijan los proveedores: el `finally` corre igual si el
    # smoke se cae antes de llegar ahí.
    home_original: dict = {}

    try:
        dbname = await conn.fetchval("SELECT current_database()")
        check(dbname == "visp_prod", f"esperaba visp_prod, conectado a {dbname}")
        print(f"Conectado a {dbname}\n")

        # ---------- datos de partida ----------
        task = await conn.fetchrow(
            """SELECT id, name, base_price_min_cents lo, base_price_max_cents hi
                 FROM service_tasks
                WHERE pricing_unit='HOURLY' AND is_active
                  AND base_price_min_cents IS NOT NULL
                  AND base_price_max_cents > base_price_min_cents
                  -- Sin preguntas obligatorias: lo que se prueba aquí es el ciclo de
                  -- ofertas, no el cuestionario, y el catálogo cambia cada semana.
                  AND NOT EXISTS (
                      SELECT 1 FROM service_task_questions q
                       WHERE q.task_id = service_tasks.id AND q.is_active AND q.is_required
                  )
             ORDER BY name LIMIT 1"""
        )
        check(task is not None, "hace falta un servicio HOURLY activo con rango")
        task_id = task["id"]
        rate_a = (task["lo"] + task["hi"]) // 2
        rate_b = task["hi"]

        # L0/L1 y `ORDER BY id`, las dos cosas a propósito. Antes era
        # `ORDER BY created_at NULLS LAST`, y como los proveedores sembrados
        # comparten `created_at`, cada corrida elegía a dos distintos: unas veces
        # tocaban L3, que exige licencia y seguro verificados, y el smoke fallaba
        # sin que hubiera cambiado nada. Lo que se prueba aquí es el ciclo de
        # ofertas, no la verificación de credenciales.
        provs = await conn.fetch(
            "SELECT id, user_id, home_latitude, home_longitude, service_radius_km "
            "FROM provider_profiles "
            "WHERE status = 'ACTIVE' AND current_level IN ('LEVEL_0', 'LEVEL_1') "
            "ORDER BY id LIMIT 2"
        )
        check(len(provs) >= 2, "hacen falta 2 provider_profiles ACTIVE de nivel L0/L1")
        # Se devuelven a su sitio en la limpieza: son perfiles reales de la base.
        home_original = {
            p["id"]: (p["home_latitude"], p["home_longitude"], p["service_radius_km"])
            for p in provs
        }
        prov_a, user_a = provs[0]["id"], provs[0]["user_id"]
        prov_b, user_b = provs[1]["id"], provs[1]["user_id"]

        customer = await conn.fetchrow(
            "SELECT id FROM users WHERE id <> $1 AND id <> $2 ORDER BY created_at NULLS LAST LIMIT 1",
            user_a, user_b,
        )
        check(customer is not None, "hace falta un usuario cliente")
        cust_id = customer["id"]

        await _qualify(conn, prov_a, task_id)
        await _qualify(conn, prov_b, task_id)
        # Los dos viven donde va a estar el trabajo (43.65, -79.38). Es lo único que
        # se prepara: que aparezca en su bolsa lo decide el producto.
        await _place_near(conn, prov_a, 43.65, -79.38)
        await _place_near(conn, prov_b, 43.65, -79.38)
        print(f"servicio '{task['name']}' rango {task['lo']}-{task['hi']}c/h")
        print(f"proveedor A tarifa {rate_a}c/h · proveedor B tarifa {rate_b}c/h\n")

        hdr_a = {"Authorization": f"Bearer {auth_service.create_access_token(user_a)[0]}"}
        hdr_b = {"Authorization": f"Bearer {auth_service.create_access_token(user_b)[0]}"}
        hdr_c = {"Authorization": f"Bearer {auth_service.create_access_token(cust_id)[0]}"}

        async with AsyncClient(
            transport=ASGITransport(app=app), base_url="http://smoke"
        ) as client:

            # ================= PARTE A =================
            step("A1", "el cliente postea el trabajo")
            r = await client.post(f"{API}/jobs/book", headers=hdr_c, json={
                "serviceTaskId": str(task_id),
                "locationAddress": "1 Smoke St",
                "locationLat": 43.65, "locationLng": -79.38,
                "provinceState": "ON",
                "details": "Casa de dos pisos, acceso por el garaje.",
                # Algunos servicios del catálogo exigen foto (requires_evidence); se
                # manda siempre para que el smoke no dependa de cuál toque hoy.
                "evidence": ["https://smoke.invalid/casa.jpg"],
            })
            check(r.status_code in (200, 201), f"book: {r.status_code}: {r.text}")
            body = r.json()["data"]
            job_id = uuid.UUID(body["job"]["id"])

            row = await conn.fetchrow(
                "SELECT status::text s, quoted_price_cents q, offers_close_at, quantity FROM jobs WHERE id=$1",
                job_id,
            )
            check(row["q"] is None, f"el trabajo nacio CON precio ({row['q']}c) y no deberia")
            check(row["offers_close_at"] is not None, "sin ventana de ofertas")
            horas = (row["offers_close_at"] - await conn.fetchval("SELECT now()")).total_seconds() / 3600
            check(47 < horas < 49, f"la ventana es de {horas:.1f}h, esperaba 48")
            print(f"        -> job {job_id} sin precio, ventana {horas:.0f}h")

            step("A2", "la respuesta trae el RANGO del catalogo, no un total")
            est = body["estimatedPrice"]
            check(est["minCents"] == task["lo"] and est["maxCents"] == task["hi"],
                  f"rango devuelto {est['minCents']}-{est['maxCents']} != catalogo {task['lo']}-{task['hi']}")
            print(f"        -> {est['minCents']/100:.2f}-{est['maxCents']/100:.2f} CAD/h")

            # ================= PARTE B =================
            # Sin sembrar nada: si A ve el trabajo es porque el producto se lo enseña.
            step("B1", "el proveedor A ve el trabajo en su bolsa")
            r = await client.get(f"{API}/provider/open-jobs", headers=hdr_a)
            check(r.status_code == 200, f"open-jobs: {r.status_code}: {r.text}")
            items = {i["jobId"]: i for i in r.json()["data"]["items"]}
            check(str(job_id) in items, "el trabajo no aparece en la bolsa")
            it = items[str(job_id)]
            check(it["magnitudeSource"] == "PROVIDER", f"magnitudeSource {it['magnitudeSource']} != PROVIDER")
            check(it["details"] == "Casa de dos pisos, acceso por el garaje.", "no ve los detalles del cliente")
            check(it["canOffer"] is False and it["myRateCents"] is None,
                  "deberia no poder ofertar todavia: no tiene tarifa")
            print("        -> lo ve, sabe que debe poner horas, y aun no puede ofertar (sin tarifa)")

            step("B2", "sin tarifa NO se puede ofertar (400)")
            r = await client.post(f"{API}/provider/open-jobs/{job_id}/offer",
                                  headers=hdr_a, json={"magnitude": float(HOURS)})
            check(r.status_code == 400, f"esperaba 400 sin tarifa, dio {r.status_code}: {r.text}")
            check(r.json()["detail"]["code"] == "no_rate", "codigo de error inesperado")
            print("        -> 400 no_rate")

            step("B3", f"A pone su tarifa ({rate_a}c/h) y oferta {HOURS}h")
            r = await client.put(f"{API}/provider/rates/{task_id}", headers=hdr_a,
                                 json={"rate_cents": rate_a})
            check(r.status_code == 200, f"set rate A: {r.status_code}: {r.text}")

            r = await client.post(f"{API}/provider/open-jobs/{job_id}/offer",
                                  headers=hdr_a, json={"magnitude": float(HOURS)})
            check(r.status_code == 201, f"oferta A: {r.status_code}: {r.text}")
            oa = r.json()["data"]
            esperado_a = rate_a * int(HOURS)
            check(oa["subtotalCents"] == esperado_a,
                  f"subtotal {oa['subtotalCents']} != {rate_a} x {HOURS} = {esperado_a}")
            print(f"        -> oferta A: {HOURS}h x {rate_a}c = {esperado_a}c (+{oa['serviceTaxCents']}c tax)")

            step("B4", "A no puede ofertar dos veces (409)")
            r = await client.post(f"{API}/provider/open-jobs/{job_id}/offer",
                                  headers=hdr_a, json={"magnitude": 3})
            check(r.status_code == 409, f"esperaba 409 duplicado, dio {r.status_code}")
            print("        -> 409 duplicate_offer")

            step("B5", "en un servicio por hora la magnitud es obligatoria (400)")
            r = await client.put(f"{API}/provider/rates/{task_id}", headers=hdr_b,
                                 json={"rate_cents": rate_b})
            check(r.status_code == 200, f"set rate B: {r.status_code}: {r.text}")
            r = await client.post(f"{API}/provider/open-jobs/{job_id}/offer",
                                  headers=hdr_b, json={})
            check(r.status_code == 400, f"esperaba 400 sin magnitud, dio {r.status_code}: {r.text}")
            check(r.json()["detail"]["code"] == "magnitude_required", "codigo inesperado")
            print("        -> 400 magnitude_required")

            step("B6", f"B oferta {HOURS_B}h a {rate_b}c/h")
            r = await client.post(f"{API}/provider/open-jobs/{job_id}/offer",
                                  headers=hdr_b, json={"magnitude": float(HOURS_B),
                                                       "message": "Llevo mi propio equipo."})
            check(r.status_code == 201, f"oferta B: {r.status_code}: {r.text}")
            ob = r.json()["data"]
            esperado_b = rate_b * int(HOURS_B)
            check(ob["subtotalCents"] == esperado_b, "subtotal B mal calculado")
            print(f"        -> oferta B: {HOURS_B}h x {rate_b}c = {esperado_b}c")

            # ================= PARTE C =================
            step("C1", "el cliente ve LAS DOS ofertas con la ficha de cada proveedor")
            r = await client.get(f"{API}/jobs/{job_id}/offers", headers=hdr_c)
            check(r.status_code == 200, f"offers: {r.status_code}: {r.text}")
            data = r.json()["data"]
            check(data["count"] == 2, f"ve {data['count']} ofertas, esperaba 2")
            for o in data["offers"]:
                check("displayName" in o and "rating" in o and "completedJobs" in o,
                      "falta la ficha del proveedor")
                check(o["magnitude"] > 0 and o["rateCents"] > 0, "falta trabajo o tarifa")
            print("        -> " + " | ".join(
                f"{o['displayName']}: {o['magnitude']}x{o['rateCents']}c = {o['totalCents']}c"
                for o in data["offers"]))

            # El impuesto solo se cobra si el VENDEDOR está registrado. Se marca a
            # propósito para que la parte D pruebe la regla de verdad en vez de pasar
            # de largo con tax=0, que es lo que da un proveedor sin registrar.
            tax_reg_original = await conn.fetchval(
                "SELECT tax_registered FROM provider_profiles WHERE id=$1", prov_a)
            await conn.execute(
                "UPDATE provider_profiles SET tax_registered=TRUE WHERE id=$1", prov_a)

            step("C2", "acepta la de A")
            offer_a = next(o for o in data["offers"] if o["rateCents"] == rate_a)
            r = await client.post(
                f"{API}/jobs/{job_id}/offers/{offer_a['offerId']}/accept", headers=hdr_c)
            check(r.status_code == 200, f"accept: {r.status_code}: {r.text}")

            j = await conn.fetchrow(
                """SELECT status::text s, quantity, quoted_price_cents sub, service_tax_cents tax,
                          commission_amount_cents com, provider_payout_cents pay,
                          total_charged_cents tot, accepted_offer_id, commission_rate
                     FROM jobs WHERE id=$1""", job_id)
            check(j["s"] == "SCHEDULED", f"estado {j['s']} != SCHEDULED")
            check(j["quantity"] == HOURS, f"quantity {j['quantity']} != {HOURS}")
            check(j["sub"] == esperado_a, f"subtotal sellado {j['sub']} != {esperado_a}")
            check(str(j["accepted_offer_id"]) == offer_a["offerId"], "accepted_offer_id mal")
            print(f"        -> SCHEDULED, {HOURS}h selladas, subtotal {j['sub']}c")

            step("C3", "la oferta perdedora queda cerrada y las asignaciones cuadran")
            estados = dict(await conn.fetch(
                "SELECT status, count(*) FROM job_offers WHERE job_id=$1 GROUP BY 1", job_id))
            check(estados.get("accepted") == 1, f"ofertas aceptadas: {estados}")
            check(estados.get("rejected") == 1, f"ofertas rechazadas: {estados}")
            asg = {r["provider_id"]: r["status"] for r in await conn.fetch(
                "SELECT provider_id, status::text status FROM job_assignments WHERE job_id=$1", job_id)}
            check(asg[prov_a] == "ACCEPTED", f"asignacion A {asg[prov_a]}")
            check(asg[prov_b] == "DECLINED", f"asignacion B {asg[prov_b]}")
            print("        -> A ACCEPTED, B DECLINED, oferta de B rechazada")

            # ================= PARTE D =================
            step("D", "comision e impuesto salen SOLO de la mano de obra")
            com_esperada = int(Decimal(esperado_a) * j["commission_rate"])
            check(j["com"] == com_esperada, f"comision {j['com']} != {com_esperada}")
            check(j["pay"] == esperado_a - com_esperada, f"payout {j['pay']} mal")
            # El proveedor quedó marcado como registrado, así que el impuesto TIENE que
            # existir y salir exactamente del subtotal de mano de obra.
            tasa = await conn.fetchval("SELECT tax_rate_applied FROM jobs WHERE id=$1", job_id)
            check(j["tax"] > 0, "el proveedor esta registrado y el impuesto salio 0")
            check(tasa is not None and j["tax"] == int(Decimal(esperado_a) * tasa),
                  f"impuesto {j['tax']} != subtotal {esperado_a} x {tasa}")
            print(f"        -> impuesto = {esperado_a}c x {tasa} = {j['tax']}c (solo mano de obra)")
            print(f"        -> subtotal {esperado_a}c · tax {j['tax']}c · comision {j['com']}c "
                  f"· payout {j['pay']}c · total {j['tot']}c")

            # ================= PARTE E =================
            step("E1", "servicio de prueba CON materiales (60-200 CAD)")
            cat_id = await conn.fetchval("SELECT category_id FROM service_tasks WHERE id=$1", task_id)
            lvl = await conn.fetchval("SELECT level::text FROM service_tasks WHERE id=$1", task_id)
            mat_task_id = uuid.uuid4()
            await conn.execute(
                """INSERT INTO service_tasks
                   (id, category_id, slug, name, level, pricing_unit, base_price_min_cents,
                    base_price_max_cents, is_active, materials_enabled,
                    materials_budget_min_cents, materials_budget_max_cents, materials_note_en,
                    created_at, updated_at)
                   VALUES ($1,$2,$3,$4,$5::provider_level,'HOURLY',$6,$7,TRUE,TRUE,6000,20000,
                           'Compra pintura mate y guarda la factura.',now(),now())""",
                mat_task_id, cat_id, f"zz-smoke-materials-{mat_task_id.hex[:8]}",
                "ZZ SMOKE materiales — no usar", lvl, task["lo"], task["hi"])
            created_tasks.append(mat_task_id)
            q_id = uuid.uuid4()
            await conn.execute(
                """INSERT INTO service_task_questions
                   (id, task_id, question_en, answer_type, materials_only, is_required,
                    created_at, updated_at)
                   VALUES ($1,$2,'What colour?','IMAGE',TRUE,TRUE,now(),now())""",
                q_id, mat_task_id)
            await _qualify(conn, prov_a, mat_task_id)

            step("E2", "presupuesto fuera del rango del admin -> 400")
            r = await client.post(f"{API}/jobs/book", headers=hdr_c, json={
                "serviceTaskId": str(mat_task_id),
                "locationAddress": "1 Smoke St", "locationLat": 43.65, "locationLng": -79.38,
                "provinceState": "ON",
                "materialsRequested": True, "materialsBudgetCents": 50000,
                "answers": [{"questionId": str(q_id), "answer": "https://x/colour.jpg"}],
            })
            check(r.status_code == 400, f"esperaba 400 fuera de rango, dio {r.status_code}: {r.text}")
            print("        -> 400, el presupuesto debe caer entre 60 y 200 CAD")

            step("E3", "sin responder la pregunta de material -> 400")
            r = await client.post(f"{API}/jobs/book", headers=hdr_c, json={
                "serviceTaskId": str(mat_task_id),
                "locationAddress": "1 Smoke St", "locationLat": 43.65, "locationLng": -79.38,
                "provinceState": "ON",
                "materialsRequested": True, "materialsBudgetCents": 10000,
            })
            check(r.status_code == 400, f"esperaba 400 sin respuesta, dio {r.status_code}: {r.text}")
            print("        -> 400, la pregunta de material es obligatoria si pide material")

            step("E4", "SIN materiales la misma pregunta NO se exige")
            r = await client.post(f"{API}/jobs/book", headers=hdr_c, json={
                "serviceTaskId": str(mat_task_id),
                "locationAddress": "1 Smoke St", "locationLat": 43.65, "locationLng": -79.38,
                "provinceState": "ON",
            })
            check(r.status_code in (200, 201), f"reserva sin material: {r.status_code}: {r.text}")
            sin_mat = uuid.UUID(r.json()["data"]["job"]["id"])
            await _drop_job(conn, sin_mat)
            print("        -> reserva normal, sin fricción")

            step("E5", "con presupuesto válido y foto del color -> se guarda")
            r = await client.post(f"{API}/jobs/book", headers=hdr_c, json={
                "serviceTaskId": str(mat_task_id),
                "locationAddress": "1 Smoke St", "locationLat": 43.65, "locationLng": -79.38,
                "provinceState": "ON",
                "materialsRequested": True, "materialsBudgetCents": 10000,
                "answers": [{"questionId": str(q_id), "answer": "https://x/colour.jpg"}],
            })
            check(r.status_code in (200, 201), f"reserva con material: {r.status_code}: {r.text}")
            mat_job_id = uuid.UUID(r.json()["data"]["job"]["id"])
            m = await conn.fetchrow(
                "SELECT materials_requested mr, materials_budget_cents mb, materials_spent_cents ms, "
                "customer_answers_json ans FROM jobs WHERE id=$1", mat_job_id)
            check(m["mr"] is True and m["mb"] == 10000, f"materiales mal guardados: {m['mr']}/{m['mb']}")
            check(m["ms"] == 0, "materials_spent deberia empezar en 0")
            check("IMAGE" in str(m["ans"]), "la respuesta de imagen no llego al job")
            print("        -> materiales pedidos, presupuesto 100 CAD, foto del color guardada")

            step("E6", "el proveedor ve el material ANTES de ofertar")
            r = await client.get(f"{API}/provider/open-jobs", headers=hdr_a)
            check(r.status_code == 200, f"open-jobs: {r.status_code}")
            it = next(i for i in r.json()["data"]["items"] if i["jobId"] == str(mat_job_id))
            check(it["materialsRequested"] is True, "no ve que lleva material")
            check(it["materialsBudgetCents"] == 10000, "no ve el presupuesto")
            check("pintura mate" in (it["materialsNote"] or ""), "no ve el mensaje del admin")
            print("        -> ve presupuesto 100 CAD y el mensaje del admin")

            # ================= PARTE F: la cuenta del cliente =================
            # El ejemplo de Ricardo: mano de obra 240, material 85.50. El material NO
            # lleva impuesto encima ni paga comisión, y se le devuelve integro al
            # proveedor.
            step("F1", "el proveedor cotiza el MATERIAL en su oferta, con justificación")
            await client.put(f"{API}/provider/rates/{mat_task_id}", headers=hdr_a,
                             json={"rate_cents": rate_a})

            # Sin importe de material -> 400
            r = await client.post(f"{API}/provider/open-jobs/{mat_job_id}/offer",
                                  headers=hdr_a, json={"magnitude": 3})
            check(r.status_code == 400, f"esperaba 400 sin material, dio {r.status_code}")
            check(r.json()["detail"]["missing"] == "amount", "codigo inesperado")

            # Con importe pero sin explicar por qué -> 400
            r = await client.post(f"{API}/provider/open-jobs/{mat_job_id}/offer",
                                  headers=hdr_a,
                                  json={"magnitude": 3, "materialsCents": 15000})
            check(r.status_code == 400, f"esperaba 400 sin justificación, dio {r.status_code}")
            check(r.json()["detail"]["missing"] == "note", "codigo inesperado")
            print("        -> 400 sin importe y 400 sin justificación")

            # Ojo: 150 está POR ENCIMA de los 100 que presupuestó el cliente. Se acepta
            # a propósito: el presupuesto del cliente es una referencia, y quien sabe lo
            # que cuesta la pintura es quien la va a comprar. El cliente lo ve con su
            # porqué y decide.
            r = await client.post(
                f"{API}/provider/open-jobs/{mat_job_id}/offer", headers=hdr_a,
                json={"magnitude": 3, "materialsCents": 15000,
                      "materialsNote": "La pintura mate de esa marca sale a 150."})
            check(r.status_code == 201, f"oferta material: {r.status_code}: {r.text}")
            oid = r.json()["data"]["offerId"]
            od = r.json()["data"]
            mano_obra_prev = rate_a * 3
            check(od["materialsCents"] == 15000, "el material no quedó en la oferta")
            # Comprobación EXACTA contra la fila: total = mano de obra + impuesto +
            # material + fee. Una comprobación con `or` que casi siempre se cumple
            # parece cobertura y no lo es.
            fila = await conn.fetchrow(
                "SELECT subtotal_cents s, service_tax_cents t, materials_cents m, "
                "service_fee_cents f, total_cents tot FROM job_offers WHERE id=$1",
                uuid.UUID(oid))
            check(fila["tot"] == fila["s"] + fila["t"] + fila["m"] + fila["f"],
                  f"total {fila['tot']} != {fila['s']}+{fila['t']}+{fila['m']}+{fila['f']}")
            check(fila["m"] == 15000, "el material no se guardó en la oferta")
            print(f"        -> oferta: 3h x {rate_a}c = {mano_obra_prev}c + material 15000c "
                  f"= total {od['totalCents']}c")

            step("F1b", "el cliente ve el material y su porqué ANTES de aceptar")
            r = await client.get(f"{API}/jobs/{mat_job_id}/offers", headers=hdr_c)
            check(r.status_code == 200, f"offers: {r.status_code}")
            of = next(o for o in r.json()["data"]["offers"] if o["offerId"] == oid)
            check(of["materialsCents"] == 15000, "el cliente no ve el importe del material")
            check("150" in (of["materialsNote"] or ""), "el cliente no ve la justificación")
            print(f"        -> ve 'material {of['materialsCents']}c' y \"{of['materialsNote']}\"")
            r = await client.post(f"{API}/jobs/{mat_job_id}/offers/{oid}/accept", headers=hdr_c)
            check(r.status_code == 200, f"accept material: {r.status_code}: {r.text}")

            antes = await conn.fetchrow(
                "SELECT quoted_price_cents sub, service_tax_cents tax, "
                "commission_amount_cents com, total_charged_cents tot FROM jobs WHERE id=$1",
                mat_job_id)
            mano_obra = rate_a * 3

            step("F2", "sube factura de 85.50 y se suma al total")
            r = await client.post(
                f"{API}/provider/jobs/{mat_job_id}/materials",
                headers=hdr_a,
                data={"amountCents": 8550, "merchant": "Home Depot"},
                files={"file": ("factura.jpg", b"factura-de-prueba", "image/jpeg")})
            check(r.status_code == 201, f"factura: {r.status_code}: {r.text}")
            d = r.json()["data"]
            check(d["materials_spent_cents"] == 8550, "el gasto no se registro")

            desp = await conn.fetchrow(
                "SELECT quoted_price_cents sub, service_tax_cents tax, commission_amount_cents com, "
                "provider_payout_cents pay, total_charged_cents tot, materials_spent_cents ms "
                "FROM jobs WHERE id=$1", mat_job_id)
            check(desp["tax"] == antes["tax"],
                  f"el impuesto cambio al meter material ({antes['tax']} -> {desp['tax']}): "
                  "el material NO debe llevar impuesto encima")
            check(desp["com"] == antes["com"],
                  f"la comision cambio ({antes['com']} -> {desp['com']}): el material NO paga comision")
            check(desp["pay"] == mano_obra - desp["com"] + 8550,
                  f"payout {desp['pay']} != mano de obra - comision + material")
            check(desp["tot"] > antes["tot"], "el total no subio con el material")
            print(f"        -> mano de obra {mano_obra}c · tax {desp['tax']}c (igual) · "
                  f"material {desp['ms']}c sin tax ni comision · total {desp['tot']}c")
            print(f"        -> payout proveedor {desp['pay']}c "
                  f"(= {mano_obra} - {desp['com']} + 8550)")

            step("F2b", "el exceso se mide contra la OFERTA, no contra el presupuesto")
            # Gastados 85.50 de los 150 que el proveedor cotizó. Bajo el modelo viejo
            # esto ya se habría pasado de los 100 del cliente y estaría pidiendo
            # aprobación; ahora no, porque el cliente aceptó 150.
            estado = await client.get(f"{API}/jobs/{mat_job_id}/materials", headers=hdr_c)
            check(estado.status_code == 200, f"materials: {estado.status_code}")
            e = estado.json()["data"]
            check(e["agreedCents"] == 15000, f"acordado {e['agreedCents']} != 15000")
            check(e["budgetCents"] == 10000, "el presupuesto del cliente debe conservarse")
            check(e["needsApproval"] is False,
                  "85.50 está dentro de los 150 acordados y no debería pedir aprobación")
            print(f"        -> gastado 85.50 de 150 acordados (el cliente presupuestó 100): sin fricción")

            step("F3", "pasarse de LO ACORDADO exige aprobacion del cliente")
            r = await client.post(
                f"{API}/provider/jobs/{mat_job_id}/materials",
                headers=hdr_a,
                data={"amountCents": 8000, "merchant": "Rona"},
                files={"file": ("factura2.jpg", b"factura-2", "image/jpeg")})
            check(r.status_code == 201, f"factura 2: {r.status_code}: {r.text}")
            d = r.json()["data"]
            check(d["materials_spent_cents"] == 16550, "suma de facturas mal")
            check(d["materials_agreed_cents"] == 15000, "el techo acordado cambió")
            check(d["materials_overage_cents"] == 1550,
                  f"exceso {d['materials_overage_cents']} != 16550-15000")
            check(d["needs_customer_approval"] is True, "deberia pedir aprobacion")
            print("        -> gastado 165.50 sobre 150 acordados: pide aprobacion")

            step("F4", "el cobro se bloquea hasta que el cliente aprueba")
            from src.models.job import Job as _Job
            from src.services import job_payment_service as _pay
            from src.api.deps import get_db as _get_db
            agen = _get_db()
            sesion = await agen.__anext__()
            try:
                jj = await sesion.get(_Job, mat_job_id)
                jj.stripe_payment_intent_id = "pi_smoke_fake"
                bloqueado = False
                try:
                    await _pay.capture_job(sesion, jj)
                except _pay.OverageApprovalRequiredError:
                    bloqueado = True
                except Exception:
                    bloqueado = True  # cualquier fallo previo a Stripe también frena
                check(bloqueado, "el cobro NO se bloqueo con el material sin aprobar")
            finally:
                await sesion.rollback()
                await agen.aclose()
            print("        -> capture rechazado por material sin aprobar")

            step("F5", "el cliente aprueba y la cuenta cuadra")
            r = await client.post(
                f"{API}/jobs/{mat_job_id}/materials/approve-overage", headers=hdr_c)
            check(r.status_code == 200, f"aprobar: {r.status_code}: {r.text}")
            d = r.json()["data"]
            check(d["needs_customer_approval"] is False, "sigue pidiendo aprobacion")
            esperado_total = (d["subtotal_cents"] + d["service_tax_cents"]
                              + d["materials_spent_cents"] + d["service_fee_cents"])
            check(d["total_charged_cents"] == esperado_total,
                  f"total {d['total_charged_cents']} != subtotal+tax+material+fee = {esperado_total}")
            print(f"        -> total {d['total_charged_cents']}c = mano de obra "
                  f"{d['subtotal_cents']} + tax {d['service_tax_cents']} + material "
                  f"{d['materials_spent_cents']} + fee {d['service_fee_cents']}")

            # ================= PARTE G: el admin =================
            # Se prueba por la API real del admin, con su JWT propio: es el camino que
            # usa la pantalla, y probar el servicio por dentro no vería, por ejemplo,
            # un campo que el schema del admin se coma al guardar.
            step("G1", "el admin ve el trabajo y sus ofertas")
            adm = await conn.fetchrow(
                "SELECT id, email FROM superusers WHERE is_active ORDER BY created_at LIMIT 1")
            if adm is None:
                print("        -> SALTADO: no hay superusuario en la base")
            else:
                from src.services import admin_service as _adm
                # El admin tiene su PROPIO secreto (ADMIN_JWT_SECRET): un token de
                # usuario no sirve contra estas rutas, y ese es justo el punto.
                tok = _adm.create_admin_tokens(adm["id"]).get("accessToken")
                if not tok:
                    print("        -> SALTADO: no se pudo emitir token de admin")
                else:
                    hdr_adm = {"Authorization": f"Bearer {tok}"}
                    r = await client.get(f"{API}/admin/jobs", headers=hdr_adm,
                                         params={"limit": 200})
                    check(r.status_code == 200, f"admin jobs: {r.status_code}: {r.text}")
                    encontrados = {j["id"]: j for j in r.json()["data"]["jobs"]}
                    check(str(mat_job_id) in encontrados, "el trabajo con material no sale en el admin")
                    jj = encontrados[str(mat_job_id)]
                    check(jj["materialsRequested"] is True, "el admin no ve que lleva material")
                    print(f"        -> lista OK, {len(encontrados)} trabajos, "
                          f"material {jj['materialsSpentCents']}/{jj['materialsBudgetCents']}")

                    step("G2", "el detalle explica por que un trabajo no tiene ofertas")
                    r = await client.get(f"{API}/admin/jobs/{mat_job_id}", headers=hdr_adm)
                    check(r.status_code == 200, f"admin detail: {r.status_code}: {r.text}")
                    d = r.json()["data"]
                    check("providersWithARate" in d, "falta el dato de diagnostico")
                    check(len(d["offers"]) >= 1, "el detalle no trae las ofertas")
                    check(len(d["materials"]["receipts"]) == 2, "faltan las facturas")
                    print(f"        -> {d['providersWithARate']} proveedores con tarifa, "
                          f"{len(d['offers'])} oferta(s), {len(d['materials']['receipts'])} facturas")

                    step("G3", "el admin guarda un servicio con materiales y pregunta de foto")
                    r = await client.patch(
                        f"{API}/admin/taxonomy/tasks/{mat_task_id}", headers=hdr_adm,
                        json={"materialsEnabled": True,
                              "materialsBudgetMinCents": 7000,
                              "materialsBudgetMaxCents": 25000,
                              "materialsNoteEn": "Compra pintura mate.",
                              "questions": [{"questionEn": "Colour?", "answerType": "IMAGE",
                                             "isRequired": True, "materialsOnly": True,
                                             "displayOrder": 0, "options": []}]})
                    check(r.status_code == 200, f"admin patch: {r.status_code}: {r.text}")
                    out = r.json()["data"]
                    check(out["materialsBudgetMinCents"] == 7000, "el rango de material no se guardo")
                    check(out["questions"][0]["answerType"] == "IMAGE", "la pregunta de foto no se guardo")
                    print("        -> rango 70-250 y pregunta IMAGE guardados")

                    step("G4", "activar material sin rango -> 400, no 500")
                    r = await client.patch(
                        f"{API}/admin/taxonomy/tasks/{mat_task_id}", headers=hdr_adm,
                        json={"materialsEnabled": True,
                              "materialsBudgetMinCents": None,
                              "materialsBudgetMaxCents": None})
                    check(r.status_code == 400,
                          f"esperaba 400 (Cloudflare envuelve los 5xx), dio {r.status_code}")
                    print("        -> 400 con mensaje, no un 500 envuelto por Cloudflare")

        print(f"\nTODAS LAS COMPROBACIONES PASARON ({_checks}).")

    finally:
        print("\n[limpieza] borrando datos de prueba ...")
        try:
            await _drop_job(conn, job_id)
            await _drop_job(conn, mat_job_id)
            for tid in created_tasks:
                await conn.execute("DELETE FROM provider_task_qualifications WHERE task_id=$1", tid)
                await conn.execute("DELETE FROM provider_service_rates WHERE task_id=$1", tid)
                await conn.execute("DELETE FROM service_task_questions WHERE task_id=$1", tid)
                await conn.execute("DELETE FROM service_tasks WHERE id=$1", tid)
            if tax_reg_original is not None and prov_a:
                await conn.execute(
                    "UPDATE provider_profiles SET tax_registered=$2 WHERE id=$1",
                    prov_a, tax_reg_original)
            if task_id and prov_a:
                await conn.execute(
                    "DELETE FROM provider_service_rates WHERE task_id=$1 AND provider_id = ANY($2::uuid[])",
                    task_id, [prov_a, prov_b])
            # Los proveedores vuelven a donde vivían: `_place_near` los mudó junto
            # al trabajo de prueba, y dejarlos ahí falsearía el matching real.
            for pid, (lat, lng, radius) in home_original.items():
                await conn.execute(
                    "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
                    "service_radius_km=$4, updated_at=now() WHERE id=$1",
                    pid, lat, lng, radius,
                )
            print("[limpieza] hecho")
        except Exception as exc:  # noqa: BLE001
            print(f"[limpieza] FALLO: {exc}")
        await conn.close()


if __name__ == "__main__":
    try:
        asyncio.run(run())
    except SmokeError as exc:
        print(f"\nFALLO: {exc}")
        sys.exit(1)
