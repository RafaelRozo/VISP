"""Smoke de la caducidad de trabajos (migraciones 049 y 050).

Un trabajo abierto tiene DOS relojes y muere con el primero que llegue:

    1. `offers_close_at`  — la ventana de 48 h para recibir ofertas.
    2. la CITA            — `requested_date` + `requested_time_start`.

El segundo no lo miraba nadie. Resultado: 25 trabajos en PENDING_MATCH, el más
viejo del 18 de febrero, visibles para los proveedores meses después de que su
fecha hubiera pasado.

  A — la cita pasada caduca el trabajo aunque su ventana siga abierta.
  B — la ventana vencida lo caduca aunque la cita sea futura.
  C — ZONA HORARIA: un trabajo cuya cita es HOY dentro de un rato NO caduca.
      `requested_time_start` es un TIME sin zona con hora local de Ontario y la
      base corre en UTC; comparado crudo, todo lo de hoy antes de las 20:00
      locales parecería pasado y se cerrarían trabajos vivos.
  D — un trabajo caducado ya no aparece en la bolsa del proveedor y ofertar por
      él da 409, no un 500.
  E — las ofertas que quedaban vivas se cierran con el trabajo.

Las credenciales salen del .env — este script no lleva ninguna dentro.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_job_expiry.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import datetime, timedelta, timezone
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


async def _crear_job(conn, customer_id, task_id, *, fecha, hora, cierra) -> uuid.UUID:
    """Inserta un trabajo abierto con los relojes que se le pidan."""
    jid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO jobs
             (id, reference_number, customer_id, task_id, status,
              service_latitude, service_longitude, service_address, service_province_state,
              requested_date, requested_time_start, offers_close_at,
              commission_rate, created_at, updated_at)
           VALUES ($1,$2,$3,$4,'PENDING_MATCH',43.65,-79.38,'1 Smoke St','ON',
                   $5,$6,$7,0.15,now(),now())""",
        jid, f"EXP-{jid.hex[:8].upper()}", customer_id, task_id, fecha, hora, cierra,
    )
    return jid


