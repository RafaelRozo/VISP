"""Sembrar una tarjeta al cliente de un smoke, y devolverlo como estaba.

Desde 2026-09-24 `POST /jobs/book` exige método de pago: publicar un trabajo sin
tarjeta dejaba al cliente aceptando una oferta que nunca se podía retener, y el
trabajo llegaba hecho y sin autorizar. Los smokes que reservan necesitan por
tanto una tarjeta real de Stripe test mode, igual que necesitan un contrato
firmado desde que existe esa otra puerta.

Usan usuarios REALES de visp_prod, así que el `stripe_customer_id` previo se
guarda y se repone: pisarle el suyo a alguien le borraría de la app las tarjetas
que tiene guardadas. Si el cliente ya tiene tarjeta no se toca nada.

Abre su propia conexión a propósito: los smokes manejan unos `asyncpg.Connection`
y otros una sesión de SQLAlchemy, y así el sitio de llamada es UNA línea en todos.

    from _smoke_card import ensure_customer_card, restore_cards
    await ensure_customer_card(cust_id)      # tras saber quién es el cliente
    ...
    await restore_cards()                    # en la limpieza
"""

from __future__ import annotations

import uuid

import asyncpg
import stripe

from src.core.config import settings
from src.integrations.stripe.paymentService import list_payment_methods

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

# user_id -> stripe_customer_id que había antes de que el smoke lo pisara.
_previos: dict[uuid.UUID, str | None] = {}


async def ensure_customer_card(user_id: uuid.UUID) -> str:
    """Garantiza que `user_id` tenga una tarjeta utilizable. Devuelve su customer id."""
    con = await asyncpg.connect(_DSN)
    try:
        previo = await con.fetchval(
            "SELECT stripe_customer_id FROM users WHERE id=$1", user_id
        )
        if previo:
            try:
                if len(await list_payment_methods(previo)) > 0:
                    return previo  # ya puede pagar: no se toca nada
            except Exception:  # noqa: BLE001 — si Stripe no contesta, se siembra.
                pass

        cust = stripe.Customer.create(
            email=f"smoke+{uuid.uuid4().hex[:8]}@test.visp.ca",
            description="VISP smoke — tarjeta sembrada",
        )
        # `pm_card_visa` es el método de prueba de Stripe: equivale a la tarjeta
        # que el cliente teclea en la app.
        stripe.PaymentMethod.attach("pm_card_visa", customer=cust.id)
        if user_id not in _previos:
            _previos[user_id] = previo
        await con.execute(
            "UPDATE users SET stripe_customer_id=$2 WHERE id=$1", user_id, cust.id
        )
        return cust.id
    finally:
        await con.close()


async def restore_cards() -> None:
    """Devuelve todos los `stripe_customer_id` pisados a lo que eran."""
    if not _previos:
        return
    con = await asyncpg.connect(_DSN)
    try:
        for uid, previo in _previos.items():
            await con.execute(
                "UPDATE users SET stripe_customer_id=$2 WHERE id=$1", uid, previo
            )
    finally:
        await con.close()
    _previos.clear()
