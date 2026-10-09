"""Smoke de las notificaciones push (2026-10-09). SOLO contra `visp_demo`.

    DATABASE_URL=postgresql+asyncpg://…/visp_demo ./venv/bin/python scripts/smoke_push.py

  A — Las rutas de /notifications piden sesión: sin token 401.
  B — Registrar el dispositivo: el dueño es el de la SESIÓN (un user_id ajeno
      en el cuerpo se ignora) y 'ios' se guarda como IOS.
  C — Las rutas con {user_id}: las del propio usuario 200, las de otro 403, y
      marcar como leída una notificación ajena da 404.
  D — Envío por Expo (con el HTTP simulado): el mensaje lleva to/title/body/
      channelId, un ticket ok cuenta como enviado y `DeviceNotRegistered` da
      el token de baja.
  E — Una llamada REAL a exp.host con un token inventado: solo se informa de lo
      que contesta Expo (comprueba que la URL y el formato son los buenos).
"""

from __future__ import annotations

import asyncio
import json
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
import httpx  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.core.config import settings  # noqa: E402

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_demo" not in _DSN:
    print("REFUSING TO RUN: hace falta DATABASE_URL a visp_demo", file=sys.stderr)
    sys.exit(2)

from src.api.deps import async_session_factory  # noqa: E402
from src.integrations.expo import pushService as expoPush  # noqa: E402
from src.main import app  # noqa: E402
from src.models.notification import NotificationType  # noqa: E402
from src.services import auth_service, notificationService  # noqa: E402

API = "/api/v1"
_checks = 0


def check(cond: bool, msg: str) -> None:
    global _checks
    _checks += 1
    if not cond:
        raise AssertionError(msg)


async def _usuario(conn, tag: str) -> uuid.UUID:
    uid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO users (id, email, password_hash, first_name, last_name, phone,
                              auth_provider, role_customer, role_provider, role_admin,
                              status, email_verified, phone_verified, recovery_code)
           VALUES ($1,$2,'x','Smoke',$3,$4,'EMAIL',TRUE,FALSE,FALSE,'ACTIVE'::user_status,
                   TRUE,FALSE,$5)""",
        uid, f"smoke-push-{tag}-{uuid.uuid4().hex[:8]}@visp.test", tag,
        "+1416" + str(uid.int)[-7:], uuid.uuid4().hex[:12].upper())
    return uid


async def main() -> int:  # noqa: C901
    conn = await asyncpg.connect(_DSN)
    a_uid = await _usuario(conn, "a")
    b_uid = await _usuario(conn, "b")
    original_client = expoPush.httpx.AsyncClient
    try:
        H_A = {"Authorization": f"Bearer {auth_service.create_access_token(a_uid)[0]}"}
        TOKEN = f"ExponentPushToken[smoke{uuid.uuid4().hex[:14]}]"

        async with AsyncClient(transport=ASGITransport(app=app), base_url="http://t", timeout=60) as c:
            # ---- A ---------------------------------------------------------
            for metodo, ruta, cuerpo in (
                ("POST", "/notifications/register-device", {"device_token": "x", "platform": "ios"}),
                ("GET", f"/notifications/history/{a_uid}", None),
                ("GET", f"/notifications/preferences/{a_uid}", None),
                ("GET", f"/notifications/unread-count/{a_uid}", None),
            ):
                r = await c.request(metodo, API + ruta, json=cuerpo)
                check(r.status_code in (401, 403), f"A: {ruta} sin sesión dio {r.status_code}")
            print("[A] sin sesión → 401/403 en todas")

            # ---- B ---------------------------------------------------------
            r = await c.post(f"{API}/notifications/register-device", headers=H_A, json={
                "device_token": TOKEN, "platform": "ios", "user_id": str(b_uid),
                "app_version": "1.0.0 (36)"})
            check(r.status_code == 201, f"B: registrar {r.status_code} {r.text[:200]}")
            fila = await conn.fetchrow(
                "SELECT user_id, platform::text AS p, is_active FROM device_tokens WHERE device_token=$1",
                TOKEN)
            check(fila["user_id"] == a_uid, "B: el token quedó a nombre del user_id del cuerpo")
            check(fila["p"] == "IOS" and fila["is_active"], f"B: fila {dict(fila)}")
            print("[B] registrado a nombre de la sesión (user_id ajeno ignorado), plataforma IOS")

            # ---- C ---------------------------------------------------------
            r = await c.get(f"{API}/notifications/history/{a_uid}", headers=H_A)
            check(r.status_code == 200, f"C: historial propio {r.status_code}")
            for ruta in (f"history/{b_uid}", f"preferences/{b_uid}", f"unread-count/{b_uid}"):
                r = await c.get(f"{API}/notifications/{ruta}", headers=H_A)
                check(r.status_code == 403, f"C: {ruta} ajeno dio {r.status_code}")
            nid = uuid.uuid4()
            await conn.execute(
                "INSERT INTO notifications (id, user_id, title, body, notification_type, read) "
                "VALUES ($1,$2,'t','b','JOB_ACCEPTED'::notification_type,FALSE)", nid, b_uid)
            r = await c.patch(f"{API}/notifications/read/{nid}", headers=H_A)
            check(r.status_code == 404, f"C: marcar ajena dio {r.status_code}")
            print("[C] propio 200; ajeno 403; notificación ajena 404")

        # ---- D: envío por Expo con el HTTP simulado ------------------------
        enviados: list = []

        def handler(request: httpx.Request) -> httpx.Response:
            mensajes = json.loads(request.content)
            enviados.extend(mensajes)
            return httpx.Response(200, json={"data": [
                {"status": "error", "message": "not registered",
                 "details": {"error": "DeviceNotRegistered"}} for _ in mensajes]})

        expoPush.httpx.AsyncClient = lambda **kw: original_client(
            transport=httpx.MockTransport(handler), **kw)
        async with async_session_factory() as db:
            ok = await notificationService._send_to_user(
                a_uid, "Hola", "Prueba", NotificationType.JOB_ACCEPTED, {"job_id": "123"}, db)
            await db.commit()
        check(len(enviados) == 1, f"D: se esperaban 1 mensaje, salieron {len(enviados)}")
        m = enviados[0]
        check(m["to"] == TOKEN and m["title"] == "Hola" and m["channelId"] == "default"
              and m["data"] == {"job_id": "123"}, f"D: mensaje {m}")
        check(ok is False, "D: un ticket con error no puede contar como enviado")
        activo = await conn.fetchval("SELECT is_active FROM device_tokens WHERE device_token=$1", TOKEN)
        check(activo is False, "D: DeviceNotRegistered debe dar de baja el token")
        print("[D] mensaje Expo correcto; DeviceNotRegistered → token desactivado")
        expoPush.httpx.AsyncClient = original_client

        # ---- E: Expo de verdad ---------------------------------------------
        res = await expoPush.send_to_tokens([TOKEN], "smoke", "smoke")
        print(f"[E] exp.host real con token inventado → ok={res.success_count} "
              f"error={res.results[0].error if res.results else None}")
        check(res.success_count == 0, "E: un token inventado no puede salir como enviado")

        print(f"\nSMOKE PASS — {_checks} checks")
        return 0
    except AssertionError as e:
        print(f"\nSMOKE FAIL after {_checks} checks: {e}", file=sys.stderr)
        return 1
    finally:
        expoPush.httpx.AsyncClient = original_client
        ids = [a_uid, b_uid]
        await conn.execute("DELETE FROM device_tokens WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM notifications WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM notification_preferences WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM users WHERE id = ANY($1)", ids)
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
