"""Smoke del cierre del trabajo y de los choques de agenda (migración 051).

Los dos fallos que Ricardo reprodujo el 31-ago, cada uno con su comprobación:

  A — un trabajo EN CURSO que ya pasó su hora de fin genera aviso al proveedor.
      Antes no lo miraba nadie: `TSK-BD00BM`, contrato de 8 h empezado a las
      09:12, llevaba 28 h en `IN_PROGRESS`.
  B — el aviso NO se repite en cada barrido (`overdue_notified_at`), y se corta
      a los 3.
  C — RED DE SEGURIDAD: pasados 6 días desde la autorización, el sistema cierra
      el trabajo. Stripe suelta las retenciones a los 7: sin esto el cobro se
      pierde. Aquí se comprueba SIN Stripe —el trabajo no lleva PaymentIntent
      real— que la transición ocurre.
  D — un trabajo que NO ha llegado a su hora de fin se queda quieto.
  E — AGENDA: con un trabajo comprometido de 12:00 a 14:00, otro que empieza a
      las 13:00 sale en la bolsa BLOQUEADO (`canOffer=false` +
      `blockedReason=schedule_conflict`), no oculto.
  F — ofertar por ese trabajo da 4xx con el motivo, no un 500 ni un éxito.
  G — uno que empieza a las 14:00, justo cuando el otro acaba, SÍ se puede
      ofertar: el solape es estricto, sin margen de traslado.

Las credenciales salen del .env — este script no lleva ninguna dentro.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_close_and_schedule.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, time, timedelta, timezone
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

_checks = 0


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    global _checks
    _checks += 1
    if not cond:
        raise SmokeError(msg)


def step(n: str, msg: str) -> None:
    print(f"[{n}] {msg}")


async def _crear_job(
    conn, customer_id, task_id, *, estado, fecha, hora, cantidad=None,
    started_at=None, authorized_at=None, con_retencion=False,
) -> uuid.UUID:
    jid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO jobs
             (id, reference_number, customer_id, task_id, status,
              service_latitude, service_longitude, service_address, service_province_state,
              requested_date, requested_time_start, quantity, started_at,
              authorized_at, stripe_payment_intent_id, authorized_amount_cents,
              total_charged_cents, offers_close_at,
              commission_rate, created_at, updated_at)
           VALUES ($1,$2,$3,$4,$5::job_status,43.65,-79.38,'1 Smoke St','ON',
                   $6,$7,$8,$9,$10,$11,$12,$13,
                   now() + interval '40 hours', 0.15, now(), now())""",
        jid, f"SCH-{jid.hex[:8].upper()}", customer_id, task_id, estado,
        fecha, hora, cantidad, started_at, authorized_at,
        "pi_smoke_no_real" if con_retencion else None,
        26816 if con_retencion else None,
        20628 if con_retencion else None,
    )
    return jid


async def _asignar(conn, jid, prov_id) -> None:
    await conn.execute(
        """INSERT INTO job_assignments
             (id, job_id, provider_id, status, offered_at, responded_at, created_at, updated_at)
           VALUES ($1,$2,$3,'ACCEPTED',now(),now(),now(),now())""",
        uuid.uuid4(), jid, prov_id)


async def _estado(conn, jid) -> str:
    return await conn.fetchval("SELECT status::text FROM jobs WHERE id=$1", jid)


async def _barrer(db_factory) -> dict:
    from src.jobs.jobLifecycle import sweep_in_progress

    async with db_factory() as db:
        resultado = await sweep_in_progress(db)
        await db.commit()
    return resultado


