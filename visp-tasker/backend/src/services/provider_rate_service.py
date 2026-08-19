"""Business logic for provider-set service rates (Provider-Set Pricing · PP2).

A provider may only price a service they are *qualified* for (the per-task
``ProviderTaskQualification.qualified`` flag — the "sin documentos pendientes"
gate). The rate is clamped to the task's
``base_price_min_cents..base_price_max_cents`` guardrail (D1). Custom-quote
tasks are negotiated per job and cannot carry a fixed rate.
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.pricing import PricingEvent, PricingEventType
from src.models.provider import ProviderProfile
from src.models.provider_rate import ProviderServiceRate
from src.models.taxonomy import (
    PricingUnit,
    ProviderTaskQualification,
    ServiceTask,
)
from src.services import fee_service, tax_service

# VISP commission by provider level in the provider-set-pricing model — midpoints
# of the CLAUDE.md ranges (L1 15-20, L2 12-18, L3 8-12, L4 15-25). Applied to the
# subtotal when the job has no commission_rate set at booking (create_job leaves
# it unset because no provider is assigned yet).
_LEVEL_COMMISSION: dict[str, Decimal] = {
    "1": Decimal("0.175"),
    "2": Decimal("0.15"),
    "3": Decimal("0.10"),
    "4": Decimal("0.20"),
}
_DEFAULT_COMMISSION = Decimal("0.175")


def commission_rate_for_level(level: Any) -> Decimal:
    """VISP's commission fraction for a provider level (enum, its .value, or int)."""
    key = getattr(level, "value", level)
    return _LEVEL_COMMISSION.get(str(key), _DEFAULT_COMMISSION)


# ---------------------------------------------------------------------------
# Exceptions (mapped to 4xx by the route layer — never 5xx, Cloudflare rule)
# ---------------------------------------------------------------------------


class RateTaskNotFoundError(Exception):
    """The task does not exist in the catalog."""


class NotQualifiedError(Exception):
    """The provider is not qualified for this task (docs pending / not approved)."""


class CustomQuoteNoRateError(Exception):
    """Custom-quote tasks are negotiated per job and take no fixed rate."""


class PriceOutOfRangeError(Exception):
    """The rate falls outside the task's allowed guardrail range."""

    def __init__(self, min_cents: Optional[int], max_cents: Optional[int]) -> None:
        self.min_cents = min_cents
        self.max_cents = max_cents
        super().__init__(
            f"Rate must be within {min_cents}..{max_cents} cents for this service."
        )


# ---------------------------------------------------------------------------
# Reads
# ---------------------------------------------------------------------------


async def list_priceable_services(
    db: AsyncSession, provider_id: uuid.UUID
) -> list[dict[str, Any]]:
    """Every task the provider is qualified for, with its guardrail and the
    provider's current rate (or ``None`` if unset). Drives the "Mis precios"
    screen."""
    qual_stmt = (
        select(ServiceTask)
        .join(
            ProviderTaskQualification,
            ProviderTaskQualification.task_id == ServiceTask.id,
        )
        .where(
            ProviderTaskQualification.provider_id == provider_id,
            ProviderTaskQualification.qualified.is_(True),
        )
        .order_by(ServiceTask.name.asc())
    )
    tasks = (await db.execute(qual_stmt)).scalars().all()

    rate_stmt = select(ProviderServiceRate).where(
        ProviderServiceRate.provider_id == provider_id
    )
    rates_by_task = {
        r.task_id: r for r in (await db.execute(rate_stmt)).scalars().all()
    }

    out: list[dict[str, Any]] = []
    for task in tasks:
        rate = rates_by_task.get(task.id)
        out.append(
            {
                "task_id": str(task.id),
                "task_name": task.name,
                "task_slug": task.slug,
                "level": task.level.value,
                "pricing_unit": task.pricing_unit.value,
                "allows_quantity": task.allows_quantity,
                "base_price_min_cents": task.base_price_min_cents,
                "base_price_max_cents": task.base_price_max_cents,
                "is_custom_quote": task.pricing_unit == PricingUnit.CUSTOM_QUOTE,
                "rate_cents": rate.rate_cents if rate else None,
                "min_charge_cents": rate.min_charge_cents if rate else None,
                "is_active": rate.is_active if rate else False,
            }
        )
    return out


