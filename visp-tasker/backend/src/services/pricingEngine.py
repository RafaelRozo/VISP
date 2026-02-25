"""
Dynamic Pricing Engine for VISP -- VISP-BE-PRICING-006.

Calculates job prices based on:
- Task base rates from the service catalog
- Commission schedules per provider level
- Dynamic multipliers (emergency jobs only):
  - Night surcharge (10pm-6am): 1.5x
  - Extreme weather: 2.0x
  - Peak / holidays: up to 2.5x
- Multipliers stack multiplicatively but are capped at the dynamic_multiplier_max

Pricing models per level:
- Level 1 (TIME_BASED): $45-70/hr, provider paid by actual duration
- Level 2 (TIME_BASED): $80-120/hr, provider paid by actual duration
- Level 3 (NEGOTIATED): Per-job negotiated price
- Level 4 (EMERGENCY_NEGOTIATED): Per-job negotiated + emergency multipliers

Commission ranges per level (from commission_schedules.json):
- Level 1: 15-20% (default 20%)
- Level 2: 12-18% (default 18%)
- Level 3: 10-15% (default 15%)
- Level 4:  5-10% (default 10%)

All methods are async and accept an ``AsyncSession`` for transactional safety.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal, ROUND_HALF_UP
from typing import Any, Optional, Sequence

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    CommissionSchedule,
    Job,
    PricingEvent,
    PricingEventType,
    PricingRule,
    PricingRuleType,
    ProviderLevel,
    ServiceTask,
)
from src.integrations.weatherApi import get_weather_conditions

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Dynamic multiplier cap (all emergency multipliers combined cannot exceed this)
DYNAMIC_MULTIPLIER_MAX = Decimal("5.0")

# Night surcharge window
NIGHT_START = time(22, 0)  # 10:00 PM
NIGHT_END = time(6, 0)     # 6:00 AM
NIGHT_MULTIPLIER = Decimal("1.5")

# Weather multiplier
EXTREME_WEATHER_MULTIPLIER = Decimal("2.0")

# Peak / holiday multiplier (maximum)
PEAK_HOLIDAY_MULTIPLIER_MAX = Decimal("2.5")

# Known Canadian/US holidays (month, day) -- simplified list
HOLIDAYS: list[tuple[int, int]] = [
    (1, 1),    # New Year's Day
    (2, 17),   # Family Day (ON) / Presidents' Day (US) -- approximate
    (4, 18),   # Good Friday -- approximate, shifts yearly
    (5, 19),   # Victoria Day (CA) -- approximate
    (7, 1),    # Canada Day
    (7, 4),    # Independence Day (US)
    (9, 1),    # Labour Day -- approximate
    (10, 13),  # Thanksgiving (CA) -- approximate
    (11, 11),  # Remembrance Day (CA) / Veterans Day (US)
    (12, 25),  # Christmas Day
    (12, 26),  # Boxing Day (CA)
    (12, 31),  # New Year's Eve
]

# Hourly rate ranges per level (in cents)
HOURLY_RATES: dict[ProviderLevel, dict[str, int]] = {
    ProviderLevel.LEVEL_1: {"min": 4500, "max": 7000, "default": 4500},
    ProviderLevel.LEVEL_2: {"min": 8000, "max": 12000, "default": 8000},
}

# Pricing model per level
LEVEL_PRICING_MODEL: dict[ProviderLevel, str] = {
    ProviderLevel.LEVEL_1: "TIME_BASED",
    ProviderLevel.LEVEL_2: "TIME_BASED",
    ProviderLevel.LEVEL_3: "NEGOTIATED",
    ProviderLevel.LEVEL_4: "EMERGENCY_NEGOTIATED",
}

# Default commission rates when no CommissionSchedule is found
DEFAULT_COMMISSION: dict[ProviderLevel, dict[str, Decimal]] = {
    ProviderLevel.LEVEL_1: {
        "min": Decimal("0.1500"),
        "max": Decimal("0.2000"),
        "default": Decimal("0.2000"),
    },
    ProviderLevel.LEVEL_2: {
        "min": Decimal("0.1200"),
        "max": Decimal("0.1800"),
        "default": Decimal("0.1800"),
    },
    ProviderLevel.LEVEL_3: {
        "min": Decimal("0.1000"),
        "max": Decimal("0.1500"),
        "default": Decimal("0.1500"),
    },
    ProviderLevel.LEVEL_4: {
        "min": Decimal("0.0500"),
        "max": Decimal("0.1000"),
        "default": Decimal("0.1000"),
    },
}


# ---------------------------------------------------------------------------
# Response DTOs
# ---------------------------------------------------------------------------

@dataclass
class MultiplierDetail:
    """A single pricing multiplier that was applied."""
    rule_name: str
    rule_type: str
    multiplier: Decimal
    reason: str


@dataclass
class PriceEstimate:
    """Full price estimate for a potential job."""
    task_id: uuid.UUID
    task_name: str
    level: str
    is_emergency: bool

    base_price_min_cents: int
    base_price_max_cents: int
    estimated_duration_min: Optional[int]

    dynamic_multiplier: Decimal
    multiplier_details: list[MultiplierDetail]
    dynamic_multiplier_cap: Decimal

    final_price_min_cents: int
    final_price_max_cents: int

    commission_rate_min: Decimal
    commission_rate_max: Decimal
    commission_rate_default: Decimal

    provider_payout_min_cents: int
    provider_payout_max_cents: int

    pricing_model: str = "TIME_BASED"
    hourly_rate_min_cents: Optional[int] = None
    hourly_rate_max_cents: Optional[int] = None

    currency: str = "CAD"


@dataclass
class TimeBasedPriceResult:
    """Running cost calculation for an active L1/L2 time-based job."""
    job_id: uuid.UUID
    running_cost_cents: int
    elapsed_minutes: float
    hourly_rate_cents: int
    estimated_total_cents: int
    estimated_duration_min: int
    commission_rate: Decimal
    provider_running_payout_cents: int


@dataclass
class PriceBreakdownRule:
    """A pricing rule that was applied to a job."""
    rule_id: uuid.UUID
    rule_name: str
    rule_type: str
    multiplier: Decimal
    flat_adjustment_cents: int
    stackable: bool


@dataclass
class PriceBreakdown:
    """Detailed price breakdown for an existing job."""
    job_id: uuid.UUID
    task_id: uuid.UUID
    task_name: str
    level: str
    is_emergency: bool

    base_price_cents: int
    dynamic_multiplier: Decimal
    multiplier_details: list[MultiplierDetail]
    flat_adjustments_cents: int
    final_price_cents: int

    commission_rate: Decimal
    commission_cents: int
    provider_payout_cents: int

    rules_applied: list[PriceBreakdownRule]

    currency: str = "CAD"
    calculated_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


# ---------------------------------------------------------------------------
# Core service methods
# ---------------------------------------------------------------------------

async def calculate_price(
    db: AsyncSession,
    task_id: uuid.UUID,
    latitude: Decimal,
    longitude: Decimal,
    requested_date: Optional[date] = None,
    requested_time: Optional[time] = None,
    is_emergency: bool = False,
    country: str = "CA",
) -> PriceEstimate:
    """Calculate a price estimate for a service task.

    Dynamic multipliers are only applied to emergency requests.  Multipliers
    stack multiplicatively but are capped at DYNAMIC_MULTIPLIER_MAX.

    Args:
        db: Async database session.
        task_id: UUID of the service task from the closed catalog.
        latitude: Latitude of the service location.
        longitude: Longitude of the service location.
        requested_date: Requested date (defaults to today).
        requested_time: Requested time (defaults to now).
        is_emergency: Whether this is an emergency request.
        country: ISO 3166-1 alpha-2 country code.

    Returns:
        PriceEstimate with full breakdown.

    Raises:
        ValueError: If task not found or task has no pricing information.
    """
    # Fetch the task
    task = await _get_service_task(db, task_id)

    if task.base_price_min_cents is None or task.base_price_max_cents is None:
        raise ValueError(
            f"Service task '{task.name}' (id={task_id}) has no base pricing "
            f"configured.  Cannot generate estimate."
        )

    level = task.level
    service_date = requested_date or date.today()
    service_time = requested_time or datetime.now(timezone.utc).time()

    # Calculate dynamic multipliers (emergency only)
    multiplier_details: list[MultiplierDetail] = []
    combined_multiplier = Decimal("1.0")

    if is_emergency:
        # Night surcharge
        if _is_night_hours(service_time):
            combined_multiplier *= NIGHT_MULTIPLIER
            multiplier_details.append(MultiplierDetail(
                rule_name="Night Surcharge",
                rule_type="off_hours_surcharge",
                multiplier=NIGHT_MULTIPLIER,
                reason=f"Service requested during night hours ({NIGHT_START.strftime('%I:%M %p')}-{NIGHT_END.strftime('%I:%M %p')})",
            ))

        # Extreme weather
        weather = await get_weather_conditions(latitude, longitude)
        if weather.is_extreme:
            combined_multiplier *= EXTREME_WEATHER_MULTIPLIER
            multiplier_details.append(MultiplierDetail(
                rule_name="Extreme Weather Surcharge",
                rule_type="emergency_premium",
                multiplier=EXTREME_WEATHER_MULTIPLIER,
                reason=f"Extreme weather conditions: {weather.condition.value} ({weather.description})",
            ))

        # Peak / holiday
        holiday_multiplier = _get_holiday_multiplier(service_date)
        if holiday_multiplier > Decimal("1.0"):
            combined_multiplier *= holiday_multiplier
            multiplier_details.append(MultiplierDetail(
                rule_name="Peak / Holiday Surcharge",
                rule_type="holiday_surcharge",
                multiplier=holiday_multiplier,
                reason=f"Service requested on a holiday or peak period ({service_date.isoformat()})",
            ))

        # Apply DB-configured pricing rules for this task/level
        db_rules = await _get_active_pricing_rules(db, task_id, level, country)
        for rule in db_rules:
            if rule.rule_type in (
                PricingRuleType.DEMAND_SURGE,
                PricingRuleType.LEVEL_PREMIUM,
                PricingRuleType.DISTANCE_ADJUSTMENT,
            ):
                rule_multiplier = rule.multiplier_max  # Use max for estimates
                if rule_multiplier > Decimal("1.0"):
                    combined_multiplier *= rule_multiplier
                    multiplier_details.append(MultiplierDetail(
                        rule_name=rule.name,
                        rule_type=rule.rule_type.value,
                        multiplier=rule_multiplier,
                        reason=rule.description or f"Pricing rule: {rule.name}",
                    ))

        # Cap the combined multiplier
        combined_multiplier = min(combined_multiplier, DYNAMIC_MULTIPLIER_MAX)

    # Calculate final price range
    final_min = int(
        (Decimal(task.base_price_min_cents) * combined_multiplier)
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    final_max = int(
        (Decimal(task.base_price_max_cents) * combined_multiplier)
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )

    # Get commission rates
    commission = await _get_commission_rates(db, level, country)

    # Calculate provider payout range (after commission)
    payout_min = int(
        (Decimal(final_min) * (Decimal("1") - commission["max"]))
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )
    payout_max = int(
        (Decimal(final_max) * (Decimal("1") - commission["min"]))
        .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )

    # Determine pricing model based on level
    pricing_model = LEVEL_PRICING_MODEL.get(level, "TIME_BASED")
    hourly_rates = HOURLY_RATES.get(level)
    hourly_rate_min_cents: Optional[int] = None
    hourly_rate_max_cents: Optional[int] = None

    if hourly_rates is not None:
        hourly_rate_min_cents = hourly_rates["min"]
        hourly_rate_max_cents = hourly_rates["max"]

    return PriceEstimate(
        task_id=task_id,
        task_name=task.name,
        level=level.value,
        is_emergency=is_emergency,
        base_price_min_cents=task.base_price_min_cents,
        base_price_max_cents=task.base_price_max_cents,
        estimated_duration_min=task.estimated_duration_min,
        dynamic_multiplier=combined_multiplier,
        multiplier_details=multiplier_details,
        dynamic_multiplier_cap=DYNAMIC_MULTIPLIER_MAX,
        final_price_min_cents=final_min,
        final_price_max_cents=final_max,
        commission_rate_min=commission["min"],
        commission_rate_max=commission["max"],
        commission_rate_default=commission["default"],
        provider_payout_min_cents=payout_min,
        provider_payout_max_cents=payout_max,
        pricing_model=pricing_model,
        hourly_rate_min_cents=hourly_rate_min_cents,
        hourly_rate_max_cents=hourly_rate_max_cents,
        currency="CAD" if country == "CA" else "USD",
    )


async def get_price_breakdown(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> PriceBreakdown:
    """Get the detailed price breakdown for an existing job.

    Reconstructs the pricing calculation from the most recent PricingEvent
    associated with the job.

    Args:
        db: Async database session.
        job_id: The job UUID.

    Returns:
        PriceBreakdown with all applied rules and calculations.

    Raises:
        ValueError: If job not found or no pricing events exist for the job.
    """
    job = await _get_job(db, job_id)
    task = await _get_service_task(db, job.task_id)

    # Get the most recent pricing event for this job
    stmt = (
        select(PricingEvent)
        .where(PricingEvent.job_id == job_id)
        .order_by(PricingEvent.created_at.desc())
        .limit(1)
    )
    result = await db.execute(stmt)
    pricing_event = result.scalar_one_or_none()

    if pricing_event is None:
        # No pricing event yet -- calculate from job fields
        base_price = job.quoted_price_cents or 0
        commission_rate = job.commission_rate or Decimal("0")
        commission_cents = job.commission_amount_cents or 0
        provider_payout = job.provider_payout_cents or 0
        dynamic_multiplier = Decimal("1.0")
        rules_json: list[dict[str, Any]] = []
        calculated_at = job.created_at
    else:
        base_price = pricing_event.base_price_cents
        commission_rate = pricing_event.commission_rate or Decimal("0")
        commission_cents = pricing_event.commission_cents or 0
        provider_payout = pricing_event.provider_payout_cents or 0
        dynamic_multiplier = pricing_event.multiplier_applied
        rules_json = pricing_event.rules_applied_json or []
        calculated_at = pricing_event.created_at

    # Build multiplier details from the stored rules
    multiplier_details: list[MultiplierDetail] = []
    rules_applied: list[PriceBreakdownRule] = []

    for rule_entry in rules_json:
        if isinstance(rule_entry, dict):
            multiplier_details.append(MultiplierDetail(
                rule_name=rule_entry.get("rule_name", "Unknown"),
                rule_type=rule_entry.get("rule_type", "unknown"),
                multiplier=Decimal(str(rule_entry.get("multiplier", "1.0"))),
                reason=rule_entry.get("reason", ""),
            ))
            rules_applied.append(PriceBreakdownRule(
                rule_id=uuid.UUID(rule_entry["rule_id"]) if "rule_id" in rule_entry else uuid.uuid4(),
                rule_name=rule_entry.get("rule_name", "Unknown"),
                rule_type=rule_entry.get("rule_type", "unknown"),
                multiplier=Decimal(str(rule_entry.get("multiplier", "1.0"))),
                flat_adjustment_cents=int(rule_entry.get("flat_adjustment_cents", 0)),
                stackable=rule_entry.get("stackable", True),
            ))

    flat_adjustments = pricing_event.adjustments_cents if pricing_event else 0
    final_price = pricing_event.final_price_cents if pricing_event else (job.final_price_cents or job.quoted_price_cents or 0)

    return PriceBreakdown(
        job_id=job_id,
        task_id=job.task_id,
        task_name=task.name,
        level=task.level.value,
        is_emergency=job.is_emergency,
        base_price_cents=base_price,
        dynamic_multiplier=dynamic_multiplier,
        multiplier_details=multiplier_details,
        flat_adjustments_cents=flat_adjustments,
        final_price_cents=final_price,
        commission_rate=commission_rate,
        commission_cents=commission_cents,
        provider_payout_cents=provider_payout,
        rules_applied=rules_applied,
        currency=job.currency,
        calculated_at=calculated_at,
    )


async def calculate_time_based_price(
    db: AsyncSession,
    job_id: uuid.UUID,
    current_time: Optional[datetime] = None,
) -> TimeBasedPriceResult:
    """Calculate running cost for L1/L2 time-based jobs.

    Uses job.started_at and current_time to compute:
        price = hourly_rate_cents / 60 * actual_minutes

    Args:
        db: Async database session.
        job_id: UUID of the in-progress job.
        current_time: Optional override for "now" (defaults to utcnow).

    Returns:
        TimeBasedPriceResult with running cost and projections.

    Raises:
        ValueError: If the job is not found, not TIME_BASED, or not started.
    """
    job = await _get_job(db, job_id)
    task = await _get_service_task(db, job.task_id)

    if job.pricing_model != "TIME_BASED":
        raise ValueError(
            f"Job {job_id} has pricing_model='{job.pricing_model}', "
            f"expected 'TIME_BASED'."
        )

    if job.started_at is None:
        raise ValueError(f"Job {job_id} has not started yet (started_at is NULL).")

    if job.hourly_rate_cents is None:
        raise ValueError(f"Job {job_id} has no hourly_rate_cents set.")

    now = current_time or datetime.now(timezone.utc)
    elapsed_seconds = (now - job.started_at).total_seconds()
    elapsed_minutes = max(elapsed_seconds / 60.0, 0.0)

    # Running cost = hourly_rate / 60 * elapsed_minutes
    running_cost = Decimal(str(job.hourly_rate_cents)) / Decimal("60") * Decimal(str(elapsed_minutes))
    running_cost_cents = int(running_cost.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    # Commission
    commission = await _get_commission_rates(db, task.level, job.service_country)
    commission_rate = commission["default"]
    provider_running_payout = Decimal(str(running_cost_cents)) * (Decimal("1") - commission_rate)
    provider_running_payout_cents = int(
        provider_running_payout.quantize(Decimal("1"), rounding=ROUND_HALF_UP)
    )

    # Estimated total based on task's estimated duration
    estimated_duration = task.estimated_duration_min or 60
    estimated_total = Decimal(str(job.hourly_rate_cents)) / Decimal("60") * Decimal(str(estimated_duration))
    estimated_total_cents = int(estimated_total.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    return TimeBasedPriceResult(
        job_id=job_id,
        running_cost_cents=running_cost_cents,
        elapsed_minutes=round(elapsed_minutes, 2),
        hourly_rate_cents=job.hourly_rate_cents,
        estimated_total_cents=estimated_total_cents,
        estimated_duration_min=estimated_duration,
        commission_rate=commission_rate,
        provider_running_payout_cents=provider_running_payout_cents,
    )


async def finalize_time_based_price(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> PriceEstimate:
    """Called when L1/L2 job completes. Calculates final price based on actual duration.

    Updates the job record with final_price_cents, actual_duration_minutes,
    commission_amount_cents, and provider_payout_cents. Logs a
    TIME_BASED_CALCULATED PricingEvent.

    Args:
        db: Async database session.
        job_id: UUID of the completed job.

    Returns:
        PriceEstimate reflecting the finalized pricing.

    Raises:
        ValueError: If job not found, not TIME_BASED, or missing timestamps.
    """
    job = await _get_job(db, job_id)
    task = await _get_service_task(db, job.task_id)

    if job.pricing_model != "TIME_BASED":
        raise ValueError(
            f"Job {job_id} has pricing_model='{job.pricing_model}', "
            f"expected 'TIME_BASED'."
        )

    if job.started_at is None:
        raise ValueError(f"Job {job_id} has no started_at timestamp.")

    if job.completed_at is None:
        raise ValueError(f"Job {job_id} has no completed_at timestamp.")

    if job.hourly_rate_cents is None:
        raise ValueError(f"Job {job_id} has no hourly_rate_cents set.")

    # Calculate actual duration
    actual_seconds = (job.completed_at - job.started_at).total_seconds()
    actual_minutes = max(actual_seconds / 60.0, 0.0)
    actual_minutes_int = max(int(Decimal(str(actual_minutes)).quantize(Decimal("1"), rounding=ROUND_HALF_UP)), 1)

    # Final price = hourly_rate / 60 * actual_minutes
    final_price = Decimal(str(job.hourly_rate_cents)) / Decimal("60") * Decimal(str(actual_minutes))
    final_price_cents = int(final_price.quantize(Decimal("1"), rounding=ROUND_HALF_UP))

    # Commission
    commission = await _get_commission_rates(db, task.level, job.service_country)
    commission_rate = commission["default"]
    commission_amount = Decimal(str(final_price_cents)) * commission_rate
    commission_amount_cents = int(commission_amount.quantize(Decimal("1"), rounding=ROUND_HALF_UP))
    provider_payout_cents = final_price_cents - commission_amount_cents

    # Update job record
    job.final_price_cents = final_price_cents
    job.actual_duration_minutes = actual_minutes_int
    job.commission_rate = commission_rate
    job.commission_amount_cents = commission_amount_cents
    job.provider_payout_cents = provider_payout_cents

    # Log TIME_BASED_CALCULATED pricing event
    pricing_event = PricingEvent(
        job_id=job_id,
        event_type=PricingEventType.TIME_BASED_CALCULATED,
        base_price_cents=job.hourly_rate_cents,
        multiplier_applied=Decimal("1.0"),
        adjustments_cents=0,
        final_price_cents=final_price_cents,
        rules_applied_json=[{
            "rule_name": "Time-Based Calculation",
            "rule_type": "time_based",
            "hourly_rate_cents": job.hourly_rate_cents,
            "actual_minutes": actual_minutes_int,
            "reason": f"Final price for {actual_minutes_int} minutes at ${job.hourly_rate_cents / 100:.2f}/hr",
        }],
        commission_rate=commission_rate,
        commission_cents=commission_amount_cents,
        provider_payout_cents=provider_payout_cents,
        currency=job.currency,
        calculated_by="system",
    )
    db.add(pricing_event)
    await db.flush()

    logger.info(
        "Finalized time-based price for job %s: %d cents (%d min @ %d cents/hr, commission=%.2f%%)",
        job_id,
        final_price_cents,
        actual_minutes_int,
        job.hourly_rate_cents,
        float(commission_rate) * 100,
    )

    hourly_rates = HOURLY_RATES.get(task.level)

    return PriceEstimate(
        task_id=task.id,
        task_name=task.name,
        level=task.level.value,
        is_emergency=job.is_emergency,
        base_price_min_cents=task.base_price_min_cents or 0,
        base_price_max_cents=task.base_price_max_cents or 0,
        estimated_duration_min=task.estimated_duration_min,
        dynamic_multiplier=Decimal("1.0"),
        multiplier_details=[],
        dynamic_multiplier_cap=DYNAMIC_MULTIPLIER_MAX,
        final_price_min_cents=final_price_cents,
        final_price_max_cents=final_price_cents,
        commission_rate_min=commission["min"],
        commission_rate_max=commission["max"],
        commission_rate_default=commission_rate,
        provider_payout_min_cents=provider_payout_cents,
        provider_payout_max_cents=provider_payout_cents,
        pricing_model="TIME_BASED",
        hourly_rate_min_cents=hourly_rates["min"] if hourly_rates else None,
        hourly_rate_max_cents=hourly_rates["max"] if hourly_rates else None,
        currency=job.currency,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _is_night_hours(t: time) -> bool:
    """Check if a time falls within the night surcharge window (10pm-6am)."""
    return t >= NIGHT_START or t < NIGHT_END


def _get_holiday_multiplier(d: date) -> Decimal:
    """Get the holiday multiplier for a given date.

    Returns:
        Multiplier between 1.0 and PEAK_HOLIDAY_MULTIPLIER_MAX.
        - Holiday: 2.5x
        - Day before/after holiday: 1.5x
        - Weekend: 1.25x
        - Regular day: 1.0x
    """
    month_day = (d.month, d.day)

    # Exact holiday
    if month_day in HOLIDAYS:
        return PEAK_HOLIDAY_MULTIPLIER_MAX

    # Day before or after a holiday
    from datetime import timedelta
    day_before = d - timedelta(days=1)
    day_after = d + timedelta(days=1)
    if (day_before.month, day_before.day) in HOLIDAYS or (day_after.month, day_after.day) in HOLIDAYS:
        return Decimal("1.5")

    # Weekend (Saturday=5, Sunday=6)
    if d.weekday() in (5, 6):
        return Decimal("1.25")

    return Decimal("1.0")


async def _get_service_task(
    db: AsyncSession,
    task_id: uuid.UUID,
) -> ServiceTask:
    """Fetch a service task by ID or raise ValueError."""
    stmt = select(ServiceTask).where(ServiceTask.id == task_id)
    result = await db.execute(stmt)
    task = result.scalar_one_or_none()
    if task is None:
        raise ValueError(f"Service task not found: {task_id}")
    return task


async def _get_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job:
    """Fetch a job by ID or raise ValueError."""
    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return job


async def _get_active_pricing_rules(
    db: AsyncSession,
    task_id: uuid.UUID,
    level: ProviderLevel,
    country: str,
) -> Sequence[PricingRule]:
    """Fetch active pricing rules applicable to a task, level, and country.

    Rules are returned ordered by priority (highest first).  Global rules
    (NULL task_id, NULL level) are included alongside targeted rules.
    """
    today = date.today()

    stmt = (
        select(PricingRule)
        .where(
            and_(
                PricingRule.is_active == True,  # noqa: E712
                PricingRule.effective_from <= today,
                (PricingRule.effective_until.is_(None) | (PricingRule.effective_until >= today)),
                # Task scope: matches this task OR global (NULL)
                (PricingRule.task_id == task_id) | (PricingRule.task_id.is_(None)),
                # Level scope: matches this level OR global (NULL)
                (PricingRule.level == level) | (PricingRule.level.is_(None)),
                # Country scope: matches OR global (NULL)
                (PricingRule.country == country) | (PricingRule.country.is_(None)),
            )
        )
        .order_by(PricingRule.priority_order.desc())
    )

    result = await db.execute(stmt)
    return result.scalars().all()


async def _get_commission_rates(
    db: AsyncSession,
    level: ProviderLevel,
    country: str,
) -> dict[str, Decimal]:
    """Fetch the commission rates for a provider level and country.

    Falls back to DEFAULT_COMMISSION if no active schedule is found.
    """
    today = date.today()

    stmt = (
        select(CommissionSchedule)
        .where(
            and_(
                CommissionSchedule.level == level,
                CommissionSchedule.country == country,
                CommissionSchedule.is_active == True,  # noqa: E712
                CommissionSchedule.effective_from <= today,
                (
                    CommissionSchedule.effective_until.is_(None)
                    | (CommissionSchedule.effective_until >= today)
                ),
            )
        )
        .order_by(CommissionSchedule.effective_from.desc())
        .limit(1)
    )

    result = await db.execute(stmt)
    schedule = result.scalar_one_or_none()

    if schedule is not None:
        return {
            "min": schedule.commission_rate_min,
            "max": schedule.commission_rate_max,
            "default": schedule.commission_rate_default,
        }

    # Fallback to defaults
    defaults = DEFAULT_COMMISSION.get(level, DEFAULT_COMMISSION[ProviderLevel.LEVEL_1])
    return defaults
