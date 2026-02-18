"""
Pydantic v2 schemas for the Provider API -- VISP-BE-JOBS-002 / Provider Endpoints
==================================================================================

These schemas define the public API contract for provider dashboard, offers,
earnings, schedule, and credentials endpoints.  All output schemas use
camelCase aliases to match the mobile app's expectations.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field

from src.api.schemas.job import PaginationMeta


# ---------------------------------------------------------------------------
# Shared camelCase config
# ---------------------------------------------------------------------------

def _to_camel(snake: str) -> str:
    parts = snake.split("_")
    return parts[0] + "".join(w.capitalize() for w in parts[1:])


class CamelModel(BaseModel):
    """Base model that serialises field names to camelCase."""

    model_config = ConfigDict(
        from_attributes=True,
        populate_by_name=True,
        alias_generator=_to_camel,
    )


# ---------------------------------------------------------------------------
# Wrapper responses (mobile contract: { data: ..., message?: ... })
# ---------------------------------------------------------------------------

class DataResponse(BaseModel):
    """Generic envelope for single-object responses."""
    data: Any
    message: Optional[str] = None


class PaginatedResponse(BaseModel):
    """Generic envelope for paginated list responses."""
    data: list[Any]
    meta: PaginationMeta
    message: Optional[str] = None


# ---------------------------------------------------------------------------
# Provider status update
# ---------------------------------------------------------------------------

class ProviderStatusUpdateRequest(BaseModel):
    """Request body for updating provider availability status."""
    isOnline: Optional[bool] = None
    status: Optional[str] = Field(
        default=None,
        pattern=r"^(ONLINE|OFFLINE|ON_CALL|BUSY)$",
        description="Provider availability status (legacy)",
    )


class ProviderStatusOut(BaseModel):
    """Response for provider status update."""
    status: str


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

class ActiveJobSummary(BaseModel):
    """Brief summary of the provider's currently active job."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID = Field(alias="id")
    reference_number: str = Field(alias="referenceNumber")
    status: str
    service_address: str = Field(alias="serviceAddress")
    service_city: Optional[str] = Field(default=None, alias="serviceCity")
    customer_name: Optional[str] = Field(default=None, alias="customerName")
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")


