"""Apple Push Notification service — push a iPhone, directo, sin intermediarios.

La app registra el token NATIVO de APNs (`getDevicePushTokenAsync`, 64
caracteres hex) y aquí se envía con la API HTTP/2 de Apple, autenticada con la
clave `.p8` de developer.apple.com → Keys (token JWT ES256, que Apple acepta
hasta una hora; se renueva a los 50 minutos).

Producción y sandbox: los builds de TestFlight y de la App Store dan tokens de
PRODUCCIÓN; los que se instalan desde Xcode/`xcodebuild` con firma de
desarrollo dan tokens de SANDBOX. Un token solo vale en su entorno, así que se
prueba producción y, si Apple contesta `BadDeviceToken`, sandbox. Solo si falla
en los dos (o Apple dice `Unregistered`, 410) el token se da de baja.

Config (ver `core/config.py`): APNS_KEY_P8 o APNS_KEY_PATH, APNS_KEY_ID,
APNS_TEAM_ID, APNS_BUNDLE_ID.
"""

from __future__ import annotations

import json
import logging
import time
from pathlib import Path
from typing import Any

import httpx
import jwt

from src.core.config import settings
from src.integrations.fcm.pushService import BatchSendResult, SendResult

logger = logging.getLogger(__name__)

PRODUCTION_HOST = "https://api.push.apple.com"
SANDBOX_HOST = "https://api.sandbox.push.apple.com"
_TOKEN_TTL_S = 50 * 60
_TIMEOUT_S = 15.0

# Motivos de Apple que significan "este token no sirve" (no un fallo pasajero).
_INVALID_REASONS = {"BadDeviceToken", "Unregistered", "DeviceTokenNotForTopic"}

_cached_jwt: tuple[str, float] | None = None


class APNsNotConfiguredError(RuntimeError):
    pass


def _private_key() -> str:
    if settings.apns_key_p8:
        return settings.apns_key_p8.replace("\\n", "\n")
    if settings.apns_key_path and Path(settings.apns_key_path).is_file():
        return Path(settings.apns_key_path).read_text()
    raise APNsNotConfiguredError("APNS_KEY_P8 / APNS_KEY_PATH not set")


def is_configured() -> bool:
    return bool((settings.apns_key_p8 or settings.apns_key_path) and settings.apns_key_id)


def _provider_token() -> str:
    global _cached_jwt
    now = time.time()
    if _cached_jwt and now - _cached_jwt[1] < _TOKEN_TTL_S:
        return _cached_jwt[0]
    if not settings.apns_key_id:
        raise APNsNotConfiguredError("APNS_KEY_ID not set")
    token = jwt.encode(
        {"iss": settings.apns_team_id, "iat": int(now)},
        _private_key(),
        algorithm="ES256",
        headers={"kid": settings.apns_key_id},
    )
    _cached_jwt = (token, now)
    return token


def _payload(
    title: str, body: str, data: dict[str, Any] | None, badge: int | None, sound: str
) -> dict[str, Any]:
    aps: dict[str, Any] = {"alert": {"title": title, "body": body}, "sound": sound or "default"}
    if badge is not None:
        aps["badge"] = badge
    payload: dict[str, Any] = {"aps": aps}
    # expo-notifications en iOS saca `content.data` de la clave `body` del
    # mensaje (NotificationRecords.swift: `userInfo["body"]`), no de la raíz.
    # Sin esto, tocar la notificación no sabría a qué trabajo ir.
    if data:
        payload["body"] = data
    return payload


async def _post(
    client: httpx.AsyncClient, host: str, token: str, payload: bytes, priority: str
) -> tuple[int, str | None]:
    resp = await client.post(
        f"{host}/3/device/{token}",
        content=payload,
        headers={
            "authorization": f"bearer {_provider_token()}",
            "apns-topic": settings.apns_bundle_id,
            "apns-push-type": "alert",
            "apns-priority": "10" if priority == "high" else "5",
        },
    )
    if resp.status_code == 200:
        return 200, None
    try:
        reason = resp.json().get("reason")
    except Exception:  # noqa: BLE001
        reason = resp.text[:120]
    return resp.status_code, reason


async def send_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    badge: int | None = None,
    sound: str = "default",
    priority: str = "high",
) -> BatchSendResult:
    """Envía la misma push a varios tokens de iPhone. Nunca lanza."""
    result = BatchSendResult()
    if not tokens:
        return result
    if not is_configured():
        logger.warning("APNs not configured; %d iOS push(es) not sent", len(tokens))
        for _ in tokens:
            result.results.append(SendResult(success=False, error="apns_not_configured"))
            result.failure_count += 1
        return result

    contenido = json.dumps(_payload(title, body, data, badge, sound)).encode()
    async with httpx.AsyncClient(http2=True, timeout=_TIMEOUT_S) as client:
        for token in tokens:
            try:
                status, reason = await _post(client, PRODUCTION_HOST, token, contenido, priority)
                if status == 400 and reason == "BadDeviceToken":
                    # Puede ser un token de sandbox (build de desarrollo).
                    status, reason = await _post(client, SANDBOX_HOST, token, contenido, priority)
            except Exception as exc:  # noqa: BLE001 — red, clave mal pegada…
                logger.warning("APNs request failed: %s", exc)
                result.results.append(SendResult(success=False, error=str(exc)))
                result.failure_count += 1
                continue

            if status == 200:
                result.success_count += 1
                result.results.append(SendResult(success=True))
                continue
            invalido = status == 410 or reason in _INVALID_REASONS
            result.failure_count += 1
            result.results.append(SendResult(success=False, error=reason, invalid_token=invalido))
            if invalido:
                result.invalid_tokens.append(token)
            logger.warning("APNs %s for %s…: %s", status, token[:12], reason)
    return result
