"""Preparación de la cuenta — qué le falta a un usuario para poder operar.

Alimenta el checklist guiado del Home y los estados vacíos de las pantallas
(bolsa de ofertas, ganancias). Un solo sitio para los dos, porque el día que
divergen el proveedor lee "no hay trabajos disponibles" en la bolsa mientras su
Home le dice que le falta la dirección.

REGLA: este módulo **no vuelve a implementar ninguna condición**. Cada paso lee
el mismo dato que usa la puerta de verdad —`provider_can_bid` para la bolsa,
`has_valid_signature` para el contrato, `NoRateError` para la tarifa— y se limita
a contarlo. Cuando algo aquí y la puerta real no coinciden, el bug es que hay dos
fuentes de verdad, y eso ya costó 24 trabajos huérfanos una vez.

Los TEXTOS no viven aquí. Se devuelve la clave del paso y los datos que el texto
necesita (cuántos servicios, qué ciudad, cuántas fotos); la app los traduce a
inglés o francés. Un texto en el backend sería un tercer sitio donde mantener el
mismo mensaje.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.provider import ProviderProfile
from src.models.provider_rate import ProviderServiceRate
from src.models.taxonomy import PricingUnit, ProviderTaskQualification, ServiceTask
from src.models.user import User
from src.models.verification import ConsentType
from src.services.legalConsentService import has_valid_signature

# ---------------------------------------------------------------------------
# Claves de paso. Son el contrato con la app: mapean a una pantalla y a un texto.
# ---------------------------------------------------------------------------

STEP_CONTRACT = "contract"
STEP_ADDRESS = "address"
STEP_SERVICES = "services"
STEP_RATES = "rates"
STEP_PAYOUTS = "payouts"
STEP_PROFILE = "profile"

STEP_CUSTOMER_ADDRESS = "customer_address"
STEP_PAYMENT_METHOD = "payment_method"
STEP_PHONE = "phone"

# Estados. `pending` (el paso gris que aún no toca) NO está aquí a propósito:
# es presentación, la app lo deriva de cuál es el primero sin hacer. El backend
# solo dice hechos.
DONE = "done"
ACTION_REQUIRED = "action_required"
IN_REVIEW = "in_review"
BLOCKED = "blocked"

# Los 5 tramos del alta de cobros, en el orden en que Stripe los pide. Se usan
# para enseñar "Cobros · 3 de 5" y para entrar por donde lo dejó, no por el
# principio: un proveedor que ya dio su SIN no debería volver a verla.
_PAYOUT_STEPS = ["identity", "tax", "bank", "identity_doc", "tos"]

def _step(
    key: str,
    status: str,
    *,
    blocking: bool,
    meta: Optional[dict[str, Any]] = None,
) -> dict[str, Any]:
    return {"key": key, "status": status, "blocking": blocking, "meta": meta or {}}


# ---------------------------------------------------------------------------
# Proveedor
# ---------------------------------------------------------------------------

async def _payouts_step(
    db: AsyncSession, profile: ProviderProfile
) -> dict[str, Any]:
    """El paso de cobros. La verdad la tiene Stripe, no nuestra columna.

    Había un atajo tentador: leer `stripe_capabilities` y no llamar a nadie. Se
    comprobó contra visp_prod y NO SIRVE — la columna está en `{}` para las 7
    cuentas que existen, mientras Stripe dice que 6 de ellas tienen
    `card_payments` y `transfers` ACTIVAS. No está vacía porque el alta esté a
    medias: está vacía porque nadie la ha refrescado desde que se creó. Fiarse
    de ella le diría «Stripe está verificando, no hagas nada» a un proveedor que
    lleva meses pudiendo cobrar, y al revés.

    Así que:

      caché dice ACTIVA  -> hecho, sin llamar a nadie. Ese valor solo puede
                            haberlo escrito una lectura real de Stripe, y las
                            capabilities no se caen solas.
      cualquier otra cosa -> se le pregunta a Stripe y se GUARDA la respuesta.
                            La llamada se paga una vez por proveedor: en cuanto
                            queda activa ya no se repite. Y de paso arregla el
                            dato que usa la bolsa (`_payments_capability_blocks`),
                            que hoy pasa de largo porque lo ve desconocido.
      Stripe no contesta  -> se cae a lo que diga la caché, SIN mejorar el
                            estado. Se usa `get_account_status`, que lanza, y no
                            `account_can_accept_charges`, que falla ABIERTO: ahí
                            el "sí" ante la duda es correcto porque el cobro
                            vuelve a comprobarlo, pero aquí sería decirle "ya
                            está" a alguien a quien no hemos podido preguntar.
    """
    total = len(_PAYOUT_STEPS)
    if not profile.stripe_account_id:
        return _step(
            STEP_PAYOUTS, ACTION_REQUIRED, blocking=True,
            meta={"done": 0, "total": total, "resumeAt": "identity"},
        )

    caps = dict(profile.stripe_capabilities or {})
    pendientes = list(profile.stripe_requirements_due or [])

    def _activa(c: dict[str, Any]) -> bool:
        # Las capabilities NO bastan: Stripe las deja activas con el KYC a
        # medias. Mientras quede un requisito pendiente el paso NO está hecho,
        # porque `payouts_enabled` sigue en false y el proveedor no puede
        # retirar nada. Decirle "listo" ahí sería el peor verde falso de todos:
        # se pondría a trabajar creyendo que va a cobrar.
        return (
            c.get("card_payments") == "active"
            and c.get("transfers") == "active"
            and not pendientes
        )

    if not _activa(caps):
        from src.integrations.stripe.connectV2Service import get_account_status

        try:
            estado = await get_account_status(profile.stripe_account_id)
        except Exception:  # noqa: BLE001 — el Home nunca falla por Stripe.
            pass
        else:
            caps = dict(estado.capabilities or {})
            pendientes = list(estado.requirements_due or [])
            profile.stripe_capabilities = caps
            profile.stripe_requirements_due = pendientes
            if estado.onboarding_step:
                profile.stripe_onboarding_step = estado.onboarding_step
            await db.flush()

    if _activa(caps):
        return _step(STEP_PAYOUTS, DONE, blocking=True,
                     meta={"done": total, "total": total})

    paso = profile.stripe_onboarding_step or "identity"
    if paso == "complete":
        # Entregado todo y Stripe aún no lo activa: es su turno, no el del
        # proveedor. Enseñarle una tarea aquí sería mandarle a repetir lo hecho.
        return _step(STEP_PAYOUTS, IN_REVIEW, blocking=True,
                     meta={"done": total, "total": total})

    hechos = _PAYOUT_STEPS.index(paso) if paso in _PAYOUT_STEPS else 0
    return _step(
        STEP_PAYOUTS, ACTION_REQUIRED, blocking=True,
        meta={"done": hechos, "total": total, "resumeAt": paso},
    )


async def _provider_steps(
    db: AsyncSession, user: User, profile: Optional[ProviderProfile]
) -> list[dict[str, Any]]:
    firmado = await has_valid_signature(db, user.id, ConsentType.PROVIDER_IC_AGREEMENT)
    contrato = _step(STEP_CONTRACT, DONE if firmado else ACTION_REQUIRED, blocking=True)

    if profile is None:
        # Todavía no hay perfil de proveedor: todo lo demás está por hacer, y
        # decirlo es mejor que devolver una lista vacía que parece "ya está".
        return [
            contrato,
            _step(STEP_ADDRESS, ACTION_REQUIRED, blocking=True),
            _step(STEP_SERVICES, ACTION_REQUIRED, blocking=True, meta={"count": 0}),
            _step(STEP_RATES, ACTION_REQUIRED, blocking=True, meta={"withRate": 0, "total": 0}),
            _step(STEP_PAYOUTS, ACTION_REQUIRED, blocking=True,
                  meta={"done": 0, "total": len(_PAYOUT_STEPS), "resumeAt": "identity"}),
            _step(STEP_PROFILE, ACTION_REQUIRED, blocking=False, meta={"hasBio": False}),
        ]

    # --- Paso 1: dirección base y radio -------------------------------------
    # Es la dirección DECLARADA, nunca el GPS del teléfono: el GPS bloquea
    # nuestras propias pruebas desde fuera de Canadá y se falsea en dos toques.
    tiene_base = profile.home_latitude is not None and profile.home_longitude is not None
    radio = float(profile.service_radius_km or 0)
    direccion = _step(
        STEP_ADDRESS,
        DONE if (tiene_base and radio > 0) else ACTION_REQUIRED,
        blocking=True,
        # `home_city` se quedó sin escribir durante meses (solo se copiaban las
        # coordenadas), así que está NULL para casi todos. Se cae a la ciudad de
        # la dirección del usuario, que es LA MISMA que originó esas
        # coordenadas, y así las filas viejas leen bien sin un backfill.
        meta={
            "city": profile.home_city or user.default_address_city,
            "radiusKm": radio if radio > 0 else None,
        },
    )

    # --- Paso 2: servicios ---------------------------------------------------
    cualificados = (
        await db.execute(
            select(ServiceTask.id, ServiceTask.pricing_unit)
            .join(
                ProviderTaskQualification,
                ProviderTaskQualification.task_id == ServiceTask.id,
            )
            .where(
                ProviderTaskQualification.provider_id == profile.id,
                ProviderTaskQualification.qualified.is_(True),
            )
        )
    ).all()
    servicios = _step(
        STEP_SERVICES,
        DONE if cualificados else ACTION_REQUIRED,
        blocking=True,
        meta={"count": len(cualificados)},
    )

    # --- Paso 3: precio por servicio ----------------------------------------
    # Los PER_CONTRACT no llevan tarifa: el precio lo pone el cliente y el
    # proveedor acepta o no. Contarlos como "sin precio" dejaría al proveedor
    # con un paso que no puede completar nunca.
    tarifables = {tid for tid, unidad in cualificados if unidad != PricingUnit.PER_CONTRACT}
    con_tarifa: set[uuid.UUID] = set()
    if tarifables:
        con_tarifa = {
            r
            for r in (
                await db.execute(
                    select(ProviderServiceRate.task_id).where(
                        ProviderServiceRate.provider_id == profile.id,
                        ProviderServiceRate.task_id.in_(tarifables),
                        ProviderServiceRate.is_active.is_(True),
                    )
                )
            ).scalars().all()
        }
    faltan_tarifa = len(tarifables) - len(con_tarifa)
    tarifas = _step(
        STEP_RATES,
        DONE if (tarifables and faltan_tarifa == 0) else ACTION_REQUIRED,
        blocking=True,
        meta={"withRate": len(con_tarifa), "total": len(tarifables)},
    )

    # --- Paso 5: la bio (no bloquea, sube la conversión) --------------------
    #
    # SOLO la bio. Antes pedía además "3 fotos del trabajo" y contaba
    # `provider_credentials` de tipo PORTFOLIO. Las dos cosas estaban mal:
    #
    #   - El número 3 no existe en ninguna regla del backend. Venía del panel
    #     viejo del proveedor, de donde lo copié sin comprobarlo.
    #   - PORTFOLIO es el modelo ANTERIOR. La evidencia de experiencia se movió
    #     a `provider_experience_records` —expediente ÚNICO y global: CV, fotos
    #     y cartas— por decisión del cliente del 2026-08-11. Contar la tabla
    #     vieja daba 0 siempre, así que el paso era imposible de completar.
    #
    # La subida a L1 la decide un admin revisando ese expediente; no hay un
    # mínimo que el proveedor pueda "cumplir" desde aquí. El expediente vive en
    # `VerificationScreen`, y si algún día merece su propio paso será uno
    # aparte, no un añadido escondido detrás de la palabra "bio".
    tiene_bio = bool((profile.bio or "").strip())
    perfil = _step(
        STEP_PROFILE,
        DONE if tiene_bio else ACTION_REQUIRED,
        blocking=False,
        meta={"hasBio": tiene_bio},
    )

    cobros = await _payouts_step(db, profile)
    return [contrato, direccion, servicios, tarifas, cobros, perfil]


# ---------------------------------------------------------------------------
# Cliente
# ---------------------------------------------------------------------------

async def customer_has_payment_method(user: User) -> bool:
    """¿Tiene este cliente una tarjeta guardada?

    Una sola definición, porque hay DOS sitios que la necesitan y tienen que
    decir lo mismo: el paso del checklist y la puerta de la reserva
    (`POST /jobs/book`). Si divergieran, el checklist diría "tarjeta lista"
    mientras la reserva la rechaza.

    No hay columna que lo cachee y no se va a inventar: un booleano
    `has_payment_method` es estado derivado y se desincroniza en cuanto alguien
    borra la tarjeta desde Stripe.

      sin stripe_customer_id -> seguro que no tiene. Sin llamar a nadie.
      con stripe_customer_id -> se pregunta a Stripe.
      Stripe no contesta     -> se da por que SÍ tiene.

    Ese último caso es deliberado y sigue la línea de
    `account_can_accept_charges` y `_payments_capability_blocks`, que fallan
    ABIERTO. Aquí importa el doble: en el checklist, pintarle "añade tu tarjeta"
    a quien ya la tiene por una caída de red es molesto; en la reserva,
    RECHAZÁRSELA por lo mismo es perderle el trabajo. Y la retención al aceptar
    la oferta sigue siendo la comprobación final.
    """
    cliente_stripe = getattr(user, "stripe_customer_id", None)
    if not cliente_stripe:
        return False

    from src.integrations.stripe.paymentService import list_payment_methods

    try:
        return len(await list_payment_methods(cliente_stripe)) > 0
    except Exception:  # noqa: BLE001 — ni el Home ni la reserva fallan por Stripe.
        return True



async def _customer_steps(db: AsyncSession, user: User) -> list[dict[str, Any]]:
    tiene_direccion = (
        user.default_address_latitude is not None
        and user.default_address_longitude is not None
    )
    direccion = _step(
        STEP_CUSTOMER_ADDRESS,
        DONE if tiene_direccion else ACTION_REQUIRED,
        blocking=True,
        meta={"city": user.default_address_city},
    )

    tiene_tarjeta = await customer_has_payment_method(user)
    tarjeta = _step(
        STEP_PAYMENT_METHOD,
        DONE if tiene_tarjeta else ACTION_REQUIRED,
        blocking=True,
    )

    telefono = _step(
        STEP_PHONE,
        DONE if (user.phone or "").strip() else ACTION_REQUIRED,
        blocking=False,
    )

    return [direccion, tarjeta, telefono]


# ---------------------------------------------------------------------------
# API pública
# ---------------------------------------------------------------------------

async def get_readiness(
    db: AsyncSession, user: User, *, role: str
) -> dict[str, Any]:
    """Los pasos de configuración de `user` para el rol pedido.

    `role` es explícito y no se deduce del usuario porque una cuenta `both` es
    proveedor Y cliente: dos relaciones distintas con VISP, con dos contratos
    distintos y dos listas distintas. El selector de rol de la app decide cuál
    se pide.
    """
    if role == "provider":
        profile = (
            await db.execute(
                select(ProviderProfile).where(ProviderProfile.user_id == user.id)
            )
        ).scalar_one_or_none()
        pasos = await _provider_steps(db, user, profile)
    else:
        pasos = await _customer_steps(db, user)

    hechos = sum(1 for p in pasos if p["status"] == DONE)
    # `in_review` no cuenta como pendiente para el usuario —no puede hacer nada—
    # pero tampoco como hecho. Lo que decide si el checklist desaparece es que no
    # quede NADA por hacer de su parte.
    accionables = [p for p in pasos if p["status"] in (ACTION_REQUIRED, BLOCKED)]
    bloqueantes = [p for p in accionables if p["blocking"]]

    return {
        "role": role,
        "steps": pasos,
        "doneCount": hechos,
        "totalCount": len(pasos),
        # El paso destacado: el primer bloqueante sin hacer, y si no queda
        # ninguno, el primer recomendado. Solo uno se destaca — un checklist
        # donde todo grita a la vez no guía, abruma.
        "nextKey": (bloqueantes[0]["key"] if bloqueantes else
                    (accionables[0]["key"] if accionables else None)),
        "allDone": not accionables,
        "blockingCount": len(bloqueantes),
    }
