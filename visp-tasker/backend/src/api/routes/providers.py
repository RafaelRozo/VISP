"""
Provider API Routes -- VISP-BE-JOBS-002 / Provider Endpoints
==============================================================

REST endpoints for provider-facing operations: dashboard, job offers,
offer accept/reject, availability status, earnings, schedule, and
credentials.

Routes:
  GET    /api/v1/provider/dashboard          -- Provider dashboard stats
  GET    /api/v1/provider/offers             -- List pending job offers
  POST   /api/v1/provider/offers/{job_id}/accept  -- Accept an offer
  POST   /api/v1/provider/offers/{job_id}/reject  -- Reject an offer
  PATCH  /api/v1/provider/status             -- Update availability
  GET    /api/v1/provider/earnings           -- Earnings summary
  GET    /api/v1/provider/schedule           -- Schedule (jobs + shifts)
  GET    /api/v1/provider/credentials        -- Credentials & verification
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.provider import (
    ActiveJobSummary,
    AssignmentOut,
    BackgroundCheckOut,
    CredentialOut,
    CredentialsSummaryOut,
    EarningsJobSummary,
    EarningsSummaryOut,
    InsurancePolicyOut,
    JobOfferOut,
    OfferCustomerInfo,
    OfferPricingInfo,
    OfferRejectRequest,
    OfferSLAInfo,
    OfferTaskInfo,
    OnCallShiftOut,
    ProviderDashboardOut,
    ProviderStatusOut,
    ProviderStatusUpdateRequest,
    RecentJobSummary,
    ScheduleOut,
    UpcomingJobOut,
)
from src.services import providerService

router = APIRouter(prefix="/provider", tags=["Provider"])


# ---------------------------------------------------------------------------
# Helper: resolve provider_id from the authenticated user
# ---------------------------------------------------------------------------

async def _get_provider_id(db: DBSession, user: CurrentUser) -> uuid.UUID:
    """Resolve the provider profile ID for the authenticated user.

    Raises 403 if the user is not a provider.
    """
    profile = await providerService.get_provider_profile(db, user.id)
    return profile.id


# ---------------------------------------------------------------------------
# GET /api/v1/provider/dashboard
# ---------------------------------------------------------------------------

@router.get(
    "/dashboard",
    summary="Provider dashboard stats",
    description=(
        "Returns aggregated dashboard data for the authenticated provider: "
        "today's jobs, week earnings, rating, total completed jobs, "
        "active job, and recent jobs."
    ),
)
async def get_dashboard(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    dashboard = await providerService.get_dashboard(db, provider_id)

    # Build response using schemas for validation
    active_job = None
    if dashboard["active_job"]:
        active_job = ActiveJobSummary(**dashboard["active_job"])

    recent_jobs = [RecentJobSummary(**j) for j in dashboard["recent_jobs"]]

    result = ProviderDashboardOut(
        today_jobs=dashboard["today_jobs"],
        week_earnings_cents=dashboard["week_earnings_cents"],
        rating=dashboard["rating"],
        total_completed_jobs=dashboard["total_completed_jobs"],
        active_job=active_job,
        recent_jobs=recent_jobs,
        availability_status=dashboard["availability_status"],
    )

    return {"data": result.model_dump(by_alias=True)}


# ---------------------------------------------------------------------------
# GET /api/v1/provider/offers
# ---------------------------------------------------------------------------

@router.get(
    "/offers",
    summary="List pending job offers",
    description=(
        "Returns all pending job offers for the authenticated provider, "
        "enriched with task, customer, pricing, SLA, and distance info."
    ),
)
async def list_offers(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    raw_offers = await providerService.get_pending_offers(db, provider_id)

    items = []
    for offer in raw_offers:
        item = JobOfferOut(
            assignment_id=offer["assignment_id"],
            job_id=offer["job_id"],
            reference_number=offer["reference_number"],
            status=offer["status"],
            is_emergency=offer["is_emergency"],
            service_address=offer["service_address"],
            service_city=offer["service_city"],
            service_latitude=offer["service_latitude"],
            service_longitude=offer["service_longitude"],
            requested_date=offer["requested_date"],
            requested_time_start=offer["requested_time_start"],
            task=OfferTaskInfo(**offer["task"]),
            customer=OfferCustomerInfo(**offer["customer"]),
            pricing=OfferPricingInfo(**offer["pricing"]),
            sla=OfferSLAInfo(**offer["sla"]),
            distance_km=offer["distance_km"],
            offered_at=offer["offered_at"],
            offer_expires_at=offer["offer_expires_at"],
        )
        items.append(item.model_dump(by_alias=True))

    return {"data": {"items": items}}


# ---------------------------------------------------------------------------
# POST /api/v1/provider/offers/{job_id}/accept
# ---------------------------------------------------------------------------

@router.post(
    "/offers/{job_id}/accept",
    summary="Accept a job offer",
    description="Accept a pending job offer. Transitions the job to PROVIDER_ACCEPTED.",
)
async def accept_offer(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    try:
        assignment = await providerService.accept_offer(db, job_id, provider_id)
    except providerService.OfferNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except providerService.OfferAlreadyRespondedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    result = AssignmentOut(
        id=assignment.id,
        job_id=assignment.job_id,
        provider_id=assignment.provider_id,
        status=assignment.status.value,
        accepted_at=assignment.responded_at,
        sla_response_deadline=assignment.sla_response_deadline,
        sla_arrival_deadline=assignment.sla_arrival_deadline,
    )

    return {"data": {"assignment": result.model_dump(by_alias=True)}}


# ---------------------------------------------------------------------------
# POST /api/v1/provider/offers/{job_id}/reject
# ---------------------------------------------------------------------------

@router.post(
    "/offers/{job_id}/reject",
    summary="Reject a job offer",
    description="Reject a pending job offer. The matching engine may reassign.",
)
async def reject_offer(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: Optional[OfferRejectRequest] = None,
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    reason = body.reason if body else None

    try:
        await providerService.reject_offer(db, job_id, provider_id, reason)
    except providerService.OfferNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except providerService.OfferAlreadyRespondedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return {"data": None}


# ---------------------------------------------------------------------------
# PATCH /api/v1/provider/status
# ---------------------------------------------------------------------------

@router.patch(
    "/status",
    summary="Update provider availability status",
    description="Set the provider's availability status: ONLINE, OFFLINE, ON_CALL, or BUSY.",
)
async def update_status(
    db: DBSession,
    user: CurrentUser,
    body: ProviderStatusUpdateRequest,
) -> dict[str, Any]:
    try:
        profile = await providerService.get_provider_profile(db, user.id)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    # For MVP: store the status on the provider profile.
    # In production this would update a Redis presence key.
    # The provider_profiles table doesn't have an availability_status column,
    # so we use a lightweight approach: log it and return success.
    # TODO: Add availability_status column or use Redis.

    return {"data": {"status": body.status}}


# ---------------------------------------------------------------------------
# GET /api/v1/provider/earnings
# ---------------------------------------------------------------------------

@router.get(
    "/earnings",
    summary="Provider earnings summary",
    description=(
        "Returns earnings summary for the authenticated provider. "
        "Period can be: today, week, month, all."
    ),
)
async def get_earnings(
    db: DBSession,
    user: CurrentUser,
    period: str = Query(
        default="week",
        pattern=r"^(today|week|month|all)$",
        description="Time period for earnings calculation",
    ),
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    earnings = await providerService.get_earnings(db, provider_id, period)

    result = EarningsSummaryOut(
        period=earnings["period"],
        total_cents=earnings["total_cents"],
        commission_cents=earnings["commission_cents"],
        net_cents=earnings["net_cents"],
        job_count=earnings["job_count"],
        currency=earnings["currency"],
        jobs=[EarningsJobSummary(**j) for j in earnings["jobs"]],
    )

    return {"data": result.model_dump(by_alias=True)}


# ---------------------------------------------------------------------------
# GET /api/v1/provider/schedule
# ---------------------------------------------------------------------------

@router.get(
    "/schedule",
    summary="Provider schedule",
    description="Returns upcoming jobs and on-call shifts for the provider.",
)
async def get_schedule(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    schedule = await providerService.get_schedule(db, provider_id)

    result = ScheduleOut(
        upcoming=[UpcomingJobOut(**j) for j in schedule["upcoming"]],
        shifts=[OnCallShiftOut(**s) for s in schedule["shifts"]],
    )

    return {"data": result.model_dump(by_alias=True)}


# ---------------------------------------------------------------------------
# GET /api/v1/provider/credentials
# ---------------------------------------------------------------------------

@router.get(
    "/credentials",
    summary="Provider credentials and verification status",
    description=(
        "Returns the provider's credentials, insurance policies, "
        "and background check status."
    ),
)
async def get_credentials(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    creds = await providerService.get_credentials(db, provider_id)

    result = CredentialsSummaryOut(
        credentials=[CredentialOut(**c) for c in creds["credentials"]],
        insurances=[InsurancePolicyOut(**i) for i in creds["insurances"]],
        background_check=BackgroundCheckOut(**creds["background_check"]),
    )

    return {"data": result.model_dump(by_alias=True)}
