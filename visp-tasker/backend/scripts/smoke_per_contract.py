"""Smoke de `per_contract`: el cliente pone el precio (migraciones 046 y 047).

Es la INVERSIÓN del modelo: aquí la tarifa y las horas las publica el cliente
—"pago $22/h, necesito un helper 8 horas"— y el proveedor solo acepta.

  PARTE A — el precio del cliente se valida contra el rango del admin.
  PARTE B — el proveedor NO necesita tarifa propia para aceptar, y lo que se
            guarda es el precio del cliente, no el suyo.
  PARTE C — el cliente elige entre los que aceptaron y el precio se sella.
  PARTE D — cancelar a mitad cobra las HORAS COMPLETAS EMPEZADAS: 4 h 10 min → 5 h,
            nunca más de las contratadas, y da igual quién cancele.
  PARTE E — cancelar ANTES de empezar sigue siendo gratis, como en el resto.

Las credenciales salen del .env — este script no lleva ninguna dentro.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_per_contract.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
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

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

API = "/api/v1"

RANGO_MIN, RANGO_MAX = 2000, 4400     # $20–$44/h, el ejemplo de Ricardo
TARIFA_CLIENTE = 2200                 # el cliente ofrece $22/h
HORAS = 8


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
        provider_id, task_id)
    if row is None:
        await conn.execute(
            "INSERT INTO provider_task_qualifications "
            "(id, provider_id, task_id, qualified, auto_granted, qualified_at, created_at, updated_at) "
            "VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
            uuid.uuid4(), provider_id, task_id)
    else:
        await conn.execute(
            "UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1", row["id"])


async def _place_near(conn, provider_id, lat, lng, radius_km: int = 50) -> None:
    """Coloca la base del proveedor junto al trabajo, que es lo que mide el matching.

    Sustituye al viejo `_invite()`, que insertaba a mano la fila de
    `job_assignments`. La bolsa del proveedor ya no lee esas filas: se calcula en
    vivo, así que sembrarlas probaba una puerta que el producto no usa.
    """
    await conn.execute(
        "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
        "service_radius_km=$4, updated_at=now() WHERE id=$1",
        provider_id, lat, lng, radius_km)


async def _drop_job(conn, job_id) -> None:
    if job_id is None:
        return
    await conn.execute("DELETE FROM notifications WHERE data_json->>'jobId' = $1", str(job_id))
    await conn.execute("DELETE FROM job_cancellation_reports WHERE job_id=$1", job_id)
    await conn.execute("UPDATE jobs SET accepted_offer_id=NULL WHERE id=$1", job_id)
    await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", job_id)
    await conn.execute("DELETE FROM job_offers WHERE job_id=$1", job_id)
    await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
    await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    task_id = None
    jobs_creados: list[uuid.UUID] = []
    # Vacío hasta que se elijan los proveedores: el `finally` corre igual si el
    # smoke se cae antes.
    home_original: dict = {}
    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "BD equivocada")
        print("Conectado a visp_prod\n")

        # ---------- servicio de contrato ----------
        cat = await conn.fetchval("SELECT category_id FROM service_tasks LIMIT 1")
        # LEVEL_0 explícito. Antes copiaba el nivel de `service_tasks LIMIT 1`, que
        # sin ORDER BY devolvía cualquiera —salía LEVEL_2— y entonces ningún
        # proveedor L1 calificaba para el trabajo. No se notaba porque la
        # invitación se sembraba a mano; ahora el filtro de nivel se aplica de
        # verdad. Lo que se prueba aquí es `per_contract`, no los niveles.
        lvl = "LEVEL_0"
        task_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO service_tasks
               (id, category_id, slug, name, level, pricing_unit, base_price_min_cents,
                base_price_max_cents, is_active, created_at, updated_at)
               VALUES ($1,$2,$3,$4,$5::provider_level,'PER_CONTRACT',$6,$7,TRUE,now(),now())""",
            task_id, cat, f"zz-smoke-contract-{task_id.hex[:8]}",
            "ZZ SMOKE contrato — no usar", lvl, RANGO_MIN, RANGO_MAX)
        print(f"servicio de contrato creado · rango ${RANGO_MIN/100:.0f}–${RANGO_MAX/100:.0f}/h")

        # L0/L1 y orden por id: los sembrados comparten `created_at`, así que
        # `ORDER BY created_at` elegía a dos distintos en cada corrida —a veces L3,
        # que exige licencia y seguro verificados— y el smoke fallaba solo.
        provs = await conn.fetch(
            "SELECT id, user_id, home_latitude, home_longitude, service_radius_km "
            "FROM provider_profiles "
            "WHERE status = 'ACTIVE' AND current_level IN ('LEVEL_0', 'LEVEL_1') "
            "ORDER BY id LIMIT 2")
        check(len(provs) >= 2, "hacen falta 2 proveedores ACTIVE de nivel L0/L1")
        prov_a, user_a = provs[0]["id"], provs[0]["user_id"]
        prov_b, user_b = provs[1]["id"], provs[1]["user_id"]
        home_original.update({
            p["id"]: (p["home_latitude"], p["home_longitude"], p["service_radius_km"])
            for p in provs
        })
        cust = await conn.fetchval(
            "SELECT id FROM users WHERE id<>$1 AND id<>$2 ORDER BY created_at NULLS LAST LIMIT 1",
            user_a, user_b)
        await _qualify(conn, prov_a, task_id)
        await _qualify(conn, prov_b, task_id)
        # Viven donde estará el trabajo (43.65, -79.38). Nada más se prepara: que
        # aparezca en su bolsa lo decide el producto.
        await _place_near(conn, prov_a, 43.65, -79.38)
        await _place_near(conn, prov_b, 43.65, -79.38)

        hdr_a = {"Authorization": f"Bearer {auth_service.create_access_token(user_a)[0]}"}
        hdr_b = {"Authorization": f"Bearer {auth_service.create_access_token(user_b)[0]}"}
        hdr_c = {"Authorization": f"Bearer {auth_service.create_access_token(cust)[0]}"}

        base_body = {
            "locationAddress": "1 Smoke St", "locationLat": 43.65, "locationLng": -79.38,
            "provinceState": "ON", "serviceTaskId": str(task_id),
        }

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://smoke") as cl:

            # ================= PARTE A =================
            step("A1", "una tarifa por debajo del rango del admin se rechaza")
            r = await cl.post(f"{API}/jobs/book", headers=hdr_c,
                              json={**base_body, "customerRateCents": 1500, "quantity": HORAS})
            check(r.status_code == 400, f"esperaba 400, dio {r.status_code}: {r.text}")
            print("        -> 400: el rango protege igual, solo cambia a quién acota")

            step("A2", "sin tarifa tampoco se puede publicar un contrato")
            r = await cl.post(f"{API}/jobs/book", headers=hdr_c,
                              json={**base_body, "quantity": HORAS})
            check(r.status_code == 400, f"esperaba 400 sin tarifa, dio {r.status_code}")
            print("        -> 400: en un contrato el precio es del cliente y es obligatorio")

            step("A3", f"publica a ${TARIFA_CLIENTE/100:.0f}/h × {HORAS} h")
            r = await cl.post(f"{API}/jobs/book", headers=hdr_c,
                              json={**base_body, "customerRateCents": TARIFA_CLIENTE,
                                    "quantity": HORAS,
                                    "details": "Descargar material, necesito un ayudante."})
            check(r.status_code in (200, 201), f"book: {r.status_code}: {r.text}")
            job_id = uuid.UUID(r.json()["data"]["job"]["id"])
            jobs_creados.append(job_id)
            fila = await conn.fetchrow(
                "SELECT customer_rate_cents t, quantity q FROM jobs WHERE id=$1", job_id)
            check(fila["t"] == TARIFA_CLIENTE, f"tarifa guardada {fila['t']}")
            check(fila["q"] == Decimal(HORAS), f"horas guardadas {fila['q']}")
            print(f"        -> guardado: ${fila['t']/100:.0f}/h × {fila['q']} h")


            # ================= PARTE B =================
            step("B1", "el proveedor ve el trato cerrado y que solo tiene que aceptar")
            r = await cl.get(f"{API}/provider/open-jobs", headers=hdr_a)
            check(r.status_code == 200, f"open-jobs: {r.status_code}")
            it = next(i for i in r.json()["data"]["items"] if i["jobId"] == str(job_id))
            check(it["isContract"] is True, "no viene marcado como contrato")
            check(it["customerRateCents"] == TARIFA_CLIENTE, "no ve la tarifa del cliente")
            check(it["myRateCents"] is None, "no debería tener tarifa propia aquí")
            check(it["canOffer"] is True,
                  "SIN tarifa propia debe poder aceptar: en un contrato el precio no es suyo")
            print("        -> puede aceptar sin tener tarifa propia para el servicio")

            step("B2", "los dos aceptan; se guarda el precio del CLIENTE")
            for hdr, quien in ((hdr_a, "A"), (hdr_b, "B")):
                r = await cl.post(f"{API}/provider/open-jobs/{job_id}/offer",
                                  headers=hdr, json={})
                check(r.status_code == 201, f"aceptar {quien}: {r.status_code}: {r.text}")
                d = r.json()["data"]
                check(d["rateCents"] == TARIFA_CLIENTE,
                      f"{quien} guardó {d['rateCents']} en vez de la tarifa del cliente")
                check(d["subtotalCents"] == TARIFA_CLIENTE * HORAS,
                      f"{quien} subtotal {d['subtotalCents']}")
            print(f"        -> A y B aceptan a ${TARIFA_CLIENTE/100:.0f}/h "
                  f"= {TARIFA_CLIENTE*HORAS}c de mano de obra")

            # ================= PARTE C =================
            step("C", "el cliente elige entre los dos")
            r = await cl.get(f"{API}/jobs/{job_id}/offers", headers=hdr_c)
            check(r.status_code == 200, f"offers: {r.status_code}")
            ofertas = r.json()["data"]["offers"]
            check(len(ofertas) == 2, f"ve {len(ofertas)} aceptaciones, esperaba 2")
            check(len({o["totalCents"] for o in ofertas}) == 1,
                  "los totales deberían ser iguales: el precio es del cliente")
            elegida = ofertas[0]
            r = await cl.post(f"{API}/jobs/{job_id}/offers/{elegida['offerId']}/accept",
                              headers=hdr_c)
            check(r.status_code == 200, f"accept: {r.status_code}: {r.text}")
            j = await conn.fetchrow(
                "SELECT status::text s, quoted_price_cents sub FROM jobs WHERE id=$1", job_id)
            check(j["s"] == "SCHEDULED", f"estado {j['s']}")
            check(j["sub"] == TARIFA_CLIENTE * HORAS, f"subtotal sellado {j['sub']}")
            print(f"        -> mismo precio en las dos, elige persona · sellado {j['sub']}c")

            # ================= PARTE D =================
            step("D1", "cancelar a mitad cobra HORAS COMPLETAS EMPEZADAS")
            # Se simula que empezó hace 4 h 10 min: debe cobrar 5 h.
            inicio = datetime.now(timezone.utc) - timedelta(hours=4, minutes=10)
            await conn.execute(
                "UPDATE jobs SET status='IN_PROGRESS', started_at=$2 WHERE id=$1",
                job_id, inicio)
            r = await cl.post(f"{API}/jobs/{job_id}/cancel-with-reason", headers=hdr_c,
                              json={"reasonCode": "OTHER",
                                    "note": "El ayudante no rinde, prefiero parar aquí."})
            check(r.status_code == 200, f"cancelar: {r.status_code}: {r.text}")
            j = await conn.fetchrow(
                "SELECT status::text s, quantity q, quoted_price_cents sub, "
                "actual_duration_minutes m, commission_amount_cents com, "
                "provider_payout_cents pay FROM jobs WHERE id=$1", job_id)
            check(j["s"] == "CANCELLED_BY_CUSTOMER", f"estado {j['s']}")
            check(j["q"] == Decimal(5), f"cobró {j['q']} h; 4h10min son 5 h empezadas")
            check(j["sub"] == TARIFA_CLIENTE * 5, f"subtotal {j['sub']} != {TARIFA_CLIENTE*5}")
            check(250 <= (j["m"] or 0) <= 251, f"minutos trabajados {j['m']}")
            check(j["pay"] == j["sub"] - j["com"], "payout != subtotal - comisión")
            print(f"        -> 4h10min = 5 h × ${TARIFA_CLIENTE/100:.0f} = {j['sub']}c "
                  f"· comisión {j['com']}c · payout {j['pay']}c")

            step("D2", "nunca se cobra más de las horas contratadas")
            r = await cl.post(f"{API}/jobs/book", headers=hdr_c,
                              json={**base_body, "customerRateCents": TARIFA_CLIENTE,
                                    "quantity": 2, "details": "Contrato corto."})
            check(r.status_code in (200, 201), f"book: {r.status_code}")
            job2 = uuid.UUID(r.json()["data"]["job"]["id"])
            jobs_creados.append(job2)
            r = await cl.post(f"{API}/provider/open-jobs/{job2}/offer", headers=hdr_a, json={})
            check(r.status_code == 201, f"aceptar: {r.status_code}: {r.text}")
            oid = r.json()["data"]["offerId"]
            r = await cl.post(f"{API}/jobs/{job2}/offers/{oid}/accept", headers=hdr_c)
            check(r.status_code == 200, f"accept: {r.status_code}: {r.text}")
            # Se contrataron 2 h pero el reloj lleva 9: el trato eran 2.
            await conn.execute(
                "UPDATE jobs SET status='IN_PROGRESS', started_at=$2 WHERE id=$1",
                job2, datetime.now(timezone.utc) - timedelta(hours=9))
            r = await cl.post(f"{API}/jobs/{job2}/cancel-with-reason", headers=hdr_a,
                              json={"reasonCode": "UNSAFE_CONDITIONS"})
            check(r.status_code == 200, f"cancelar B: {r.status_code}: {r.text}")
            j2 = await conn.fetchrow(
                "SELECT quantity q, quoted_price_cents sub, status::text s FROM jobs WHERE id=$1", job2)
            check(j2["q"] == Decimal(2), f"cobró {j2['q']} h, contratadas 2")
            check(j2["sub"] == TARIFA_CLIENTE * 2, f"subtotal {j2['sub']}")
            check(j2["s"] == "CANCELLED_BY_PROVIDER", f"estado {j2['s']}")
            print("        -> 9 h de reloj sobre un contrato de 2 h: se cobran 2")

            # ================= PARTE E =================
            step("E", "cancelar ANTES de empezar sigue siendo gratis")
            r = await cl.post(f"{API}/jobs/book", headers=hdr_c,
                              json={**base_body, "customerRateCents": TARIFA_CLIENTE,
                                    "quantity": 4, "details": "Se cancela sin empezar."})
            job3 = uuid.UUID(r.json()["data"]["job"]["id"])
            jobs_creados.append(job3)
            r = await cl.post(f"{API}/provider/open-jobs/{job3}/offer", headers=hdr_a, json={})
            oid3 = r.json()["data"]["offerId"]
            await cl.post(f"{API}/jobs/{job3}/offers/{oid3}/accept", headers=hdr_c)
            antes = await conn.fetchrow(
                "SELECT quoted_price_cents sub FROM jobs WHERE id=$1", job3)
            r = await cl.post(f"{API}/jobs/{job3}/cancel-with-reason", headers=hdr_c,
                              json={"reasonCode": "OTHER", "note": "Me surgió un imprevisto."})
            check(r.status_code == 200, f"cancelar: {r.status_code}: {r.text}")
            j3 = await conn.fetchrow(
                "SELECT status::text s, actual_duration_minutes m, quoted_price_cents sub "
                "FROM jobs WHERE id=$1", job3)
            check(j3["s"] == "CANCELLED_BY_CUSTOMER", f"estado {j3['s']}")
            check(j3["m"] is None, f"no debería haber minutos trabajados: {j3['m']}")
            check(j3["sub"] == antes["sub"], "el precio no debería recalcularse sin empezar")
            print("        -> sin empezar: no se toca el dinero, se suelta el hold")

        print(f"\nTODAS LAS COMPROBACIONES PASARON ({_checks}).")

    finally:
        print("\n[limpieza] borrando datos de prueba ...")
        try:
            for jid in jobs_creados:
                await _drop_job(conn, jid)
            if task_id:
                await conn.execute("DELETE FROM provider_task_qualifications WHERE task_id=$1", task_id)
                await conn.execute("DELETE FROM provider_service_rates WHERE task_id=$1", task_id)
                await conn.execute("DELETE FROM service_tasks WHERE id=$1", task_id)
            # Los proveedores vuelven a donde vivían: `_place_near` los mudó junto
            # al trabajo de prueba.
            for pid, (lat, lng, radius) in home_original.items():
                await conn.execute(
                    "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
                    "service_radius_km=$4, updated_at=now() WHERE id=$1",
                    pid, lat, lng, radius)
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