# ---------------------------------------------------------------------------
# Writes
# ---------------------------------------------------------------------------


async def set_rate(
    db: AsyncSession,
    provider_id: uuid.UUID,
    task_id: uuid.UUID,
    *,
    rate_cents: int,
    min_charge_cents: Optional[int] = None,
) -> ProviderServiceRate:
    """Create or update the provider's rate for ``task_id``.

    Raises:
        RateTaskNotFoundError: task missing.
        NotQualifiedError: provider not qualified for the task.
        CustomQuoteNoRateError: task is CUSTOM_QUOTE.
        PriceOutOfRangeError: rate outside the task guardrail.
    """
    task = (
        await db.execute(select(ServiceTask).where(ServiceTask.id == task_id))
    ).scalar_one_or_none()
    if task is None:
        raise RateTaskNotFoundError(str(task_id))

    qual = (
        await db.execute(
            select(ProviderTaskQualification).where(
                ProviderTaskQualification.provider_id == provider_id,
                ProviderTaskQualification.task_id == task_id,
            )
        )
    ).scalar_one_or_none()
    if qual is None or not qual.qualified:
        raise NotQualifiedError(str(task_id))

    if task.pricing_unit == PricingUnit.CUSTOM_QUOTE:
        raise CustomQuoteNoRateError(str(task_id))

    # Guardrail (D1): clamp to the catalog range when one is defined. A task
    # with no range (both bounds NULL) accepts any non-negative rate.
    lo = task.base_price_min_cents
    hi = task.base_price_max_cents
    if (lo is not None and rate_cents < lo) or (hi is not None and rate_cents > hi):
        raise PriceOutOfRangeError(lo, hi)

    existing = (
        await db.execute(
            select(ProviderServiceRate).where(
                ProviderServiceRate.provider_id == provider_id,
                ProviderServiceRate.task_id == task_id,
            )
        )
    ).scalar_one_or_none()

    if existing is None:
        existing = ProviderServiceRate(
            provider_id=provider_id,
            task_id=task_id,
            unit=task.pricing_unit,
            rate_cents=rate_cents,
            min_charge_cents=min_charge_cents,
            is_active=True,
        )
        db.add(existing)
    else:
        existing.unit = task.pricing_unit
        existing.rate_cents = rate_cents
        existing.min_charge_cents = min_charge_cents
        existing.is_active = True

    await db.flush()
    return existing


# ---------------------------------------------------------------------------
# Quote from a provider's rate (PP4 — customer sees the provider's price)
# ---------------------------------------------------------------------------


def estimate_quantity_for(task: ServiceTask) -> Decimal:
    """Default booking quantity used to turn a rate into an estimate.

    HOURLY → the task's estimated duration in hours (min 1). Everything else
    defaults to 1 unit. Used when the customer did not confirm a quantity.
    """
    if task.pricing_unit == PricingUnit.HOURLY:
        mins = task.estimated_duration_min or 60
        return Decimal(max(1, round(mins / 60)))
    return Decimal(1)


def resolve_quantity(task: ServiceTask, job_quantity: Optional[Any]) -> Decimal:
    """The quantity to price against: whatever the job carries, otherwise the
    catalog estimate.

    No longer gated on ``task.allows_quantity`` (offers v2, 2026-08-19). That flag
    answers "does the CUSTOMER type the quantity at booking?", which is only true for
    PER_UNIT. Under the offer model ``job.quantity`` also carries the magnitude the
    PROVIDER estimated when offering — the hours of an HOURLY job, the m² of a
    PER_AREA one — and those tasks have ``allows_quantity = False``. Keeping the gate
    would silently throw the accepted offer's magnitude away and reprice off the
    catalog estimate: the customer would accept 8 h and get billed 2.
    """
    if job_quantity is not None:
        q = Decimal(str(job_quantity))
        if q > 0:
            return q
    return estimate_quantity_for(task)


