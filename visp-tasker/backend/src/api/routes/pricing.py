"""
Dynamic Pricing API routes -- VISP-BE-PRICING-006
===================================================

Endpoints for price estimation and job price breakdowns.

  GET  /api/v1/pricing/estimate             -- Generate price estimate
  GET  /api/v1/pricing/breakdown/{job_id}   -- Get price breakdown for a job
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, time
from decimal import Decimal
from typing import Optional

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import DBSession
from src.api.schemas.pricing import (
    MultiplierDetailOut,
    PriceBreakdownOut,
    PriceBreakdownRuleOut,
    PriceEstimateOut,
)
from src.services.pricingEngine import (
    calculate_price,
    get_price_breakdown,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/pricing", tags=["Pricing"])


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
