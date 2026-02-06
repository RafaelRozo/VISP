"""
Pydantic v2 schemas for the Provider Matching API -- VISP-BE-MATCHING-003
==========================================================================

Schemas for finding, ranking, assigning, and reassigning providers to jobs.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Match request / result
# ---------------------------------------------------------------------------

class FindMatchRequest(BaseModel):
    """Request body for finding matching providers for a job."""

    job_id: uuid.UUID = Field(description="UUID of the job to find providers for")
    radius_km: Optional[float] = Field(
        default=None,
        ge=1.0,
        le=200.0,
        description="Override search radius in km (defaults to provider's service_radius_km)",
    )
    max_results: int = Field(
        default=10,
        ge=1,
        le=50,
        description="Maximum number of matching providers to return",
    )


class MatchResult(BaseModel):
    """A single provider match result with composite scoring breakdown."""

    model_config = ConfigDict(from_attributes=True)

    provider_id: uuid.UUID
    user_id: uuid.UUID
    display_name: Optional[str] = None
    current_level: str
    internal_score: Decimal
    distance_km: float = Field(description="Haversine distance from job location in km")
    response_time_avg_min: Optional[float] = Field(
        default=None, description="Average historical response time in minutes"
    )

    # Composite score breakdown
    score_internal: float = Field(description="Weighted internal score component")
    score_distance: float = Field(description="Weighted distance score component")
    score_response: float = Field(description="Weighted response time component")
    composite_score: float = Field(description="Final composite ranking score (0-100)")

    # Qualification details
    background_check_verified: bool
    has_valid_license: bool = False
    has_active_insurance: bool = False
    on_call_active: bool = False


class FindMatchResponse(BaseModel):
    """Response containing ranked list of matching providers."""

    job_id: uuid.UUID
    job_reference: str
    job_level: str
    total_candidates_evaluated: int = Field(
        description="Total providers evaluated before hard filters"
    )
    total_qualified: int = Field(
        description="Providers that passed all hard filters"
    )
    matches: list[MatchResult]


# ---------------------------------------------------------------------------
# Assignment
# ---------------------------------------------------------------------------

class AssignProviderRequest(BaseModel):
    """Request body for assigning a provider to a job."""

    job_id: uuid.UUID = Field(description="UUID of the job")
    provider_id: uuid.UUID = Field(description="UUID of the provider to assign")
    match_score: Optional[float] = Field(
        default=None,
        ge=0,
        le=100,
        description="Match score from the ranking algorithm",
    )


class ReassignProviderRequest(BaseModel):
    """Request body for reassigning a job to a different provider."""

    job_id: uuid.UUID = Field(description="UUID of the job")
    new_provider_id: uuid.UUID = Field(description="UUID of the new provider")
    reason: Optional[str] = Field(
        default=None,
        max_length=500,
        description="Reason for reassignment",
    )


class AssignmentOut(BaseModel):
    """Job assignment detail."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    job_id: uuid.UUID
    provider_id: uuid.UUID
    status: str
    offered_at: datetime
    offer_expires_at: Optional[datetime] = None
    responded_at: Optional[datetime] = None
    match_score: Optional[Decimal] = None
    sla_response_deadline: Optional[datetime] = None
    sla_arrival_deadline: Optional[datetime] = None
    created_at: datetime