def compute_quote_cents(
    rate: ProviderServiceRate, task: ServiceTask, quantity: Decimal
) -> int:
    """Subtotal = rate × quantity, floored at min_charge."""
    subtotal = int(rate.rate_cents * quantity)
    if rate.min_charge_cents:
        subtotal = max(subtotal, rate.min_charge_cents)
    return subtotal


async def get_provider_quote_for_job(
    db: AsyncSession,
    provider_id: uuid.UUID,
    task_id: uuid.UUID,
    job_quantity: Optional[Any] = None,
) -> Optional[dict[str, Any]]:
    """Read-only quote breakdown for the customer's approval screen. Returns
    None when the provider has no active fixed rate for the task. ``job_quantity``
    (the customer-confirmed amount) overrides the estimate when the task allows
    quantity."""
    rate = (
        await db.execute(
            select(ProviderServiceRate).where(
                ProviderServiceRate.provider_id == provider_id,
                ProviderServiceRate.task_id == task_id,
                ProviderServiceRate.is_active.is_(True),
            )
        )
    ).scalar_one_or_none()
    if rate is None:
        return None
    task = (
        await db.execute(select(ServiceTask).where(ServiceTask.id == task_id))
    ).scalar_one_or_none()
    if task is None or task.pricing_unit == PricingUnit.CUSTOM_QUOTE:
        return None
    qty = resolve_quantity(task, job_quantity)
    return {
        "rate_cents": rate.rate_cents,
        "unit": task.pricing_unit.value,
        "quantity": float(qty),
        "subtotal_cents": compute_quote_cents(rate, task, qty),
    }


async def get_company_quote_for_job(
    db: AsyncSession,
    company_id: uuid.UUID,
    task_id: uuid.UUID,
    job_quantity: Optional[Any] = None,
) -> Optional[dict[str, Any]]:
    """Quote from the COMPANY's rate (a company member's job is priced from the
    company's price, not the member's own). Same shape as the provider quote.
    CompanyService carries rate_cents/min_charge_cents like a provider rate."""
    from src.models.company import CompanyService

    cs = (
        await db.execute(
            select(CompanyService).where(
                CompanyService.company_id == company_id,
                CompanyService.task_id == task_id,
            )
        )
    ).scalar_one_or_none()
    if cs is None or cs.rate_cents is None:
        return None
    task = (
        await db.execute(select(ServiceTask).where(ServiceTask.id == task_id))
    ).scalar_one_or_none()
    if task is None or task.pricing_unit == PricingUnit.CUSTOM_QUOTE:
        return None
    qty = resolve_quantity(task, job_quantity)
    return {
        "rate_cents": cs.rate_cents,
        "unit": task.pricing_unit.value,
        "quantity": float(qty),
        "subtotal_cents": compute_quote_cents(cs, task, qty),
    }