async def _estado(conn, jid) -> str:
    return await conn.fetchval("SELECT status::text FROM jobs WHERE id=$1", jid)


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    creados: list[uuid.UUID] = []
    prov_id = None
    home_original = None
    task_id = None

    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "BD equivocada")
        print("Conectado a visp_prod\n")

        # 'EXPIRED' tiene que existir en el enum o nada de esto puede funcionar.
        labels = [
            r["enumlabel"]
            for r in await conn.fetch(
                "SELECT enumlabel FROM pg_enum e JOIN pg_type t ON t.oid=e.enumtypid "
                "WHERE t.typname='job_status'"
            )
        ]
        check("EXPIRED" in labels, "falta 'EXPIRED' en el enum job_status (migración 049)")
        print("        -> el enum job_status tiene EXPIRED")

        task = await conn.fetchrow(
            """SELECT id, name FROM service_tasks
                WHERE pricing_unit='HOURLY' AND is_active AND level='LEVEL_0'
                  AND NOT EXISTS (SELECT 1 FROM service_task_questions q
                                   WHERE q.task_id=service_tasks.id AND q.is_active AND q.is_required)
             ORDER BY name LIMIT 1"""
        )
        check(task is not None, "hace falta un servicio HOURLY activo de nivel L0")
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

        # La "hora local de Ontario" ahora mismo, que es contra lo que se compara.
        ahora_local = await conn.fetchval("SELECT (now() AT TIME ZONE 'America/Toronto')")
        hoy_local = ahora_local.date()

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://smoke") as cl:

            # ================= A =================
            step("A", "la CITA pasada caduca el trabajo aunque la ventana siga abierta")
            futuro = datetime.now(timezone.utc) + timedelta(hours=40)
            jid_a = await _crear_job(
                conn, cust, task_id,
                fecha=hoy_local - timedelta(days=1), hora=None, cierra=futuro)
            creados.append(jid_a)
            check(await _estado(conn, jid_a) == "PENDING_MATCH", "no nació abierto")
            r = await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            check(r.status_code == 200, f"open-jobs: {r.status_code}")
            check(await _estado(conn, jid_a) == "EXPIRED",
                  "la cita de ayer no caducó el trabajo — el reloj de la cita no se está mirando")
            print("        -> cita de ayer + ventana abierta 40 h = EXPIRED")

            # ================= B =================
            step("B", "la VENTANA vencida lo caduca aunque la cita sea futura")
            jid_b = await _crear_job(
                conn, cust, task_id,
                fecha=hoy_local + timedelta(days=3), hora=None,
                cierra=datetime.now(timezone.utc) - timedelta(hours=1))
            creados.append(jid_b)
            await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            check(await _estado(conn, jid_b) == "EXPIRED",
                  "la ventana vencida no caducó el trabajo")
            print("        -> cita dentro de 3 días + ventana vencida = EXPIRED")

            # ================= C =================
            step("C", "ZONA HORARIA: una cita de hoy dentro de un rato NO caduca")
            # Dos horas por delante en el reloj de Ontario. Comparado crudo contra
            # UTC esto parecería pasado durante todo el horario laboral.
            dentro_de_dos_horas = (ahora_local + timedelta(hours=2)).time().replace(microsecond=0)
            jid_c = await _crear_job(
                conn, cust, task_id,
                fecha=hoy_local, hora=dentro_de_dos_horas,
                cierra=datetime.now(timezone.utc) + timedelta(hours=40))
            creados.append(jid_c)
            r = await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            check(r.status_code == 200, f"open-jobs: {r.status_code}")
            estado_c = await _estado(conn, jid_c)
            check(estado_c == "PENDING_MATCH",
                  f"un trabajo de HOY a las {dentro_de_dos_horas} (hora de Ontario) se cerró "
                  f"antes de tiempo: quedó {estado_c}. La hora se está comparando sin zona.")
            ids = {i["jobId"] for i in r.json()["data"]["items"]}
            check(str(jid_c) in ids, "el trabajo vivo no aparece en la bolsa")
            print(f"        -> cita hoy a las {dentro_de_dos_horas} (Ontario): sigue abierto y visible")

            # ================= D =================
            step("D", "un caducado no está en la bolsa y ofertar por él da 409")
            r = await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            ids = {i["jobId"] for i in r.json()["data"]["items"]}
            check(str(jid_a) not in ids and str(jid_b) not in ids,
                  "un trabajo caducado sigue apareciendo en la bolsa")
            r = await cl.post(f"{API}/provider/open-jobs/{jid_a}/offer",
                              headers=hdr_p, json={"magnitude": 3})
            check(r.status_code == 409, f"esperaba 409 al ofertar por uno caducado, dio {r.status_code}")
            check(r.json()["detail"]["code"] == "job_not_open", "código de error inesperado")
            print("        -> fuera de la bolsa y 409 job_not_open (no un 500)")

            # ================= E =================
            step("E", "las ofertas vivas se cierran junto con el trabajo")
            jid_e = await _crear_job(
                conn, cust, task_id, fecha=hoy_local + timedelta(days=2), hora=None,
                cierra=datetime.now(timezone.utc) + timedelta(hours=40))
            creados.append(jid_e)
            oid = uuid.uuid4()
            await conn.execute(
                """INSERT INTO job_offers (id, job_id, provider_id, status, rate_cents,
                                           unit, magnitude, magnitude_source,
                                           subtotal_cents, total_cents,
                                           created_at, updated_at)
                   VALUES ($1,$2,$3,'pending',5000,'HOURLY',2,'PROVIDER',10000,10000,now(),now())""",
                oid, jid_e, prov_id)
            # Se le pasa la fecha encima.
            await conn.execute(
                "UPDATE jobs SET offers_close_at = now() - interval '1 hour' WHERE id=$1", jid_e)
            await cl.get(f"{API}/provider/open-jobs", headers=hdr_p)
            check(await _estado(conn, jid_e) == "EXPIRED", "no caducó el trabajo con oferta")
            estado_oferta = await conn.fetchval("SELECT status FROM job_offers WHERE id=$1", oid)
            check(estado_oferta == "expired",
                  f"la oferta quedó '{estado_oferta}' colgando de un trabajo caducado")
            print("        -> trabajo EXPIRED y su oferta 'expired', sin nadie esperando")

        print(f"\nTODAS LAS COMPROBACIONES PASARON ({_checks}).")

    finally:
        print("\n[limpieza] borrando datos de prueba ...")
        try:
            for jid in creados:
                await conn.execute("DELETE FROM job_offers WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", jid)
                await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", jid)
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