class RecentJobSummary(BaseModel):
    """Brief summary for recent jobs list on dashboard."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    reference_number: str = Field(alias="referenceNumber")
    status: str
    service_city: Optional[str] = Field(default=None, alias="serviceCity")
    final_price_cents: Optional[int] = Field(default=None, alias="finalPriceCents")
    completed_at: Optional[datetime] = Field(default=None, alias="completedAt")
    created_at: datetime = Field(alias="createdAt")


class ProviderDashboardOut(BaseModel):
    """Provider dashboard aggregated data."""
    today_jobs: int = Field(alias="todayJobs")
    week_earnings_cents: int = Field(alias="weekEarningsCents")
    rating: Optional[Decimal] = None
    total_completed_jobs: int = Field(alias="totalCompletedJobs")
    active_job: Optional[ActiveJobSummary] = Field(default=None, alias="activeJob")
    recent_jobs: list[RecentJobSummary] = Field(default_factory=list, alias="recentJobs")
    availability_status: str = Field(alias="availabilityStatus")


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------

class OfferTaskInfo(BaseModel):
    """Task metadata within a job offer."""
    model_config = ConfigDict(populate_by_name=True)

    id: uuid.UUID
    name: str
    level: str
    category_name: Optional[str] = Field(default=None, alias="categoryName")


class OfferCustomerInfo(BaseModel):
    """Minimal customer info within a job offer."""
    model_config = ConfigDict(populate_by_name=True)

    id: uuid.UUID
    display_name: Optional[str] = Field(default=None, alias="displayName")
    rating: Optional[Decimal] = None


class OfferPricingInfo(BaseModel):
    """Pricing details within a job offer."""
    model_config = ConfigDict(populate_by_name=True)

    quoted_price_cents: Optional[int] = Field(default=None, alias="quotedPriceCents")
    commission_rate: Optional[Decimal] = Field(default=None, alias="commissionRate")
    estimated_payout_cents: Optional[int] = Field(default=None, alias="estimatedPayoutCents")
    currency: str = "CAD"


class OfferSLAInfo(BaseModel):
    """SLA targets within a job offer."""
    model_config = ConfigDict(populate_by_name=True)

    response_time_min: Optional[int] = Field(default=None, alias="responseTimeMin")
    arrival_time_min: Optional[int] = Field(default=None, alias="arrivalTimeMin")
    completion_time_min: Optional[int] = Field(default=None, alias="completionTimeMin")


class JobOfferOut(BaseModel):
    """A pending job offer for a provider."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    assignment_id: uuid.UUID = Field(alias="assignmentId")
    job_id: uuid.UUID = Field(alias="jobId")
    reference_number: str = Field(alias="referenceNumber")
    status: str

    # Job details
    is_emergency: bool = Field(alias="isEmergency")
    service_address: str = Field(alias="serviceAddress")
    service_city: Optional[str] = Field(default=None, alias="serviceCity")
    service_latitude: Decimal = Field(alias="serviceLatitude")
    service_longitude: Decimal = Field(alias="serviceLongitude")
    requested_date: Optional[date] = Field(default=None, alias="requestedDate")
    requested_time_start: Optional[time] = Field(default=None, alias="requestedTimeStart")

    # Related info
    task: OfferTaskInfo
    customer: OfferCustomerInfo
    pricing: OfferPricingInfo
    sla: OfferSLAInfo

    # Offer metadata
    distance_km: Optional[float] = Field(default=None, alias="distanceKm")
    offered_at: datetime = Field(alias="offeredAt")
    offer_expires_at: Optional[datetime] = Field(default=None, alias="offerExpiresAt")


# ---------------------------------------------------------------------------
# Offer accept / reject
# ---------------------------------------------------------------------------

class OfferRejectRequest(BaseModel):
    """Request body for rejecting a job offer."""
    reason: Optional[str] = Field(default=None, max_length=500)


class AssignmentOut(BaseModel):
    """Assignment record after accepting an offer."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    job_id: uuid.UUID = Field(alias="jobId")
    provider_id: uuid.UUID = Field(alias="providerId")
    status: str
    accepted_at: Optional[datetime] = Field(default=None, alias="acceptedAt")
    sla_response_deadline: Optional[datetime] = Field(
        default=None, alias="slaResponseDeadline"
    )
    sla_arrival_deadline: Optional[datetime] = Field(
        default=None, alias="slaArrivalDeadline"
    )


# ---------------------------------------------------------------------------
# Earnings
# ---------------------------------------------------------------------------

class EarningsJobSummary(BaseModel):
    """A completed job in the earnings detail list."""
    model_config = ConfigDict(from_attributes=True)

    job_id: uuid.UUID = Field(alias="jobId")
    reference_number: str = Field(alias="referenceNumber")
    service_city: Optional[str] = Field(default=None, alias="serviceCity")
    final_price_cents: Optional[int] = Field(default=None, alias="finalPriceCents")
    commission_cents: Optional[int] = Field(default=None, alias="commissionCents")
    payout_cents: Optional[int] = Field(default=None, alias="payoutCents")
    completed_at: Optional[datetime] = Field(default=None, alias="completedAt")


class EarningsSummaryOut(BaseModel):
    """Provider earnings summary for a time period."""
    period: str
    total_cents: int = Field(alias="totalCents")
    commission_cents: int = Field(alias="commissionCents")
    net_cents: int = Field(alias="netCents")
    job_count: int = Field(alias="jobCount")
    currency: str = "CAD"
    jobs: list[EarningsJobSummary] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------

class UpcomingJobOut(BaseModel):
    """An upcoming scheduled job."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    job_id: uuid.UUID = Field(alias="jobId")
    reference_number: str = Field(alias="referenceNumber")
    status: str
    service_address: str = Field(alias="serviceAddress")
    service_city: Optional[str] = Field(default=None, alias="serviceCity")
    requested_date: Optional[date] = Field(default=None, alias="requestedDate")
    requested_time_start: Optional[time] = Field(default=None, alias="requestedTimeStart")
    requested_time_end: Optional[time] = Field(default=None, alias="requestedTimeEnd")
    task_name: Optional[str] = Field(default=None, alias="taskName")
    is_emergency: bool = Field(alias="isEmergency")


