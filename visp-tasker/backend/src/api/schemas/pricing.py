"""
Pydantic v2 schemas for the Dynamic Pricing API (VISP-BE-PRICING-006).

Covers:
- Price estimation requests and responses
- Price breakdown for existing jobs
- Dynamic multiplier details
- Commission calculation
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class PriceEstimateRequest(BaseModel):
    """Query parameters for generating a price estimate."""

    task_id: uuid.UUID = Field(
        description="UUID of the service task from the closed catalog",
    )
    service_latitude: Decimal = Field(
        description="Latitude of the service location",
        ge=-90,
        le=90,
    )
    service_longitude: Decimal = Field(
        description="Longitude of the service location",
        ge=-180,
        le=180,
    )
    requested_date: Optional[date] = Field(
        default=None,
        description="Requested service date (YYYY-MM-DD). If omitted, defaults to today.",
    )
    requested_time: Optional[time] = Field(
        default=None,
        description="Requested service time (HH:MM). If omitted, defaults to now.",
    )
    is_emergency: bool = Field(
        default=False,
        description="Whether this is an emergency request (enables dynamic multipliers)",
    )
    country: str = Field(
        default="CA",
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class MultiplierDetailOut(BaseModel):
    """A single pricing multiplier that was applied."""

    model_config = ConfigDict(from_attributes=True)

    rule_name: str
    rule_type: str
    multiplier: Decimal
    reason: str


class PriceEstimateOut(BaseModel):
    """Price estimate response with full breakdown."""

    model_config = ConfigDict(from_attributes=True)

    task_id: uuid.UUID
    task_name: str
    level: str
    is_emergency: bool

    # Base pricing
    base_price_min_cents: int
    base_price_max_cents: int
    estimated_duration_min: Optional[int] = None

    # Dynamic multipliers (emergency only)
    dynamic_multiplier: Decimal = Field(
        description="Combined dynamic multiplier applied (1.0 if non-emergency)",
    )
    multiplier_details: list[MultiplierDetailOut] = Field(
        default_factory=list,
        description="Breakdown of individual multipliers applied",
    )
    dynamic_multiplier_cap: Decimal = Field(
        description="Maximum allowed dynamic multiplier",
    )

    # Final price range
    final_price_min_cents: int
    final_price_max_cents: int

    # Commission
    commission_rate_min: Decimal
    commission_rate_max: Decimal
    commission_rate_default: Decimal

    # Provider payout estimate
    provider_payout_min_cents: int
    provider_payout_max_cents: int

    currency: str = "CAD"


class PriceBreakdownRuleOut(BaseModel):
    """A single pricing rule that was applied to a job."""

    model_config = ConfigDict(from_attributes=True)

    rule_id: uuid.UUID
    rule_name: str
    rule_type: str
    multiplier: Decimal
    flat_adjustment_cents: int
    stackable: bool


class PriceBreakdownOut(BaseModel):
    """Detailed price breakdown for an existing job."""

    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID
    task_id: uuid.UUID
    task_name: str
    level: str
    is_emergency: bool

    # Price components
    base_price_cents: int
    dynamic_multiplier: Decimal
    multiplier_details: list[MultiplierDetailOut]
    flat_adjustments_cents: int
    final_price_cents: int

    # Commission
    commission_rate: Decimal
    commission_cents: int
    provider_payout_cents: int

    # Applied rules
    rules_applied: list[PriceBreakdownRuleOut]

    currency: str = "CAD"
    calculated_at: datetime
