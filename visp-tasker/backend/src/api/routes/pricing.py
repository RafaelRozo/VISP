"""
Dynamic Pricing API routes -- VISP-BE-PRICING-006
===================================================

Endpoints for price estimation and job price breakdowns.

  GET  /api/v1/pricing/estimate                  -- Generate price estimate
  GET  /api/v1/pricing/breakdown/{job_id}        -- Get price breakdown for a job
  POST /api/v1/pricing/calculate-running         -- Running cost for L1/L2 in-progress job
  POST /api/v1/pricing/finalize/{job_id}         -- Finalize time-based price
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status
from pydantic import BaseModel, Field
from sqlalchemy import select

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.pricing import (
    MultiplierDetailOut,
    PriceBreakdownOut,
    PriceBreakdownRuleOut,
    PriceEstimateOut,
)
from src.models import Job, JobStatus, PricingEvent, PricingEventType
from src.services.pricingEngine import (
    calculate_price,
    get_price_breakdown,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pricing", tags=["Pricing"])


# ---------------------------------------------------------------------------
# Running cost schemas (inline -- small, no separate schema file needed)
# ---------------------------------------------------------------------------

class CalculateRunningRequest(BaseModel):
    job_id: uuid.UUID = Field(description="UUID of the in-progress L1/L2 job")


class RunningCostOut(BaseModel):
    job_id: uuid.UUID
    running_cost_cents: int = Field(description="Cost accrued so far in cents")
    elapsed_minutes: int = Field(description="Minutes elapsed since job start")
    hourly_rate_cents: int = Field(description="Configured hourly rate in cents")
    estimated_total_cents: int = Field(
        description="Projected total if the job ends now (same as running_cost_cents)"
    )


# ---------------------------------------------------------------------------
# GET /api/v1/pricing/estimate
# ---------------------------------------------------------------------------

@router.get(
    "/estimate",
    response_model=PriceEstimateOut,
    summary="Generate a price estimate for a service task",
    description=(
        "Calculates a price range for a service task based on the task's base "
        "rates, the service location, requested schedule, and emergency status.  "
        "Dynamic multipliers (night, weather, holidays) are only applied to "
        "emergency requests.  All multipliers stack multiplicatively but are "
        "capped at the platform maximum."
    ),
)
async def get_price_estimate(
    db: DBSession,
    task_id: uuid.UUID = Query(description="UUID of the service task"),
    latitude: Decimal = Query(description="Service location latitude", ge=-90, le=90),
    longitude: Decimal = Query(description="Service location longitude", ge=-180, le=180),
    requested_date: Optional[date] = Query(
        default=None,
        description="Requested service date (YYYY-MM-DD)",
    ),
    requested_time: Optional[time] = Query(
        default=None,
        description="Requested service time (HH:MM)",
    ),
    is_emergency: bool = Query(
        default=False,
        description="Whether this is an emergency request",
    ),
    country: str = Query(
        default="CA",
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code",
    ),
) -> PriceEstimateOut:
    try:
        estimate = await calculate_price(
            db=db,
            task_id=task_id,
            latitude=latitude,
            longitude=longitude,
            requested_date=requested_date,
            requested_time=requested_time,
            is_emergency=is_emergency,
            country=country,
        )
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=message,
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=message,
        )

    multiplier_details_out = [
        MultiplierDetailOut(
            rule_name=m.rule_name,
            rule_type=m.rule_type,
            multiplier=m.multiplier,
            reason=m.reason,
        )
        for m in estimate.multiplier_details
    ]

    return PriceEstimateOut(
        task_id=estimate.task_id,
        task_name=estimate.task_name,
        level=estimate.level,
        is_emergency=estimate.is_emergency,
        base_price_min_cents=estimate.base_price_min_cents,
        base_price_max_cents=estimate.base_price_max_cents,
        estimated_duration_min=estimate.estimated_duration_min,
        dynamic_multiplier=estimate.dynamic_multiplier,
        multiplier_details=multiplier_details_out,
        dynamic_multiplier_cap=estimate.dynamic_multiplier_cap,
        final_price_min_cents=estimate.final_price_min_cents,
        final_price_max_cents=estimate.final_price_max_cents,
        commission_rate_min=estimate.commission_rate_min,
        commission_rate_max=estimate.commission_rate_max,
        commission_rate_default=estimate.commission_rate_default,
        provider_payout_min_cents=estimate.provider_payout_min_cents,
        provider_payout_max_cents=estimate.provider_payout_max_cents,
        currency=estimate.currency,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/pricing/breakdown/{job_id}
# ---------------------------------------------------------------------------

@router.get(
    "/breakdown/{job_id}",
    response_model=PriceBreakdownOut,
    summary="Get price breakdown for a job",
    description=(
        "Returns the detailed pricing breakdown for an existing job, including "
        "all applied multipliers, flat adjustments, commission calculation, and "
        "provider payout.  Uses the most recent PricingEvent if available, "
        "otherwise falls back to the job's quoted/final price fields."
    ),
)
async def get_job_price_breakdown(
    job_id: uuid.UUID,
    db: DBSession,
) -> PriceBreakdownOut:
    try:
        breakdown = await get_price_breakdown(db=db, job_id=job_id)
    except ValueError as exc:
        message = str(exc)
        if "not found" in message.lower():
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=message,
            )
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=message,
        )

    multiplier_details_out = [
        MultiplierDetailOut(
            rule_name=m.rule_name,
            rule_type=m.rule_type,
            multiplier=m.multiplier,
            reason=m.reason,
        )
        for m in breakdown.multiplier_details
    ]

    rules_out = [
        PriceBreakdownRuleOut(
            rule_id=r.rule_id,
            rule_name=r.rule_name,
            rule_type=r.rule_type,
            multiplier=r.multiplier,
            flat_adjustment_cents=r.flat_adjustment_cents,
            stackable=r.stackable,
        )
        for r in breakdown.rules_applied
    ]

    return PriceBreakdownOut(
        job_id=breakdown.job_id,
        task_id=breakdown.task_id,
        task_name=breakdown.task_name,
        level=breakdown.level,
        is_emergency=breakdown.is_emergency,
        base_price_cents=breakdown.base_price_cents,
        dynamic_multiplier=breakdown.dynamic_multiplier,
        multiplier_details=multiplier_details_out,
        flat_adjustments_cents=breakdown.flat_adjustments_cents,
        final_price_cents=breakdown.final_price_cents,
        commission_rate=breakdown.commission_rate,
        commission_cents=breakdown.commission_cents,
        provider_payout_cents=breakdown.provider_payout_cents,
        rules_applied=rules_out,
        currency=breakdown.currency,
        calculated_at=breakdown.calculated_at,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/pricing/calculate-running
# ---------------------------------------------------------------------------

@router.post(
    "/calculate-running",
    response_model=RunningCostOut,
    summary="Get current running cost for an in-progress L1/L2 job",
    description=(
        "Returns the cost accrued so far for a TIME_BASED pricing model job "
        "that is currently IN_PROGRESS. Calculated as "
        "(elapsed_minutes / 60) * hourly_rate_cents, rounded to nearest cent."
    ),
)
async def calculate_running_cost(
    body: CalculateRunningRequest,
    db: DBSession,
    current_user: CurrentUser,
) -> RunningCostOut:
    result = await db.execute(select(Job).where(Job.id == body.job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {body.job_id} not found",
        )
    if job.status != JobStatus.IN_PROGRESS:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Job {body.job_id} is not IN_PROGRESS (status: {job.status})",
        )
    if job.pricing_model != "TIME_BASED":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Job {body.job_id} uses '{job.pricing_model}' pricing, "
                "not TIME_BASED"
            ),
        )
    if job.started_at is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Job {body.job_id} has no started_at timestamp",
        )

    hourly_rate_cents: int = job.hourly_rate_cents or 0
    now = datetime.now(tz=timezone.utc)
    started = job.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    elapsed_seconds = max(0, (now - started).total_seconds())
    elapsed_minutes = int(elapsed_seconds / 60)
    running_cost_cents = int((elapsed_seconds / 3600) * hourly_rate_cents)

    return RunningCostOut(
        job_id=job.id,
        running_cost_cents=running_cost_cents,
        elapsed_minutes=elapsed_minutes,
        hourly_rate_cents=hourly_rate_cents,
        estimated_total_cents=running_cost_cents,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/pricing/finalize/{job_id}
# ---------------------------------------------------------------------------

@router.post(
    "/finalize/{job_id}",
    response_model=RunningCostOut,
    summary="Finalize time-based price when job completes",
    description=(
        "Calculates the final time-based price using actual job duration and "
        "persists it on the job as final_price_cents. Logs a "
        "TIME_BASED_CALCULATED PricingEvent. Called when a TIME_BASED job "
        "transitions to COMPLETED."
    ),
)
async def finalize_time_based_price(
    job_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> RunningCostOut:
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found",
        )
    if job.pricing_model != "TIME_BASED":
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Job {job_id} uses '{job.pricing_model}' pricing, "
                "not TIME_BASED"
            ),
        )
    if job.started_at is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Job {job_id} has no started_at timestamp",
        )

    hourly_rate_cents: int = job.hourly_rate_cents or 0
    end_time = job.completed_at or datetime.now(tz=timezone.utc)
    started = job.started_at
    if started.tzinfo is None:
        started = started.replace(tzinfo=timezone.utc)
    if end_time.tzinfo is None:
        end_time = end_time.replace(tzinfo=timezone.utc)
    elapsed_seconds = max(0, (end_time - started).total_seconds())
    elapsed_minutes = int(elapsed_seconds / 60)
    final_price_cents = int((elapsed_seconds / 3600) * hourly_rate_cents)

    # Persist to job and log pricing event
    job.final_price_cents = final_price_cents
    job.actual_duration_minutes = elapsed_minutes
    await db.flush()

    event = PricingEvent(
        job_id=job_id,
        event_type=PricingEventType.TIME_BASED_CALCULATED,
        base_price_cents=hourly_rate_cents,
        multiplier_applied=1,
        adjustments_cents=0,
        final_price_cents=final_price_cents,
        rules_applied_json=[],
        currency=job.currency,
        calculated_by=str(current_user.id),
    )
    db.add(event)
    await db.flush()

    logger.info(
        "Time-based price finalized: job=%s, minutes=%d, final=%d cents",
        job_id,
        elapsed_minutes,
        final_price_cents,
    )

    return RunningCostOut(
        job_id=job.id,
        running_cost_cents=final_price_cents,
        elapsed_minutes=elapsed_minutes,
        hourly_rate_cents=hourly_rate_cents,
        estimated_total_cents=final_price_cents,
    )