class OnCallShiftOut(BaseModel):
    """An on-call shift."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    shift_start: datetime = Field(alias="shiftStart")
    shift_end: datetime = Field(alias="shiftEnd")
    region_value: str = Field(alias="regionValue")
    status: str
    shift_rate_cents: Optional[int] = Field(default=None, alias="shiftRateCents")


class ScheduleOut(BaseModel):
    """Provider schedule with upcoming jobs and on-call shifts."""
    upcoming: list[UpcomingJobOut] = Field(default_factory=list)
    shifts: list[OnCallShiftOut] = Field(default_factory=list)


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

class CredentialOut(BaseModel):
    """A provider credential record."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    credential_type: str = Field(alias="credentialType")
    name: str
    issuing_authority: Optional[str] = Field(default=None, alias="issuingAuthority")
    credential_number: Optional[str] = Field(default=None, alias="credentialNumber")
    status: str
    issued_date: Optional[date] = Field(default=None, alias="issuedDate")
    expiry_date: Optional[date] = Field(default=None, alias="expiryDate")
    verified_at: Optional[datetime] = Field(default=None, alias="verifiedAt")


class InsurancePolicyOut(BaseModel):
    """A provider insurance policy record."""
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    policy_number: str = Field(alias="policyNumber")
    insurer_name: str = Field(alias="insurerName")
    policy_type: str = Field(alias="policyType")
    coverage_amount_cents: int = Field(alias="coverageAmountCents")
    effective_date: date = Field(alias="effectiveDate")
    expiry_date: date = Field(alias="expiryDate")
    status: str
    verified_at: Optional[datetime] = Field(default=None, alias="verifiedAt")


class BackgroundCheckOut(BaseModel):
    """Background check status summary."""
    status: str
    check_date: Optional[date] = Field(default=None, alias="checkDate")
    expiry_date: Optional[date] = Field(default=None, alias="expiryDate")
    reference: Optional[str] = None


class CredentialsSummaryOut(BaseModel):
    """All provider credentials, insurance, and background check info."""
    credentials: list[CredentialOut] = Field(default_factory=list)
    insurances: list[InsurancePolicyOut] = Field(default_factory=list)
    background_check: BackgroundCheckOut = Field(alias="backgroundCheck")


# ---------------------------------------------------------------------------
# Job tracking
# ---------------------------------------------------------------------------

class JobTrackingOut(BaseModel):
    """Real-time job tracking information."""
    model_config = ConfigDict(populate_by_name=True)
    provider_lat: Optional[Decimal] = Field(default=None, alias="providerLat")
    provider_lng: Optional[Decimal] = Field(default=None, alias="providerLng")
    eta_minutes: Optional[int] = Field(default=None, alias="etaMinutes")
    status: str
    provider_name: Optional[str] = Field(default=None, alias="providerName")
    provider_phone: Optional[str] = Field(default=None, alias="providerPhone")
    provider_level: Optional[str] = Field(default=None, alias="providerLevel")
    updated_at: Optional[datetime] = Field(default=None, alias="updatedAt")


# ---------------------------------------------------------------------------
# Mobile-friendly job creation request (camelCase input)
# ---------------------------------------------------------------------------

