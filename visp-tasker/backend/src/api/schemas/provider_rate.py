"""Pydantic schemas — provider-set service rates (Provider-Set Pricing · PP2)."""

from __future__ import annotations

from typing import Optional

from pydantic import BaseModel, Field


class SetRateIn(BaseModel):
    """Set/update the provider's rate for one task."""

    rate_cents: int = Field(ge=0, description="Provider rate in cents for the task unit.")
    min_charge_cents: Optional[int] = Field(
        default=None, ge=0, description="Optional floor charge per job in cents."
    )


class ServiceRateOut(BaseModel):
    task_id: str
    task_name: str
    task_slug: str
    level: str
    pricing_unit: str
    allows_quantity: bool
    base_price_min_cents: Optional[int] = None
    base_price_max_cents: Optional[int] = None
    is_custom_quote: bool
    rate_cents: Optional[int] = None
    min_charge_cents: Optional[int] = None
    is_active: bool
