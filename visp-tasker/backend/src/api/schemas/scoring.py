"""
Pydantic v2 schemas for the Scoring & Penalties API (VISP-BE-SCORING-005).

Covers:
- Provider score retrieval
- Manual score adjustment (admin)
- Penalty application events
- Score normalization results
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ScoreAdjustRequest(BaseModel):
    """Admin request to manually adjust a provider's score."""

    admin_user_id: uuid.UUID = Field(
        description="UUID of the admin user performing the adjustment",
    )
    provider_id: uuid.UUID = Field(
        description="UUID of the provider profile to adjust",
    )
    adjustment: Decimal = Field(
        description=(
            "Points to add (positive) or subtract (negative). "
            "The resulting score will be clamped to the level's min/max range."
        ),
        ge=-100,
        le=100,
    )
    reason: str = Field(
        min_length=1,
        max_length=2000,
        description="Mandatory reason for the manual adjustment",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class PenaltyRecordOut(BaseModel):
    """Single penalty event in the provider's history."""

    model_config = ConfigDict(from_attributes=True)

    penalty_type: str
    points_deducted: Decimal
    job_id: Optional[uuid.UUID] = None
    reason: Optional[str] = None
    applied_at: datetime


class ProviderScoreOut(BaseModel):
    """Complete scoring information for a provider."""

    model_config = ConfigDict(from_attributes=True)

    provider_id: uuid.UUID
    current_level: str
    current_score: Decimal
    base_score: Decimal
    min_score: Decimal
    max_score: Decimal
    is_expelled: bool
    recent_penalties: list[PenaltyRecordOut]
    incident_free_weeks: int
    last_penalty_at: Optional[datetime] = None


class ScoreAdjustOut(BaseModel):
    """Response after an admin manual score adjustment."""

    model_config = ConfigDict(from_attributes=True)

    provider_id: uuid.UUID
    previous_score: Decimal
    new_score: Decimal
    adjustment: Decimal
    adjusted_by: uuid.UUID
    adjusted_at: datetime
    reason: str


class PenaltyAppliedOut(BaseModel):
    """Response after a penalty is applied to a provider."""

    model_config = ConfigDict(from_attributes=True)

    provider_id: uuid.UUID
    penalty_type: str
    points_deducted: Decimal
    previous_score: Decimal
    new_score: Decimal
    job_id: Optional[uuid.UUID] = None
    is_expelled: bool


class NormalizationResultOut(BaseModel):
    """Result of the weekly score normalization job for a single provider."""

    model_config = ConfigDict(from_attributes=True)

    provider_id: uuid.UUID
    previous_score: Decimal
    new_score: Decimal
    points_recovered: Decimal
    incident_free_weeks: int


class NormalizationBatchOut(BaseModel):
    """Aggregate result of the weekly score normalization job."""

    model_config = ConfigDict(from_attributes=True)

    providers_processed: int
    providers_recovered: int
    total_points_recovered: Decimal
    results: list[NormalizationResultOut]