class MobileJobCreateRequest(BaseModel):
    """Job creation request body using camelCase field names for mobile clients."""
    service_task_id: uuid.UUID = Field(alias="serviceTaskId")
    location_address: str = Field(alias="locationAddress", min_length=1, max_length=500)
    location_lat: Decimal = Field(alias="locationLat", ge=-90, le=90)
    location_lng: Decimal = Field(alias="locationLng", ge=-180, le=180)
    scheduled_at: Optional[datetime] = Field(default=None, alias="scheduledAt")
    is_emergency: bool = Field(default=False, alias="isEmergency")
    notes: Optional[list[str]] = None

    # Optional address components
    city: Optional[str] = None
    province_state: Optional[str] = Field(default=None, alias="provinceState")
    postal_zip: Optional[str] = Field(default=None, alias="postalZip")
    country: str = "CA"
    unit: Optional[str] = None


# ---------------------------------------------------------------------------
# Mobile-friendly job output (camelCase)
# ---------------------------------------------------------------------------

class MobileJobOut(BaseModel):
    """Job detail in camelCase format for mobile clients."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    reference_number: str = Field(alias="referenceNumber")
    customer_id: uuid.UUID = Field(alias="customerId")
    task_id: uuid.UUID = Field(alias="taskId")
    status: str
    priority: str
    is_emergency: bool = Field(alias="isEmergency")

    # Location
    service_address: str = Field(alias="serviceAddress")
    service_city: Optional[str] = Field(default=None, alias="serviceCity")
    service_latitude: Decimal = Field(alias="serviceLatitude")
    service_longitude: Decimal = Field(alias="serviceLongitude")

    # Pricing
    quoted_price_cents: Optional[int] = Field(default=None, alias="quotedPriceCents")
    final_price_cents: Optional[int] = Field(default=None, alias="finalPriceCents")
    currency: str

    # SLA
    sla_response_time_min: Optional[int] = Field(default=None, alias="slaResponseTimeMin")
    sla_arrival_time_min: Optional[int] = Field(default=None, alias="slaArrivalTimeMin")

    # Timestamps
    created_at: datetime = Field(alias="createdAt")
    started_at: Optional[datetime] = Field(default=None, alias="startedAt")
    completed_at: Optional[datetime] = Field(default=None, alias="completedAt")
    cancelled_at: Optional[datetime] = Field(default=None, alias="cancelledAt")


class MobileJobStatusUpdateRequest(BaseModel):
    """Job status update request using mobile-friendly field names."""
    status: str = Field(
        pattern=r"^(cancelled|en_route|arrived|in_progress|completed)$",
        description="New status for the job",
    )


class EstimatedPriceOut(BaseModel):
    """Estimated price returned with job creation."""
    model_config = ConfigDict(populate_by_name=True)
    min_cents: int = Field(alias="minCents")
    max_cents: int = Field(alias="maxCents")
    currency: str = "CAD"
    is_emergency: bool = Field(alias="isEmergency")
    dynamic_multiplier: Optional[Decimal] = Field(default=None, alias="dynamicMultiplier")


class JobCreateResponse(BaseModel):
    """Response from job creation containing the job and estimated price."""
    model_config = ConfigDict(populate_by_name=True)
    job: MobileJobOut
    estimated_price: EstimatedPriceOut = Field(alias="estimatedPrice")


# ---------------------------------------------------------------------------
# Taxonomy / Onboarding
# ---------------------------------------------------------------------------


class ProviderTaskOut(BaseModel):
    """Task detail for provider onboarding."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)
    
    id: uuid.UUID
    slug: str
    name: str
    description: str
    level: str
    category_id: uuid.UUID = Field(alias="categoryId")
    regulated: bool
    license_required: bool = Field(alias="licenseRequired")
    certification_required: bool = Field(alias="certificationRequired")
    hazardous: bool
    structural: bool
    is_active: bool = Field(alias="isActive")


class ProviderCategoryOut(BaseModel):
    """Category with tasks for provider onboarding."""
    model_config = ConfigDict(from_attributes=True, populate_by_name=True)

    id: uuid.UUID
    slug: str
    name: str
    icon_url: Optional[str] = Field(default=None, alias="iconUrl")
    display_order: int = Field(alias="displayOrder")
    active_tasks_list: list[ProviderTaskOut] = Field(alias="activeTasksList")


