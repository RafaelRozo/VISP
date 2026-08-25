"""
offerService — modelo de ofertas v2 (migración 042).

El cliente postea el trabajo y los proveedores ofertan; el cliente elige entre las
ofertas que recibe. Ver docs/plan-ofertas-v2.md.

LA IDEA EN UNA LÍNEA: un total es siempre `tarifa del proveedor × magnitud`. La tarifa
sale de su perfil, ya validada contra el rango del catálogo — el proveedor NO negocia
precio por trabajo. Lo único que aporta al ofertar es la magnitud, y solo cuando la
unidad se la pide.

De dónde sale la magnitud, que es lo único que cambia entre servicios:

    HOURLY, PER_AREA, PER_LINEAR_M  → la estima el PROVEEDOR al ofertar
    PER_UNIT                        → la declaró el CLIENTE al reservar
    PER_VISIT, FLAT_PACKAGE         → FIJA en 1

Este módulo no calcula comisión, impuesto ni payout definitivos: eso lo sella
`provider_rate_service.reprice_job_to_provider_rate` sobre el job al aceptar, que es la
única fuente contable. Aquí solo se estima lo que hace falta para PINTAR la oferta.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import case, cast, func, literal, select, type_coerce, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.types import TIME as SQLTime
from sqlalchemy.types import TIMESTAMP as SQLTimestamp

from src.models.job import (
    AssignmentStatus,
    Job,
    JobAssignment,
    JobStatus,
)
from src.models.job_offer import JobOffer, MagnitudeSource, OfferStatus
from src.models.provider import ProviderProfile
from src.models.provider_rate import ProviderServiceRate
from src.models.review import Review, ReviewStatus
from src.models.taxonomy import PricingUnit, ProviderTaskQualification, ServiceTask
from src.models.user import User
from src.services import fee_service, provider_rate_service, tax_service
from src.services.matchingEngine import (
    BID_NO_LOCATION,
    BID_NOT_QUALIFIED,
    BID_OUT_OF_RANGE,
    BID_OWN_JOB,
    provider_can_bid,
)

logger = logging.getLogger(__name__)

# Ventana durante la que un trabajo admite ofertas (decisión de Ricardo, 2026-08-19).
OFFER_WINDOW_HOURS = 48

# Unidades en las que el proveedor estima la magnitud al ofertar.
_PROVIDER_ESTIMATED = frozenset({
    PricingUnit.HOURLY,
    PricingUnit.PER_AREA,
    PricingUnit.PER_LINEAR_M,
})


# ---------------------------------------------------------------------------
# Errores — todos se mapean a 4xx en las rutas. Nunca 5xx: Cloudflare envuelve
# los 5xx en su propia página y el usuario no llega a ver el mensaje.
# ---------------------------------------------------------------------------

class OfferError(Exception):
    """Base de los errores de oferta."""


class JobNotFoundError(OfferError):
    pass


class JobNotOpenError(OfferError):
    """El trabajo ya no admite ofertas (aceptado, cancelado o ventana cerrada)."""


class NotInvitedError(OfferError):
    """El proveedor no cumple los requisitos para ofertar en este trabajo.

    Lleva el motivo (`matchingEngine.BID_*`) para que la ruta explique cuál de
    ellos falla. Un "no puedes ofertar" a secas deja al proveedor sin saber si le
    falta la calificación, si el trabajo le queda lejos o si es suyo.
    """

    def __init__(self, job_id: str, reason: str | None = None) -> None:
        self.reason = reason
        super().__init__(job_id)


class NoRateError(OfferError):
    """El proveedor no tiene tarifa activa para el servicio: sin precio no hay oferta."""


class MagnitudeRequiredError(OfferError):
    """La unidad exige que el proveedor estime la magnitud y no vino."""


class DuplicateOfferError(OfferError):
    pass


class MaterialsQuoteRequiredError(OfferError):
    """El trabajo pide material y la oferta no lo cotiza, o no explica el importe."""


class OfferNotFoundError(OfferError):
    pass


class OfferNotPendingError(OfferError):
    pass


# ---------------------------------------------------------------------------
# Magnitud
# ---------------------------------------------------------------------------

def magnitude_source_for(unit: PricingUnit) -> str:
    """Quién debe poner la magnitud para esta unidad."""
    if unit in _PROVIDER_ESTIMATED:
        return MagnitudeSource.PROVIDER
    # PER_CONTRACT: el cliente pone las HORAS y también el precio. El proveedor no
    # aporta nada al trato — acepta o no acepta.
    if unit in (PricingUnit.PER_UNIT, PricingUnit.PER_CONTRACT):
        return MagnitudeSource.CUSTOMER
    return MagnitudeSource.FLAT


def is_contract(unit: PricingUnit) -> bool:
    """En los contratos el precio ya viene puesto por el cliente y el proveedor solo
    acepta: ni cotiza, ni necesita tener tarifa para el servicio."""
    return unit == PricingUnit.PER_CONTRACT


def resolve_magnitude(
    task: ServiceTask,
    job: Job,
    provider_magnitude: Optional[Any],
) -> tuple[Decimal, str]:
    """La magnitud definitiva de la oferta y de dónde salió.

    Raises:
        MagnitudeRequiredError: la unidad la pide al proveedor y no vino (o es <= 0).
    """
    source = magnitude_source_for(task.pricing_unit)

    if source == MagnitudeSource.PROVIDER:
        if provider_magnitude is None:
            raise MagnitudeRequiredError(str(task.pricing_unit.value))
        value = Decimal(str(provider_magnitude))
        if value <= 0:
            raise MagnitudeRequiredError(str(task.pricing_unit.value))
        return value, source

    if source == MagnitudeSource.CUSTOMER:
        # El cliente la declaró al reservar. Si no lo hizo (reserva antigua o
        # servicio recién cambiado de unidad), se cae al mínimo del catálogo en vez
        # de reventar: una oferta por 1 unidad es corregible, un 500 no.
        qty = job.quantity if job.quantity is not None else task.min_quantity
        value = Decimal(str(qty or 1))
        return (value if value > 0 else Decimal(1)), source

    return Decimal(1), source


# ---------------------------------------------------------------------------
# Estimación que se pinta en la tarjeta de la oferta
# ---------------------------------------------------------------------------

async def _seller_is_tax_registered(
    db: AsyncSession, provider: ProviderProfile
) -> bool:
    """Quién vende a efectos de impuesto: la empresa si el proveedor es miembro,
    si no él mismo. Mismo criterio que el reprice, para que la estimación que ve el
    cliente coincida con lo que después se cobra."""
    from src.services import company_service

    company_id = await company_service.get_member_company_id(db, provider.user_id)
    if company_id is not None:
        from src.models.company import Company

        company = await db.get(Company, company_id)
        return bool(company and company.tax_registered)
    return bool(provider.tax_registered)


async def quote_offer(
    db: AsyncSession,
    *,
    job: Job,
    task: ServiceTask,
    provider: ProviderProfile,
    rate: Optional[ProviderServiceRate],
    magnitude: Decimal,
    materials_cents: int = 0,
) -> dict[str, Any]:
    """Desglose de la oferta para mostrar.

    El material SÍ entra en el total desde la migración 045: lo cotiza el proveedor en
    su propia oferta, así que sí distingue una oferta de otra y el cliente tiene que
    verlo sumado antes de elegir.

    Lo que NO cambia: el material no lleva impuesto encima —la tienda ya cobró el
    suyo— y no paga comisión. El fee de servicio sí se calcula sobre el total con el
    material dentro, porque es el coste de Stripe y Stripe cobra sobre lo que se cobra.
    """
    # En un contrato el subtotal sale del precio del CLIENTE, no de la tarifa del
    # proveedor: aceptar es aceptar ese trato, y cobrar otra cifra sería cambiarlo.
    if rate is None:
        subtotal = int(Decimal(job.customer_rate_cents or 0) * magnitude)
    else:
        subtotal = provider_rate_service.compute_quote_cents(rate, task, magnitude)
    registered = await _seller_is_tax_registered(db, provider)
    tax = await tax_service.compute_tax(
        db, subtotal, job.service_province_state, registered
    )
    tax_cents = tax["service_tax_cents"]
    materiales = max(0, int(materials_cents or 0))
    fee_cents = fee_service.compute_service_fee_cents(subtotal + tax_cents + materiales)
    return {
        "subtotal_cents": subtotal,
        "service_tax_cents": tax_cents,
        "tax_rate": tax["tax_rate"],
        "tax_label": tax.get("label"),
        "materials_cents": materiales,
        "service_fee_cents": fee_cents,
        "total_cents": subtotal + tax_cents + materiales + fee_cents,
    }


# ---------------------------------------------------------------------------
# Lado proveedor
# ---------------------------------------------------------------------------

def _job_is_open(job: Job) -> bool:
    if job.status != JobStatus.PENDING_MATCH:
        return False
    if job.accepted_offer_id is not None:
        return False
    if job.offers_close_at and job.offers_close_at <= datetime.now(timezone.utc):
        return False
    return True


async def list_open_jobs(
    db: AsyncSession, provider_id: uuid.UUID
) -> list[dict[str, Any]]:
    """La bolsa de trabajos abiertos del proveedor, calculada EN VIVO.

    Antes salía de los `job_assignments` en OFFERED que creaba el broadcast en el
    instante de la reserva. Ese disparo era único: si en ese momento no había
    ningún proveedor elegible —porque ninguno se había registrado todavía, o
    porque su dirección estaba mal— el trabajo quedaba huérfano para siempre.
    Nadie lo veía y nadie se enteraba, porque el broadcast falla en silencio.

    Ahora se evalúa cada vez que el proveedor abre la bolsa, con
    `matchingEngine.provider_can_bid` —el mismo predicado que valida la oferta al
    crearla—, así que ver un trabajo y poder ofertarlo no pueden divergir. Las
    `job_assignments` siguen creándose, pero ya solo como registro de a quién se
    notificó.
    """
    now = datetime.now(timezone.utc)

    # Al día antes de leer: no hay worker en marcha, así que si esto no se hace
    # aquí, un trabajo cuyo plazo venció hace tres minutos seguiría ofreciéndose.
    await expire_stale_jobs(db)

    provider = await db.get(ProviderProfile, provider_id)
    if provider is None:
        return []

    # El filtro barato va en SQL (trabajo abierto + calificado + no es suyo); el
    # caro —radio, nivel, credenciales— se aplica en `provider_can_bid` sobre lo
    # que sobreviva, que es poco.
    candidate_jobs = (
        await db.execute(
            select(Job)
            .join(
                ProviderTaskQualification,
                ProviderTaskQualification.task_id == Job.task_id,
            )
            .where(
                ProviderTaskQualification.provider_id == provider_id,
                ProviderTaskQualification.qualified.is_(True),
                Job.status == JobStatus.PENDING_MATCH,
                Job.accepted_offer_id.is_(None),
                Job.customer_id != provider.user_id,
            )
            .order_by(Job.created_at.desc())
        )
    ).scalars().all()

    task_ids = {j.task_id for j in candidate_jobs}
    tasks_by_id = {
        t.id: t
        for t in (
            await db.execute(select(ServiceTask).where(ServiceTask.id.in_(task_ids)))
        ).scalars().all()
    } if task_ids else {}

    level_cache: dict[Any, bool] = {}
    rows: list[Job] = []
    for job in candidate_jobs:
        if job.offers_close_at and job.offers_close_at <= now:
            continue
        task = tasks_by_id.get(job.task_id)
        if task is None:
            continue
        blocked = await provider_can_bid(
            db, job, provider, task=task, level_cache=level_cache
        )
        if blocked is None:
            rows.append(job)

    if not rows:
        return []

    job_ids = [j.id for j in rows]
    task_ids = {j.task_id for j in rows}

    tasks = tasks_by_id
    rates = {
        r.task_id: r
        for r in (
            await db.execute(
                select(ProviderServiceRate).where(
                    ProviderServiceRate.provider_id == provider_id,
                    ProviderServiceRate.task_id.in_(task_ids),
                    ProviderServiceRate.is_active.is_(True),
                )
            )
        ).scalars().all()
    }
    # Trabajos en los que este proveedor ya ofertó: se muestran igual, pero marcados,
    # para que no vuelva a intentarlo y se lleve un 409.
    mine = {
        o.job_id: o
        for o in (
            await db.execute(
                select(JobOffer).where(
                    JobOffer.job_id.in_(job_ids),
                    JobOffer.provider_id == provider_id,
                    JobOffer.status.in_(OfferStatus.LIVE),
                )
            )
        ).scalars().all()
    }

    items: list[dict[str, Any]] = []
    for job in rows:
        task = tasks[job.task_id]
        rate = rates.get(job.task_id)
        source = magnitude_source_for(task.pricing_unit)
        existing = mine.get(job.id)

        items.append({
            "jobId": str(job.id),
            "serviceName": task.name,
            "pricingUnit": task.pricing_unit.value,
            # Qué tiene que aportar el proveedor para poder ofertar.
            "magnitudeSource": source,
            # En un contrato el trato ya está cerrado: precio y horas los puso el
            # cliente. La app enseña "Aceptar" en vez del formulario de oferta.
            "isContract": task.pricing_unit == PricingUnit.PER_CONTRACT,
            "customerRateCents": job.customer_rate_cents,
            "customerQuantity": float(job.quantity) if job.quantity is not None else None,
            # Lo que el cliente escribió y fotografió. Es soporte de decisión: se ve
            # ANTES de ofertar, que es justo el punto de la regla del catálogo cerrado.
            "details": job.customer_details,
            "extraNote": job.customer_extra_note,
            "evidence": job.customer_evidence_json or [],
            "answers": job.customer_answers_json or [],
            "requestedDate": job.requested_date.isoformat() if job.requested_date else None,
            "requestedTimeStart": (
                job.requested_time_start.isoformat() if job.requested_time_start else None
            ),
            "city": job.service_city,
            # Material: el proveedor lo compra y se le reembolsa íntegro. Lo ve antes
            # de ofertar porque adelanta dinero de su bolsillo y eso pesa en su decisión.
            "materialsRequested": job.materials_requested,
            # El presupuesto del cliente es una REFERENCIA: le dice al proveedor que
            # hay que comprar y cuánto tenía pensado. Quien pone el importe que se
            # cobra es el proveedor, en su oferta, y tiene que justificarlo.
            "materialsBudgetCents": job.materials_budget_cents,
            "materialsQuoteRequired": job.materials_requested,
            "materialsNote": task.materials_note_en,
            # Su propia tarifa. Sin tarifa no puede ofertar.
            "myRateCents": rate.rate_cents if rate else None,
            "canOffer": (rate is not None or task.pricing_unit == PricingUnit.PER_CONTRACT)
            and existing is None,
            "alreadyOffered": existing is not None,
            "offersCloseAt": job.offers_close_at.isoformat() if job.offers_close_at else None,
        })
    return items


async def create_offer(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
    magnitude: Optional[Any] = None,
    message: Optional[str] = None,
    materials_cents: Optional[int] = None,
    materials_note: Optional[str] = None,
) -> JobOffer:
    """El proveedor oferta.

    Su TARIFA no viene del cuerpo de la petición: sale de su perfil, ya validada
    contra el rango del catálogo. Lo que sí aporta es la magnitud (las horas, los m²)
    y, si el trabajo lleva material, cuánto costará y por qué."""
    # El plazo se comprueba CERRANDO el trabajo, no leyéndolo aparte: así
    # "vencido" y "cerrado" son la misma cosa, decidida en un único sitio
    # —`job_deadline_sql`—, en vez de una regla en SQL para los listados y otra
    # escrita en Python aquí, que es como acaban divergiendo.
    await expire_stale_jobs(db, job_id=job_id)
    job = await db.get(Job, job_id)
    if job is None:
        raise JobNotFoundError(str(job_id))
    if not _job_is_open(job):
        raise JobNotOpenError(job.status.value)

    # La elegibilidad se recalcula aquí, no se lee de `job_assignments`.
    #
    # Antes bastaba con tener una invitación OFFERED, y esa invitación se había
    # emitido en el instante de la reserva: un proveedor que desde entonces se
    # hubiera mudado fuera del radio, o al que le hubieran retirado la
    # calificación, seguía pudiendo ofertar. Y al revés —el caso que rompía— quien
    # se registraba después no podía ofertar en nada. Es el MISMO predicado que
    # usa la bolsa, así que lo que se ve se puede ofertar y lo que no se ve, no.
    provider = await db.get(ProviderProfile, provider_id)
    if provider is None:
        raise NotInvitedError(str(job_id), BID_NOT_QUALIFIED)
    blocked = await provider_can_bid(db, job, provider)
    if blocked is not None:
        raise NotInvitedError(str(job_id), blocked)

    existing = (
        await db.execute(
            select(JobOffer)
            .where(
                JobOffer.job_id == job_id,
                JobOffer.provider_id == provider_id,
                JobOffer.status.in_(OfferStatus.LIVE),
            )
            .limit(1)
        )
    ).scalars().first()
    if existing is not None:
        raise DuplicateOfferError(str(existing.id))

    task = await db.get(ServiceTask, job.task_id)
    if task is None:
        raise JobNotFoundError(str(job.task_id))

    # En un contrato el precio lo puso el cliente, así que NO se le exige tarifa al
    # proveedor: exigírsela dejaría fuera a todo el mundo en la unidad donde su
    # tarifa no pinta nada.
    contrato = is_contract(task.pricing_unit)
    rate = None
    if not contrato:
        rate = (
            await db.execute(
                select(ProviderServiceRate).where(
                    ProviderServiceRate.provider_id == provider_id,
                    ProviderServiceRate.task_id == job.task_id,
                    ProviderServiceRate.is_active.is_(True),
                )
            )
        ).scalar_one_or_none()
        if rate is None:
            raise NoRateError(str(job.task_id))

    provider = await db.get(ProviderProfile, provider_id)
    if provider is None:
        raise NotInvitedError(str(provider_id))

    value, source = resolve_magnitude(task, job, magnitude)

    # Material: solo cuenta si el CLIENTE lo pidió en este trabajo. Si no, se ignora
    # lo que venga, para que nadie cuele un cargo por material en un trabajo donde el
    # cliente no aceptó ninguno.
    if job.materials_requested:
        materiales = int(materials_cents or 0)
        if materiales <= 0:
            raise MaterialsQuoteRequiredError("amount")
        nota = (materials_note or "").strip()
        if not nota:
            # La justificación es obligatoria: es lo único que le permite al cliente
            # juzgar si el importe es razonable o le están inflando la compra.
            raise MaterialsQuoteRequiredError("note")
    else:
        materiales, nota = 0, None

    quote = await quote_offer(
        db, job=job, task=task, provider=provider, rate=rate, magnitude=value,
        materials_cents=materiales,
    )

    offer = JobOffer(
        job_id=job_id,
        provider_id=provider_id,
        unit=task.pricing_unit,
        rate_cents=(rate.rate_cents if rate is not None else int(job.customer_rate_cents or 0)),
        magnitude=value,
        magnitude_source=source,
        subtotal_cents=quote["subtotal_cents"],
        service_tax_cents=quote["service_tax_cents"],
        tax_rate=quote["tax_rate"],
        service_fee_cents=quote["service_fee_cents"],
        total_cents=quote["total_cents"],
        materials_cents=materiales,
        materials_note=nota,
        message=(message or None),
        status=OfferStatus.PENDING,
        expires_at=job.offers_close_at,
    )
    db.add(offer)
    await db.flush()
    return offer


async def withdraw_offer(
    db: AsyncSession, *, job_id: uuid.UUID, provider_id: uuid.UUID
) -> JobOffer:
    """El proveedor retira su oferta. Puede volver a ofertar después: el índice único
    solo cubre las ofertas vivas."""
    offer = (
        await db.execute(
            select(JobOffer).where(
                JobOffer.job_id == job_id,
                JobOffer.provider_id == provider_id,
                JobOffer.status == OfferStatus.PENDING,
            )
        )
    ).scalar_one_or_none()
    if offer is None:
        raise OfferNotFoundError(str(job_id))
    offer.status = OfferStatus.WITHDRAWN
    offer.responded_at = datetime.now(timezone.utc)
    await db.flush()
    return offer


# ---------------------------------------------------------------------------
# Lado cliente
# ---------------------------------------------------------------------------

async def list_offers(
    db: AsyncSession, *, job_id: uuid.UUID, customer_id: uuid.UUID
) -> dict[str, Any]:
    """Las ofertas vivas del trabajo, con la tarjeta de cada proveedor.

    Todo se consulta en lote: una reserva puede juntar veinte ofertas y una consulta
    por proveedor convertiría esta pantalla en el cuello de botella de la app.
    """
    job = await db.get(Job, job_id)
    if job is None or job.customer_id != customer_id:
        raise JobNotFoundError(str(job_id))

    offers = (
        await db.execute(
            select(JobOffer)
            .where(JobOffer.job_id == job_id, JobOffer.status == OfferStatus.PENDING)
            .order_by(JobOffer.total_cents.asc(), JobOffer.created_at.asc())
        )
    ).scalars().all()

    task = await db.get(ServiceTask, job.task_id)
    payload_base = {
        "jobId": str(job_id),
        "pricingUnit": task.pricing_unit.value if task else None,
        "catalogMinCents": task.base_price_min_cents if task else None,
        "catalogMaxCents": task.base_price_max_cents if task else None,
        "materialsRequested": job.materials_requested,
        "materialsBudgetCents": job.materials_budget_cents,
        "offersCloseAt": job.offers_close_at.isoformat() if job.offers_close_at else None,
    }
    if not offers:
        return {**payload_base, "offers": [], "count": 0}

    provider_ids = [o.provider_id for o in offers]
    profiles = {
        p.id: p
        for p in (
            await db.execute(
                select(ProviderProfile).where(ProviderProfile.id.in_(provider_ids))
            )
        ).scalars().all()
    }
    user_ids = [p.user_id for p in profiles.values()]

    users = {
        u.id: u
        for u in (
            await db.execute(select(User).where(User.id.in_(user_ids)))
        ).scalars().all()
    } if user_ids else {}

    ratings = {
        uid: (float(avg), int(cnt))
        for uid, avg, cnt in (
            await db.execute(
                select(Review.reviewee_id, func.avg(Review.overall_rating), func.count(Review.id))
                .where(
                    Review.reviewee_id.in_(user_ids),
                    Review.status == ReviewStatus.PUBLISHED,
                )
                .group_by(Review.reviewee_id)
            )
        ).all()
    } if user_ids else {}

    # Trabajos completados por proveedor. Se cuentan desde `job_assignments`, no desde
    # `jobs`: la tabla de trabajos no guarda quién lo hizo — la asignación aceptada sí.
    completed = {
        pid: int(cnt)
        for pid, cnt in (
            await db.execute(
                select(JobAssignment.provider_id, func.count(JobAssignment.id))
                .where(
                    JobAssignment.provider_id.in_(provider_ids),
                    JobAssignment.status.in_(
                        [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]
                    ),
                )
                .join(Job, Job.id == JobAssignment.job_id)
                .where(Job.status == JobStatus.COMPLETED)
                .group_by(JobAssignment.provider_id)
            )
        ).all()
    }

    items: list[dict[str, Any]] = []
    for o in offers:
        prof = profiles.get(o.provider_id)
        usr = users.get(prof.user_id) if prof else None
        rating = ratings.get(prof.user_id) if prof else None
        name = None
        if usr is not None:
            name = usr.display_name or f"{usr.first_name} {usr.last_name}".strip()
        items.append({
            "offerId": str(o.id),
            "providerId": str(o.provider_id),
            "displayName": name or "Provider",
            "avatarUrl": usr.avatar_url if usr else None,
            "bio": prof.bio if prof else None,
            "level": int(prof.current_level) if prof and prof.current_level else None,
            "rating": round(rating[0], 1) if rating else None,
            "reviewCount": rating[1] if rating else 0,
            "completedJobs": completed.get(o.provider_id, 0),
            # El trabajo ofertado: "8 horas", "80 m²", "5 unidades".
            "magnitude": float(o.magnitude),
            "magnitudeSource": o.magnitude_source,
            "unit": o.unit.value,
            "rateCents": o.rate_cents,
            "subtotalCents": o.subtotal_cents,
            "serviceTaxCents": o.service_tax_cents,
            "serviceFeeCents": o.service_fee_cents,
            # Material cotizado por ESTE proveedor, con su porqué. Va aparte del
            # subtotal a propósito: no lleva impuesto encima ni paga comisión, y
            # verlo sumado haría pensar lo contrario.
            "materialsCents": o.materials_cents,
            "materialsNote": o.materials_note,
            "totalCents": o.total_cents,
            "message": o.message,
            "createdAt": o.created_at.isoformat() if o.created_at else None,
        })

    return {**payload_base, "offers": items, "count": len(items)}


async def accept_offer(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    offer_id: uuid.UUID,
    customer_id: uuid.UUID,
) -> dict[str, Any]:
    """El cliente elige una oferta: se sella el precio y el trabajo queda agendado.

    Todo en una transacción. El job se bloquea con FOR UPDATE porque dos ofertas
    aceptadas a la vez —el cliente con dos dedos, o dos pestañas— dejarían el trabajo
    con dos proveedores asignados y un solo cobro.
    """
    job = (
        await db.execute(select(Job).where(Job.id == job_id).with_for_update())
    ).scalar_one_or_none()
    if job is None or job.customer_id != customer_id:
        raise JobNotFoundError(str(job_id))
    if not _job_is_open(job):
        raise JobNotOpenError(job.status.value)

    offer = await db.get(JobOffer, offer_id)
    if offer is None or offer.job_id != job_id:
        raise OfferNotFoundError(str(offer_id))
    if offer.status != OfferStatus.PENDING:
        raise OfferNotPendingError(offer.status)

    now = datetime.now(timezone.utc)

    # La magnitud de la oferta pasa a ser la del trabajo ANTES del reprice: es lo que
    # convierte la tarifa en subtotal. Sin esto el reprice caería en la estimación del
    # catálogo y cobraría algo distinto de lo que el cliente acaba de aceptar.
    # El proveedor asignado NO vive en `jobs`: vive en `job_assignments` con estado
    # ACCEPTED, y así lo leen el pago, el matching y la cancelación. Se marca abajo.
    job.quantity = offer.magnitude
    job.accepted_offer_id = offer.id

    # El material cotizado en la oferta pasa a ser EL TECHO ACORDADO. Aceptar la
    # oferta es aprobarlo: el cliente vio el importe y su porqué antes de elegir. El
    # presupuesto que él puso al reservar se queda como referencia y deja de mandar.
    if job.materials_requested:
        job.materials_estimate_cents = offer.materials_cents

    offer.status = OfferStatus.ACCEPTED
    offer.responded_at = now

    # Precio, comisión, impuesto, fee y evento de auditoría: una sola fuente.
    quote = await provider_rate_service.reprice_job_to_provider_rate(
        db, job, offer.provider_id
    )
    if quote is None:
        # El proveedor se quedó sin tarifa activa entre ofertar y ser elegido. No se
        # cobra la oferta a ciegas: se cae con 4xx y el cliente elige otra.
        raise NoRateError(str(job.task_id))

    # Las demás ofertas se cierran: dejarlas "pendientes" haría que sus proveedores
    # sigan esperando por un trabajo que ya tiene dueño.
    losers = (
        await db.execute(
            select(JobOffer).where(
                JobOffer.job_id == job_id,
                JobOffer.id != offer.id,
                JobOffer.status == OfferStatus.PENDING,
            )
        )
    ).scalars().all()
    for lost in losers:
        lost.status = OfferStatus.REJECTED
        lost.responded_at = now

    assignments = (
        await db.execute(
            select(JobAssignment).where(
                JobAssignment.job_id == job_id,
                JobAssignment.status == AssignmentStatus.OFFERED,
            )
        )
    ).scalars().all()
    winner_assignment = None
    for a in assignments:
        if a.provider_id == offer.provider_id:
            winner_assignment = a
            a.status = AssignmentStatus.ACCEPTED
            a.responded_at = now
        else:
            a.status = AssignmentStatus.DECLINED
            a.responded_at = now

    # El ganador puede no tener invitación: desde que la bolsa se calcula en vivo,
    # se puede ofertar en un trabajo cuyo broadcast no te alcanzó (te registraste
    # después, o corregiste tu dirección). Sin esta fila el trabajo quedaría
    # SCHEDULED sin proveedor asignado, y la assignment ACCEPTED es justo lo que
    # autoriza al proveedor a verlo y trabajarlo (`realtime/handlers/jobHandler`,
    # `providerService.get_active_job`). Se crea aquí en vez de dar por hecho que
    # el broadcast la dejó.
    if winner_assignment is None:
        db.add(
            JobAssignment(
                job_id=job_id,
                provider_id=offer.provider_id,
                status=AssignmentStatus.ACCEPTED,
                offered_at=offer.created_at or now,
                responded_at=now,
            )
        )

    job.status = JobStatus.SCHEDULED
    job.price_agreed_at = now
    await db.flush()

    return {
        "job_id": str(job.id),
        "offer_id": str(offer.id),
        "provider_id": str(offer.provider_id),
        "status": job.status.value,
        "subtotal_cents": job.quoted_price_cents,
        "service_tax_cents": job.service_tax_cents,
        "service_fee_cents": job.service_fee_cents,
        "materials_budget_cents": job.materials_budget_cents,
        "total_charged_cents": job.total_charged_cents,
        "rejected_offers": len(losers),
        "quote": quote,
    }


async def reject_offer(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    offer_id: uuid.UUID,
    customer_id: uuid.UUID,
) -> JobOffer:
    """Descarta UNA oferta. El trabajo sigue abierto para las demás."""
    job = await db.get(Job, job_id)
    if job is None or job.customer_id != customer_id:
        raise JobNotFoundError(str(job_id))

    offer = await db.get(JobOffer, offer_id)
    if offer is None or offer.job_id != job_id:
        raise OfferNotFoundError(str(offer_id))
    if offer.status != OfferStatus.PENDING:
        raise OfferNotPendingError(offer.status)

    offer.status = OfferStatus.REJECTED
    offer.responded_at = datetime.now(timezone.utc)
    await db.flush()
    return offer


# ---------------------------------------------------------------------------
# Expiración (job periódico)
# ---------------------------------------------------------------------------

def default_close_at(from_time: Optional[datetime] = None) -> datetime:
    """Cierre de la ventana de ofertas de un trabajo recién posteado."""
    base = from_time or datetime.now(timezone.utc)
    return base + timedelta(hours=OFFER_WINDOW_HOURS)


async def expire_stale_offers(db: AsyncSession) -> dict[str, int]:
    """Cierra las ofertas cuya ventana ya pasó. Devuelve el recuento para el log.

    Solo toca las OFERTAS. Que el TRABAJO se cierre es cosa de
    `expire_stale_jobs`, aquí abajo.
    """
    now = datetime.now(timezone.utc)
    stale = (
        await db.execute(
            select(JobOffer).where(
                JobOffer.status == OfferStatus.PENDING,
                JobOffer.expires_at.isnot(None),
                JobOffer.expires_at <= now,
            )
        )
    ).scalars().all()
    for o in stale:
        o.status = OfferStatus.EXPIRED
        o.responded_at = now
    await db.flush()
    return {"expired_offers": len(stale)}


# La hora de `requested_time_start` es LOCAL del área de servicio, no UTC: el
# cliente que pide "el lunes a las 13:00" quiere las 13:00 de su reloj. La
# columna es un TIME sin zona, así que hay que decirle cuál es.
#
# Comparar el valor crudo contra `now()` (UTC) expiraría los trabajos CUATRO
# HORAS ANTES de tiempo en verano: las 13:00 de Toronto son las 17:00 UTC.
#
# Cuando VISP abra zonas en otro huso —Vancouver, Montreal no, misma zona— esto
# tiene que salir de `service_zones` y no de una constante.
SERVICE_TIMEZONE = "America/Toronto"

# Un trabajo sin fecha y sin ventana no puede quedarse abierto para siempre: los
# 19 trabajos anteriores a ofertas v2 nacieron con `offers_close_at` nulo y
# llevaban meses abiertos. Se les aplica la misma ventana que a los nuevos,
# contada desde que se crearon.
_FALLBACK_WINDOW = timedelta(hours=OFFER_WINDOW_HOURS)


def job_deadline_sql():
    """El instante en que un trabajo deja de admitir ofertas, como expresión SQL.

    Son DOS relojes y manda el que llegue antes:

      1. `offers_close_at` — la ventana de 48 h para recibir ofertas.
      2. la CITA (`requested_date` + `requested_time_start`) — de nada sirve
         ofertar a las 13:05 por un servicio que era a las 13:00.

    El segundo no se miraba en ninguna parte, y por eso un trabajo cuya fecha ya
    había pasado seguía apareciendo como abierto hasta que venciera su ventana,
    dos días después.

    Sin hora se toma el final del día: "el lunes" no vence el lunes a las 00:00.
    `LEAST` ignora los NULL, así que basta con que exista uno de los dos relojes;
    si no existe ninguno, se cae a la ventana desde la creación.
    """
    # `date + time` da un timestamp SIN zona, que es hora local del área; el
    # `timezone(...)` lo ancla a esa zona y devuelve ya el instante absoluto.
    cita_local = type_coerce(
        Job.requested_date + func.coalesce(
            Job.requested_time_start, cast(literal("23:59:59"), SQLTime)
        ),
        SQLTimestamp,
    )
    cita_utc = func.timezone(SERVICE_TIMEZONE, cita_local)
    return func.coalesce(
        func.least(
            Job.offers_close_at,
            case((Job.requested_date.isnot(None), cita_utc), else_=None),
        ),
        Job.created_at + _FALLBACK_WINDOW,
    )


async def expire_stale_jobs(
    db: AsyncSession, *, job_id: Optional[uuid.UUID] = None
) -> int:
    """Marca EXPIRED los trabajos abiertos a los que se les pasó el plazo.

    Se llama de forma perezosa cada vez que alguien mira la lista —el cliente sus
    trabajos, el proveedor su bolsa— además de poder correrse desde un cron. Esa
    es la razón de que sea perezosa: no hay ningún worker en marcha, así que
    depender de una tarea programada era exactamente lo que dejó 25 trabajos
    abiertos, el más viejo de febrero. Así, en el momento en que alguien abre la
    app, lo que ve ya está al día.

    Con `job_id` se limita a ese trabajo: es lo que hace `create_offer` antes de
    aceptar una oferta, para no barrer la tabla entera en cada intento.

    Devuelve cuántos cerró, para el log.
    """
    now = datetime.now(timezone.utc)
    condiciones = [
        Job.status == JobStatus.PENDING_MATCH,
        Job.accepted_offer_id.is_(None),
        job_deadline_sql() <= now,
    ]
    if job_id is not None:
        condiciones.append(Job.id == job_id)
    vencidos = (await db.execute(select(Job).where(*condiciones))).scalars().all()

    if not vencidos:
        return 0

    for job in vencidos:
        job.status = JobStatus.EXPIRED
        job.cancelled_at = now

    # Las ofertas que seguían pendientes en esos trabajos se cierran con ellos:
    # dejarlas vivas haría que sus proveedores siguieran esperando respuesta de
    # un trabajo que ya no existe.
    await db.execute(
        update(JobOffer)
        .where(
            JobOffer.job_id.in_([j.id for j in vencidos]),
            JobOffer.status == OfferStatus.PENDING,
        )
        .values(status=OfferStatus.EXPIRED, responded_at=now)
    )
    await db.flush()
    logger.info("Expirados %d trabajos por plazo vencido", len(vencidos))
    return len(vencidos)
