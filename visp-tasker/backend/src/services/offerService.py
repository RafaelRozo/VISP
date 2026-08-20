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

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

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
from src.models.taxonomy import PricingUnit, ServiceTask
from src.models.user import User
from src.services import fee_service, provider_rate_service, tax_service

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
    """El proveedor no está entre los calificados para este trabajo."""


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
    if unit == PricingUnit.PER_UNIT:
        return MagnitudeSource.CUSTOMER
    return MagnitudeSource.FLAT


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
    rate: ProviderServiceRate,
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
    """La bolsa de trabajos abiertos del proveedor.

    Sale de los `job_assignments` en OFFERED que ya creó el broadcast del booking: el
    filtrado duro (zona, nivel, calificación, credenciales) lo hizo el motor de
    matching en ese momento, así que aquí no se vuelve a calcular nada.
    """
    now = datetime.now(timezone.utc)
    rows = (
        await db.execute(
            select(Job, JobAssignment)
            .join(JobAssignment, JobAssignment.job_id == Job.id)
            .where(
                JobAssignment.provider_id == provider_id,
                JobAssignment.status == AssignmentStatus.OFFERED,
                Job.status == JobStatus.PENDING_MATCH,
                Job.accepted_offer_id.is_(None),
            )
            .order_by(Job.created_at.desc())
        )
    ).all()

    if not rows:
        return []

    job_ids = [j.id for j, _ in rows]
    task_ids = {j.task_id for j, _ in rows}

    tasks = {
        t.id: t
        for t in (
            await db.execute(select(ServiceTask).where(ServiceTask.id.in_(task_ids)))
        ).scalars().all()
    }
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
    for job, _assignment in rows:
        if job.offers_close_at and job.offers_close_at <= now:
            continue
        task = tasks.get(job.task_id)
        if task is None:
            continue
        rate = rates.get(job.task_id)
        source = magnitude_source_for(task.pricing_unit)
        existing = mine.get(job.id)

        items.append({
            "jobId": str(job.id),
            "serviceName": task.name,
            "pricingUnit": task.pricing_unit.value,
            # Qué tiene que aportar el proveedor para poder ofertar.
            "magnitudeSource": source,
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
            "canOffer": rate is not None and existing is None,
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
    job = await db.get(Job, job_id)
    if job is None:
        raise JobNotFoundError(str(job_id))
    if not _job_is_open(job):
        raise JobNotOpenError(job.status.value)

    # `.first()` y no `.scalar_one_or_none()`: `job_assignments` no tiene índice único
    # por (job, proveedor), así que un reintento del broadcast puede dejar la
    # invitación duplicada. Basta con que exista UNA; exigir exactamente una convierte
    # un duplicado inocuo en un 500.
    invited = (
        await db.execute(
            select(JobAssignment)
            .where(
                JobAssignment.job_id == job_id,
                JobAssignment.provider_id == provider_id,
                JobAssignment.status == AssignmentStatus.OFFERED,
            )
            .limit(1)
        )
    ).scalars().first()
    if invited is None:
        raise NotInvitedError(str(job_id))

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
        rate_cents=rate.rate_cents,
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
    for a in assignments:
        if a.provider_id == offer.provider_id:
            a.status = AssignmentStatus.ACCEPTED
            a.responded_at = now
        else:
            a.status = AssignmentStatus.DECLINED
            a.responded_at = now

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

    No cancela el trabajo: un trabajo sin ofertas sigue siendo del cliente, que decide
    si lo repone o lo cancela. Cancelarlo por él sería decidir en su nombre.
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
