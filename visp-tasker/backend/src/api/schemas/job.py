"""
Pydantic v2 schemas for the Job Management API -- VISP-BE-JOBS-002
===================================================================

These schemas define the public API contract for job creation, status
updates, cancellation, and retrieval. They deliberately expose only the
fields that clients need while keeping internal-only columns hidden.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Shared pagination (re-usable across modules)
# ---------------------------------------------------------------------------

class PaginationMeta(BaseModel):
    """Pagination metadata included in every paginated response."""

    page: int = Field(ge=1, description="Current page number (1-indexed)")
    page_size: int = Field(ge=1, description="Number of items per page")
    total_items: int = Field(ge=0, description="Total number of matching items")
    total_pages: int = Field(ge=0, description="Total number of pages")


# ---------------------------------------------------------------------------
# Location input
# ---------------------------------------------------------------------------

class JobLocationInput(BaseModel):
    """Service location provided by the customer when creating a job."""

    latitude: Decimal = Field(description="Service location latitude", ge=-90, le=90)
    longitude: Decimal = Field(description="Service location longitude", ge=-180, le=180)
    address: str = Field(min_length=1, max_length=500, description="Full street address")
    unit: Optional[str] = Field(default=None, max_length=50, description="Unit/apt number")
    city: Optional[str] = Field(default=None, max_length=100)
    province_state: Optional[str] = Field(default=None, max_length=100)
    postal_zip: Optional[str] = Field(default=None, max_length=20)
    country: str = Field(default="CA", max_length=2, description="ISO 3166-1 alpha-2")


# ---------------------------------------------------------------------------
# Schedule input
# ---------------------------------------------------------------------------

class JobScheduleInput(BaseModel):
    """Optional scheduling preferences for the job."""

    requested_date: Optional[date] = Field(default=None, description="Preferred service date")
    requested_time_start: Optional[time] = Field(
        default=None, description="Earliest acceptable start time"
    )
    requested_time_end: Optional[time] = Field(
        default=None, description="Latest acceptable start time"
    )
    flexible_schedule: bool = Field(default=False, description="Customer is flexible on timing")


# ---------------------------------------------------------------------------
# Job creation
# ---------------------------------------------------------------------------

class JobCreateRequest(BaseModel):
    """Request body for creating a new job."""

    customer_id: uuid.UUID = Field(description="UUID of the customer placing the job")
    task_id: uuid.UUID = Field(description="UUID of the task from the closed catalog")
    location: JobLocationInput
    schedule: Optional[JobScheduleInput] = Field(default=None)
    priority: str = Field(
        default="standard",
        pattern=r"^(standard|priority|urgent|emergency)$",
        description="Job priority level",
    )
    is_emergency: bool = Field(default=False, description="Flag for emergency jobs")
    customer_notes_json: list[str] = Field(
        default_factory=list,
        description="Predefined customer note selections (NOT free text)",
    )


# ---------------------------------------------------------------------------
# Job status update
# ---------------------------------------------------------------------------

class JobStatusUpdateRequest(BaseModel):
    """Request body for updating a job's status."""

    new_status: str = Field(description="Target status to transition to")
    actor_id: uuid.UUID = Field(description="UUID of the user performing the action")
    actor_type: str = Field(
        default="system",
        pattern=r"^(customer|provider|system|admin)$",
        description="Type of actor performing the transition",
    )

    @field_validator("new_status")
    @classmethod
    def validate_status_value(cls, v: str) -> str:
        valid = {
            "draft", "pending_match", "matched", "provider_accepted",
            "provider_en_route", "in_progress", "completed",
            "cancelled_by_customer", "cancelled_by_provider",
            "cancelled_by_system", "disputed", "refunded",
        }
        if v not in valid:
            raise ValueError(
                f"Invalid status '{v}'. Must be one of: {', '.join(sorted(valid))}"
            )
        return v


# ---------------------------------------------------------------------------
# Job cancellation
# ---------------------------------------------------------------------------

class JobCancelRequest(BaseModel):
    """Request body for cancelling a job."""

    cancelled_by: uuid.UUID = Field(description="UUID of the user cancelling the job")
    actor_type: str = Field(
        default="customer",
        pattern=r"^(customer|provider|system|admin)$",
        description="Type of actor performing the cancellation",
    )
    reason: Optional[str] = Field(
        default=None,
        max_length=1000,
        description="Cancellation reason",
    )


# ---------------------------------------------------------------------------
# SLA snapshot (read-only, captured at job creation)
# ---------------------------------------------------------------------------

class SLASnapshotOut(BaseModel):
    """Read-only representation of the SLA terms captured at job creation."""

    model_config = ConfigDict(from_attributes=True)

    sla_profile_id: Optional[uuid.UUID] = None
    response_time_min: Optional[int] = None
    arrival_time_min: Optional[int] = None
    completion_time_min: Optional[int] = None
    penalty_enabled: bool = False
    penalty_per_min_cents: Optional[int] = None
    penalty_cap_cents: Optional[int] = None
    profile_name: Optional[str] = None
    level: Optional[str] = None
    region_value: Optional[str] = None
    captured_at: Optional[str] = None


# ---------------------------------------------------------------------------
# Job output
# ---------------------------------------------------------------------------

class JobOut(BaseModel):
    """Full job representation returned by detail and list endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_number: str
    customer_id: uuid.UUID
    task_id: uuid.UUID

    # Status
    status: str
    priority: str
    is_emergency: bool

    # Location
    service_latitude: Decimal
    service_longitude: Decimal
    service_address: str
    service_unit: Optional[str] = None
    service_city: Optional[str] = None
    service_province_state: Optional[str] = None
    service_postal_zip: Optional[str] = None
    service_country: str

    # Schedule
    requested_date: Optional[date] = None
    requested_time_start: Optional[time] = None
    requested_time_end: Optional[time] = None
    flexible_schedule: bool

    # SLA snapshot (immutable after creation)
    sla_response_time_min: Optional[int] = None
    sla_arrival_time_min: Optional[int] = None
    sla_completion_time_min: Optional[int] = None
    sla_profile_id: Optional[uuid.UUID] = None
    sla_snapshot_json: Optional[dict[str, Any]] = None

    # Pricing
    quoted_price_cents: Optional[int] = None
    final_price_cents: Optional[int] = None
    currency: str

    # Notes and photos
    customer_notes_json: list[Any] = Field(default_factory=list)

    # Timestamps
    started_at: Optional[datetime] = None
    completed_at: Optional[datetime] = None
    cancelled_at: Optional[datetime] = None
    cancellation_reason: Optional[str] = None
    created_at: datetime
    updated_at: datetime


class JobBrief(BaseModel):
    """Compact job representation for list endpoints."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_number: str
    customer_id: uuid.UUID
    task_id: uuid.UUID
    status: str
    priority: str
    is_emergency: bool
    service_city: Optional[str] = None
    service_province_state: Optional[str] = None
    requested_date: Optional[date] = None
    created_at: datetime


# ---------------------------------------------------------------------------
# List responses
# ---------------------------------------------------------------------------

class JobListResponse(BaseModel):
    """Paginated list of jobs."""

    data: list[JobBrief]
    meta: PaginationMeta


# ---------------------------------------------------------------------------
# Status transition info (for UI hints)
# ---------------------------------------------------------------------------

class StatusTransitionInfo(BaseModel):
    """Available status transitions from the current state."""

    current_status: str
    available_transitions: list[str]