async def reprice_job_to_provider_rate(
    db: AsyncSession, job: Any, provider_id: uuid.UUID
) -> Optional[dict[str, Any]]:
    """When a provider accepts, re-quote the job from THEIR rate so the customer
    approves the provider's actual price (not the catalog midpoint).

    No-op (returns None, leaves the catalog quote) when the provider has no
    active fixed rate for the task or the task is custom-quote. Mutates the job
    in place; the caller commits.
    """
    # A company member's job is priced from the COMPANY's rate (set on the web),
    # not the member's own; independents use their self-set rate.
    from src.services import company_service

    accepting = await db.get(ProviderProfile, provider_id)
    company_id = (
        await company_service.get_member_company_id(db, accepting.user_id)
        if accepting is not None else None
    )
    if company_id is not None:
        quote = await get_company_quote_for_job(
            db, company_id, job.task_id, job_quantity=getattr(job, "quantity", None)
        )
    else:
        quote = await get_provider_quote_for_job(
            db, provider_id, job.task_id, job_quantity=getattr(job, "quantity", None)
        )
    if quote is None:
        return None

    subtotal = quote["subtotal_cents"]
    job.quoted_price_cents = subtotal
    if quote["unit"] == PricingUnit.HOURLY.value:
        job.hourly_rate_cents = quote["rate_cents"]

    # Recompute commission + payout off the new subtotal. VISP's take is a % of
    # the subtotal keyed to the level of the provider WHO ACCEPTED. At booking no
    # provider is assigned yet, so create_job can only stamp a placeholder rate —
    # override it here now that the real accepting provider (and level) is known.
    if accepting is not None:
        job.commission_rate = commission_rate_for_level(accepting.current_level)
    if job.commission_rate is not None:
        job.commission_amount_cents = int(Decimal(subtotal) * job.commission_rate)
        job.provider_payout_cents = subtotal - job.commission_amount_cents

    # PP3 tax: place of supply = job's service province; charged only when the
    # SELLER is tax-registered — the COMPANY for a company member's job, else the
    # provider. Snapshot onto the job (immutable receipt).
    if company_id is not None:
        from src.models.company import Company

        seller = await db.get(Company, company_id)
    else:
        seller = await db.get(ProviderProfile, provider_id)
    tax = await tax_service.compute_tax(
        db,
        subtotal,
        job.service_province_state,
        bool(seller and seller.tax_registered),
    )
    job.service_tax_cents = tax["service_tax_cents"]
    job.tax_rate_applied = tax["tax_rate"]
    job.tax_jurisdiction = tax["tax_jurisdiction"]
    tip = job.tip_cents or 0

    # PP4c service fee ("Tarifa de servicio") — grossed-up Stripe fee the
    # customer covers (Model C). net = subtotal + tax + tip; fee on top of net.
    net = subtotal + job.service_tax_cents + tip
    job.service_fee_cents = fee_service.compute_service_fee_cents(net)
    job.total_charged_cents = net + job.service_fee_cents

    # Audit/receipt snapshot — feeds the admin full-waterfall receipt view.
    db.add(
        PricingEvent(
            job_id=job.id,
            event_type=PricingEventType.QUOTE_GENERATED,
            base_price_cents=subtotal,
            final_price_cents=job.total_charged_cents,
            subtotal_cents=subtotal,
            service_tax_cents=job.service_tax_cents,
            tax_rate=job.tax_rate_applied,
            tip_cents=tip,
            service_fee_cents=job.service_fee_cents,
            commission_rate=job.commission_rate,
            commission_cents=job.commission_amount_cents,
            provider_payout_cents=job.provider_payout_cents,
            currency=job.currency or "CAD",
            calculated_by="provider_accept_reprice",
        )
    )
    await db.flush()

    quote.update(
        {
            "service_tax_cents": job.service_tax_cents,
            "tax_rate": float(job.tax_rate_applied) if job.tax_rate_applied else None,
            "tax_jurisdiction": job.tax_jurisdiction,
            "tax_label": tax["label"],
            "tip_cents": tip,
            "service_fee_cents": job.service_fee_cents,
            "total_charged_cents": job.total_charged_cents,
        }
    )
    return quote


async def delete_rate(
    db: AsyncSession, provider_id: uuid.UUID, task_id: uuid.UUID
) -> bool:
    """Remove the provider's rate for ``task_id``. Returns False if none existed."""
    existing = (
        await db.execute(
            select(ProviderServiceRate).where(
                ProviderServiceRate.provider_id == provider_id,
                ProviderServiceRate.task_id == task_id,
            )
        )
    ).scalar_one_or_none()
    if existing is None:
        return False
    await db.delete(existing)
    await db.flush()
    return True
