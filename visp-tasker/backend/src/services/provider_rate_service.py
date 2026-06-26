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

from src.models.provider_rate import ProviderServiceRate
from src.models.taxonomy import (
    PricingUnit,
    ProviderTaskQualification,
    ServiceTask,
)


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
    defaults to 1 unit until the full quantity picker lands (PP4b). The real
    amount is reconciled at completion.
    """
    if task.pricing_unit == PricingUnit.HOURLY:
        mins = task.estimated_duration_min or 60
        return Decimal(max(1, round(mins / 60)))
    return Decimal(1)


def compute_quote_cents(rate: ProviderServiceRate, task: ServiceTask) -> int:
    """Estimate subtotal = rate × default quantity, floored at min_charge."""
    qty = estimate_quantity_for(task)
    subtotal = int(rate.rate_cents * qty)
    if rate.min_charge_cents:
        subtotal = max(subtotal, rate.min_charge_cents)
    return subtotal


async def get_provider_quote_for_job(
    db: AsyncSession, provider_id: uuid.UUID, task_id: uuid.UUID
) -> Optional[dict[str, Any]]:
    """Read-only quote breakdown for the customer's approval screen. Returns
    None when the provider has no active fixed rate for the task."""
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
    qty = estimate_quantity_for(task)
    return {
        "rate_cents": rate.rate_cents,
        "unit": task.pricing_unit.value,
        "quantity": float(qty),
        "subtotal_cents": compute_quote_cents(rate, task),
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
    quote = await get_provider_quote_for_job(db, provider_id, job.task_id)
    if quote is None:
        return None

    subtotal = quote["subtotal_cents"]
    job.quoted_price_cents = subtotal
    if quote["unit"] == PricingUnit.HOURLY.value:
        job.hourly_rate_cents = quote["rate_cents"]

    # Recompute commission + payout off the new subtotal (commission_rate was
    # set at booking from the level schedule).
    if job.commission_rate is not None:
        job.commission_amount_cents = int(Decimal(subtotal) * job.commission_rate)
        job.provider_payout_cents = subtotal - job.commission_amount_cents

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
