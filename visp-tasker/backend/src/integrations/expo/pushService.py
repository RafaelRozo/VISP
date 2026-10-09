"""Expo Push Service — el camino de las push para iOS y Android.

La app registra un token de Expo (`ExponentPushToken[…]`), y ese token solo lo
entiende Expo: Firebase Admin (`integrations/fcm`) no sabe entregarlo. Hasta el
2026-10-09 el backend mandaba todo por FCM y la tabla `device_tokens` estaba
vacía, así que no llegaba ninguna push. Expo reenvía a APNs (iOS) y a FCM
(Android) con las credenciales que se le suben en expo.dev.

API: POST https://exp.host/--/api/v2/push/send, hasta 100 mensajes por
llamada. Cada mensaje devuelve un "ticket"; `DeviceNotRegistered` significa que
el token ya no vale (app borrada o push desactivadas) y hay que darlo de baja.

Si `EXPO_ACCESS_TOKEN` está en el entorno se manda como Bearer: solo es
obligatorio si en expo.dev se activa "Enhanced push security".
"""

from __future__ import annotations

import logging
import os
from typing import Any

import httpx

from src.integrations.fcm.pushService import BatchSendResult, SendResult

logger = logging.getLogger(__name__)

EXPO_PUSH_URL = "https://exp.host/--/api/v2/push/send"
_MAX_PER_REQUEST = 100
_TIMEOUT_S = 15.0


def is_expo_token(token: str) -> bool:
    return token.startswith("ExponentPushToken[") or token.startswith("ExpoPushToken[")


def _message(
    token: str,
    title: str,
    body: str,
    data: dict[str, Any] | None,
    badge: int | None,
    sound: str,
    priority: str,
) -> dict[str, Any]:
    msg: dict[str, Any] = {
        "to": token,
        "title": title,
        "body": body,
        "sound": sound or "default",
        "priority": "high" if priority == "high" else "normal",
        # Android: el canal que crea la app al arrancar (notificationService.ts).
        "channelId": "default",
    }
    if data:
        msg["data"] = data
    if badge is not None:
        msg["badge"] = badge
    return msg


async def send_to_tokens(
    tokens: list[str],
    title: str,
    body: str,
    data: dict[str, Any] | None = None,
    badge: int | None = None,
    sound: str = "default",
    priority: str = "high",
) -> BatchSendResult:
    """Envía la misma push a varios tokens de Expo. Nunca lanza: un fallo de red
    se cuenta como fallo, no tumba la acción que disparó la notificación."""
    result = BatchSendResult()
    if not tokens:
        return result

    headers = {"Accept": "application/json", "Content-Type": "application/json"}
    access_token = os.environ.get("EXPO_ACCESS_TOKEN")
    if access_token:
        headers["Authorization"] = f"Bearer {access_token}"

    async with httpx.AsyncClient(timeout=_TIMEOUT_S) as client:
        for i in range(0, len(tokens), _MAX_PER_REQUEST):
            lote = tokens[i : i + _MAX_PER_REQUEST]
            mensajes = [_message(t, title, body, data, badge, sound, priority) for t in lote]
            try:
                resp = await client.post(EXPO_PUSH_URL, json=mensajes, headers=headers)
                payload = resp.json()
            except Exception as exc:  # noqa: BLE001 — red o JSON roto
                logger.warning("Expo push request failed: %s", exc)
                for t in lote:
                    result.results.append(SendResult(success=False, error=str(exc)))
                    result.failure_count += 1
                continue

            if resp.status_code >= 400 or "data" not in payload:
                # Error de la petición entera (p. ej. token de acceso inválido).
                error = str(payload.get("errors") or payload)[:300]
                logger.warning("Expo push rejected (%s): %s", resp.status_code, error)
                for t in lote:
                    result.results.append(SendResult(success=False, error=error))
                    result.failure_count += 1
                continue

            for token, ticket in zip(lote, payload["data"]):
                if ticket.get("status") == "ok":
                    result.success_count += 1
                    result.results.append(SendResult(success=True, message_id=ticket.get("id")))
                    continue
                detalle = (ticket.get("details") or {}).get("error")
                invalido = detalle == "DeviceNotRegistered"
                result.failure_count += 1
                result.results.append(
                    SendResult(success=False, error=detalle or ticket.get("message"),
                               invalid_token=invalido)
                )
                if invalido:
                    result.invalid_tokens.append(token)
                logger.warning("Expo push ticket error for %s…: %s %s",
                               token[:28], detalle, ticket.get("message"))
    return result
