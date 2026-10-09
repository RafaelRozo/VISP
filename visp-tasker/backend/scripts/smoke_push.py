"""Smoke de las notificaciones push (2026-10-09). SOLO contra `visp_demo`.

    DATABASE_URL=postgresql+asyncpg://…/visp_demo ./venv/bin/python scripts/smoke_push.py

  A — Las rutas de /notifications piden sesión: sin token 401.
  B — Registrar el dispositivo: el dueño es el de la SESIÓN (un user_id ajeno
      en el cuerpo se ignora) y 'ios' se guarda como IOS.
  C — Las rutas con {user_id}: las del propio usuario 200, las de otro 403, y
      marcar como leída una notificación ajena da 404.
  D — Envío NATIVO a APNs (HTTP simulado, clave .p8 generada al vuelo): JWT
      ES256 con kid/iss, apns-topic, datos bajo `body`; un token que da
      BadDeviceToken en producción se reintenta en SANDBOX; 200 cuenta como
      enviado y Unregistered (410) da el token de baja.
  E — Una llamada REAL a Apple (sandbox) con la clave inventada: solo informa
      de lo que contesta (comprueba HTTP/2 y la URL). Apple debe rechazar la
      clave: InvalidProviderToken.
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
from cryptography.hazmat.primitives import serialization  # noqa: E402
from cryptography.hazmat.primitives.asymmetric import ec  # noqa: E402
import jwt  # noqa: E402

from src.integrations.apns import pushService as apnsPush  # noqa: E402
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
    original_client = apnsPush.httpx.AsyncClient
    original_cfg = (settings.apns_key_p8, settings.apns_key_id)
    try:
        H_A = {"Authorization": f"Bearer {auth_service.create_access_token(a_uid)[0]}"}
        TOKEN = uuid.uuid4().hex + uuid.uuid4().hex  # 64 hex, como un token de APNs
        TOKEN_OK = uuid.uuid4().hex + uuid.uuid4().hex

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

        # ---- D: APNs nativo con el HTTP simulado ----------------------------
        clave = ec.generate_private_key(ec.SECP256R1())
        pem = clave.private_bytes(serialization.Encoding.PEM, serialization.PrivateFormat.PKCS8,
                                  serialization.NoEncryption()).decode()
        settings.apns_key_p8, settings.apns_key_id = pem, "SMOKEKEY01"
        apnsPush._cached_jwt = None
        await conn.execute(
            "INSERT INTO device_tokens (id, user_id, device_token, platform, is_active) "
            "VALUES ($1,$2,$3,'IOS'::device_platform,TRUE)", uuid.uuid4(), a_uid, TOKEN_OK)

        llamadas: list[tuple[str, dict, dict]] = []

        def handler(request: httpx.Request) -> httpx.Response:
            host = request.url.host
            token = request.url.path.rsplit("/", 1)[-1]
            llamadas.append((host, dict(request.headers), json.loads(request.content)))
            if token == TOKEN_OK and host == "api.push.apple.com":
                return httpx.Response(200)
            if host == "api.push.apple.com":
                return httpx.Response(400, json={"reason": "BadDeviceToken"})
            return httpx.Response(410, json={"reason": "Unregistered"})

        apnsPush.httpx.AsyncClient = lambda **kw: original_client(
            transport=httpx.MockTransport(handler), timeout=kw.get("timeout"))
        async with async_session_factory() as db:
            ok = await notificationService._send_to_user(
                a_uid, "Hola", "Prueba", NotificationType.JOB_ACCEPTED, {"job_id": "123"}, db)
            await db.commit()
        hosts = [h for h, _, _ in llamadas]
        check(sorted(hosts) == sorted(["api.push.apple.com", "api.push.apple.com",
                                       "api.sandbox.push.apple.com"]),
              f"D: hosts {hosts} (el token malo debe reintentarse en sandbox)")
        _, cab, cuerpo = llamadas[0]
        check(cab["apns-topic"] == "com.droz.vispapp" and cab["apns-push-type"] == "alert",
              f"D: cabeceras {cab}")
        token_jwt = cab["authorization"].split(" ", 1)[1]
        claims = jwt.decode(token_jwt, clave.public_key(), algorithms=["ES256"])
        check(jwt.get_unverified_header(token_jwt)["kid"] == "SMOKEKEY01"
              and claims["iss"] == settings.apns_team_id, "D: JWT sin kid/iss correctos")
        check(cuerpo["aps"]["alert"] == {"title": "Hola", "body": "Prueba"}
              and cuerpo["body"] == {"job_id": "123"}, f"D: payload {cuerpo}")
        check(ok is True, "D: un 200 de Apple cuenta como enviado")
        activos = dict(await conn.fetch(
            "SELECT device_token, is_active FROM device_tokens WHERE user_id=$1", a_uid))
        check(activos[TOKEN] is False and activos[TOKEN_OK] is True,
              f"D: Unregistered debe dar de baja SOLO el token malo: {activos}")
        print("[D] JWT ES256 + cabeceras + datos en body; prod→sandbox; 200 enviado; 410 → baja")
        apnsPush.httpx.AsyncClient = original_client

        # ---- E: Apple de verdad (sandbox) con la clave inventada ----------
        apnsPush._cached_jwt = None
        async with original_client(http2=True, timeout=15) as cli:
            estado, motivo = await apnsPush._post(
                cli, apnsPush.SANDBOX_HOST, TOKEN_OK, b'{"aps":{"alert":"x"}}', "high")
        print(f"[E] Apple sandbox real → {estado} {motivo}")
        check(estado == 403 and motivo == "InvalidProviderToken",
              "E: Apple debería rechazar una clave inventada con 403 InvalidProviderToken")

        print(f"\nSMOKE PASS — {_checks} checks")
        return 0
    except AssertionError as e:
        print(f"\nSMOKE FAIL after {_checks} checks: {e}", file=sys.stderr)
        return 1
    finally:
        apnsPush.httpx.AsyncClient = original_client
        settings.apns_key_p8, settings.apns_key_id = original_cfg
        apnsPush._cached_jwt = None
        ids = [a_uid, b_uid]
        await conn.execute("DELETE FROM device_tokens WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM notifications WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM notification_preferences WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM users WHERE id = ANY($1)", ids)
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