async def run() -> None:
    from src.api.deps import async_session_factory

    conn = await asyncpg.connect(_DSN)
    creados: list[uuid.UUID] = []
    prov_id = None
    home_original = None

    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "BD equivocada")
        print("Conectado a visp_prod\n")

        cols = [
            r["column_name"]
            for r in await conn.fetch(
                "SELECT column_name FROM information_schema.columns WHERE table_name='jobs' "
                "AND column_name IN ('authorized_at','overdue_notified_at','overdue_notice_count')"
            )
        ]
        check(len(cols) == 3, f"falta la migración 051: solo están {cols}")
        print("        -> la migración 051 está aplicada")

        # Un servicio por CONTRATO: las horas las pone el cliente en `quantity`, que
        # es justo el caso del trabajo que se quedó colgado.
        task = await conn.fetchrow(
            """SELECT id, name FROM service_tasks
                WHERE pricing_unit='PER_CONTRACT' AND is_active
             ORDER BY name LIMIT 1"""
        )
        check(task is not None, "hace falta un servicio PER_CONTRACT activo")
        task_id = task["id"]

        prov = await conn.fetchrow(
            "SELECT id, user_id, home_latitude, home_longitude, service_radius_km "
            "FROM provider_profiles "
            "WHERE status='ACTIVE' AND current_level IN ('LEVEL_0','LEVEL_1') "
            "ORDER BY id LIMIT 1"
        )
        check(prov is not None, "hace falta un proveedor ACTIVE L0/L1")
        prov_id, prov_user = prov["id"], prov["user_id"]
        home_original = (prov["home_latitude"], prov["home_longitude"], prov["service_radius_km"])
        await conn.execute(
            "UPDATE provider_profiles SET home_latitude=43.65, home_longitude=-79.38, "
            "service_radius_km=50 WHERE id=$1", prov_id)

        row = await conn.fetchrow(
            "SELECT id FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
            prov_id, task_id)
        if row is None:
            await conn.execute(
                "INSERT INTO provider_task_qualifications "
                "(id, provider_id, task_id, qualified, auto_granted, qualified_at, created_at, updated_at) "
                "VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
                uuid.uuid4(), prov_id, task_id)
        else:
            await conn.execute(
                "UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1", row["id"])

        cust = await conn.fetchval(
            "SELECT id FROM users WHERE id <> $1 ORDER BY created_at NULLS LAST LIMIT 1", prov_user)
        hdr_p = {"Authorization": f"Bearer {auth_service.create_access_token(prov_user)[0]}"}
        print(f"servicio '{task['name']}' · proveedor {prov_id}\n")

        ahora = datetime.now(timezone.utc)
        hoy_local = (await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Toronto')")).date()

        # ================= A =================
        step("A", "un trabajo en curso que ya pasó su hora de fin genera aviso")
        # 2 h contratadas, empezado hace 5: vencido hace 3.
        jid_a = await _crear_job(
            conn, cust, task_id, estado="IN_PROGRESS", fecha=hoy_local,
            hora=time(9, 0), cantidad=2, started_at=ahora - timedelta(hours=5))
        creados.append(jid_a)
        await _asignar(conn, jid_a, prov_id)
        resultado = await _barrer(async_session_factory)
        avisos = await conn.fetchval(
            "SELECT overdue_notice_count FROM jobs WHERE id=$1", jid_a)
        check(avisos == 1, f"esperaba 1 aviso, hubo {avisos} (barrido: {resultado})")
        check(await _estado(conn, jid_a) == "IN_PROGRESS",
              "el aviso no debe cerrar el trabajo, solo avisar")
        print("        -> 1 aviso, el trabajo sigue en curso")

        # ================= B =================
        step("B", "el aviso no se repite en el siguiente barrido")
        await _barrer(async_session_factory)
        avisos = await conn.fetchval(
            "SELECT overdue_notice_count FROM jobs WHERE id=$1", jid_a)
        check(avisos == 1, f"el aviso se repitió: {avisos} avisos en dos barridos")
        print("        -> sigue en 1: la cadencia se respeta")

        # ================= C =================
        step("C", "RED DE SEGURIDAD: a los 6 días de la autorización se cierra solo")
        jid_c = await _crear_job(
            conn, cust, task_id, estado="IN_PROGRESS", fecha=hoy_local,
            hora=time(9, 0), cantidad=2, started_at=ahora - timedelta(hours=5),
            authorized_at=ahora - timedelta(days=7), con_retencion=True)
        creados.append(jid_c)
        await _asignar(conn, jid_c, prov_id)
        await _barrer(async_session_factory)
        estado_c = await _estado(conn, jid_c)
        check(estado_c == "COMPLETED",
              f"la retención iba a caducar y el trabajo quedó en {estado_c}")
        print("        -> COMPLETED antes de que Stripe soltara la retención")

        # ================= D =================
        step("D", "un trabajo que aún no llega a su hora de fin no se toca")
        jid_d = await _crear_job(
            conn, cust, task_id, estado="IN_PROGRESS", fecha=hoy_local,
            hora=time(9, 0), cantidad=8, started_at=ahora - timedelta(hours=1))
        creados.append(jid_d)
        await _asignar(conn, jid_d, prov_id)
        await _barrer(async_session_factory)
        avisos_d = await conn.fetchval(
            "SELECT overdue_notice_count FROM jobs WHERE id=$1", jid_d)
        check(avisos_d == 0, "avisó de un trabajo de 8 h que lleva 1 hora")
        check(await _estado(conn, jid_d) == "IN_PROGRESS", "cerró un trabajo en marcha")
        print("        -> intacto")

        # El trabajo D queda comprometido de 09:00 a 17:00 hora local y sirve de
        # agenda ocupada para las tres comprobaciones que siguen.

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://smoke") as cl:

            # ================= E =================
            step("E", "AGENDA: el trabajo que se pisa sale BLOQUEADO en la bolsa, no oculto")
            # Empieza a las 13:00, dentro de la ventana 09:00-17:00 del trabajo D.
            jid_e = await _crear_job(
                conn, cust, task_id, estado="PENDING_MATCH", fecha=hoy_local,
                hora=time(13, 0), cantidad=2)
            creados.append(jid_e)
            r = await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            check(r.status_code == 200, f"open-jobs: {r.status_code}")
            bolsa = {j["jobId"]: j for j in r.json()["data"]["items"]}
            fila = bolsa.get(str(jid_e))
            check(fila is not None,
                  "el trabajo en choque desapareció de la bolsa en vez de salir marcado")
            check(fila["canOffer"] is False, "el trabajo en choque salió ofertable")
            check(fila["blockedReason"] == "schedule_conflict",
                  f"motivo equivocado: {fila['blockedReason']}")
            print("        -> visible, canOffer=false, blockedReason=schedule_conflict")

            # ================= F =================
            step("F", "ofertar por él da 4xx con el motivo, no 500 ni éxito")
            r = await cl.post(
                f"{API}/provider/open-jobs/{jid_e}/offer",
                headers=hdr_p,
                json={"magnitude": 2},
            )
            check(400 <= r.status_code < 500,
                  f"esperaba 4xx y llegó {r.status_code}: {r.text[:200]}")
            detalle = r.json().get("detail", {})
            motivo = detalle.get("reason") if isinstance(detalle, dict) else None
            check(motivo == "schedule_conflict",
                  f"el 4xx no explica el choque de agenda: {detalle}")
            print(f"        -> {r.status_code} con reason=schedule_conflict")

            # ================= G =================
            step("G", "uno que empieza justo cuando el otro acaba SÍ se puede ofertar")
            jid_g = await _crear_job(
                conn, cust, task_id, estado="PENDING_MATCH", fecha=hoy_local,
                hora=time(17, 0), cantidad=1)
            creados.append(jid_g)
            r = await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            bolsa = {j["jobId"]: j for j in r.json()["data"]["items"]}
            fila_g = bolsa.get(str(jid_g))
            check(fila_g is not None, "el trabajo pegado al anterior no salió en la bolsa")
            check(fila_g["blockedReason"] is None,
                  "empezar a las 17:00 cuando el otro acaba a las 17:00 no es un solape")
            print("        -> sin choque: el solape es estricto")

        print(f"\nTODAS LAS COMPROBACIONES PASARON ({_checks}).")

    finally:
        print("\n[limpieza] borrando datos de prueba ...")
        try:
            for jid in creados:
                await conn.execute("DELETE FROM job_offers WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", jid)
                # Las notificaciones no cuelgan del trabajo (no hay `job_id`): el
                # trabajo va dentro de `data_json`, así que se borran por ahí.
                await conn.execute(
                    "DELETE FROM notifications WHERE data_json->>'job_id' = $1", str(jid))
                await conn.execute("DELETE FROM jobs WHERE id=$1", jid)
            if prov_id and home_original is not None:
                await conn.execute(
                    "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
                    "service_radius_km=$4 WHERE id=$1", prov_id, *home_original)
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
