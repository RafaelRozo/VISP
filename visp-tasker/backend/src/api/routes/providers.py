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

import logging
import uuid
from typing import Any, Optional

logger = logging.getLogger(__name__)

from fastapi import APIRouter, HTTPException, Query, Request, status, UploadFile, File, Form
from pydantic import BaseModel
from src.api.schemas.payouts import (
    PayoutBankIn,
    PayoutIdentityIn,
    PayoutTaxIn,
    PayoutTosIn,
)

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
    DataResponse,
    ProviderCategoryOut,
)
from src.services import providerService, taxonomy_service, jobService


router = APIRouter(prefix="/provider", tags=["Provider"])

# Backend enums use provider_accepted / provider_en_route but mobile expects
# simplified names.
_MOBILE_STATUS_MAP: dict[str, str] = {
    "pending_match": "pending_match",
    "matched": "matched",
    "pending_approval": "pending_approval",
    "scheduled": "scheduled",
    "provider_accepted": "accepted",
    "provider_en_route": "en_route",
    "in_progress": "in_progress",
    "completed": "completed",
    "cancelled_by_customer": "cancelled",
    "cancelled_by_provider": "cancelled",
    "cancelled_by_system": "cancelled",
}

def _mobile_status(backend_status: str) -> str:
    return _MOBILE_STATUS_MAP.get(backend_status, backend_status)


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
)
async def get_dashboard(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    """Return aggregated dashboard for the authenticated provider.

    Returns the shape the mobile app expects:
    { profile, activeJob, pendingOffers, earnings, performanceScore }
    """
    from src.models.provider import ProviderProfile
    from src.models.verification import ProviderCredential
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    # 1. Get or default profile
    profile_stmt = (
        sa_select(ProviderProfile)
        .options(selectinload(ProviderProfile.credentials))
        .where(ProviderProfile.user_id == user.id)
    )
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()

    if profile is None:
        # New user — return empty defaults
        return {"data": {
            "profile": {
                "id": None,
                "userId": str(user.id),
                "level": 1,
                "performanceScore": 0,
                "isOnline": False,
                "isOnCall": False,
                "completedJobs": 0,
                "rating": 0.0,
                "stripeConnectStatus": "not_connected",
                "credentials": [],
            },
            "activeJob": None,
            "pendingOffers": [],
            "earnings": {
                "today": 0,
                "thisWeek": 0,
                "thisMonth": 0,
                "pendingPayout": 0,
                "totalEarned": 0,
            },
            "performanceScore": 0,
        }}

    # 2. Map credentials to mobile format
    _cred_type_map = {
        "background_check": "criminal_record_check",
        "license": "trade_license",
        "certification": "certification",
        "portfolio": "portfolio",
        "permit": "trade_license",
        "training": "certification",
    }
    _cred_status_map = {
        "pending_review": "pending",
        "verified": "approved",
        "rejected": "rejected",
        "expired": "expired",
        "revoked": "rejected",
    }
    creds_out = []
    for c in profile.credentials:
        creds_out.append({
            "id": str(c.id),
            "type": _cred_type_map.get(c.credential_type.value, c.credential_type.value),
            "label": c.name,
            "status": _cred_status_map.get(c.status.value, "pending"),
            "documentUrl": c.document_url,
            "expiresAt": c.expiry_date.isoformat() if c.expiry_date else None,
            "rejectionReason": c.rejection_reason,
            "uploadedAt": c.created_at.isoformat() if c.created_at else None,
            "reviewedAt": c.verified_at.isoformat() if c.verified_at else None,
        })

    level_int = int(profile.current_level.value) if profile.current_level else 1

    # Compute real stats from DB
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus
    from src.models.review import Review
    from sqlalchemy import func as sa_func

    # Count completed jobs for this provider
    completed_count_stmt = (
        sa_select(sa_func.count(JobAssignment.id))
        .where(
            JobAssignment.provider_id == profile.id,
            JobAssignment.status == AssignmentStatus.COMPLETED,
        )
    )
    completed_count = (await db.execute(completed_count_stmt)).scalar() or 0

    # Average rating from reviews where this provider is the reviewee
    avg_rating_stmt = (
        sa_select(sa_func.avg(Review.overall_rating))
        .where(Review.reviewee_id == profile.user_id)
    )
    avg_rating_raw = (await db.execute(avg_rating_stmt)).scalar()
    avg_rating = round(float(avg_rating_raw), 2) if avg_rating_raw else 0.0

    profile_out = {
        "id": str(profile.id),
        "userId": str(profile.user_id),
        "level": level_int,
        "performanceScore": float(profile.internal_score) if profile.internal_score else 0,
        "isOnline": profile.is_online,
        "isOnCall": False,
        "completedJobs": completed_count,
        "rating": avg_rating,
        "stripeConnectStatus": "not_connected" if not profile.stripe_account_id else "active",
        "credentials": creds_out,
    }

    # 3. Active job — find the most recent accepted/en_route/in_progress assignment

    active_assignment_stmt = (
        sa_select(JobAssignment)
        .where(
            JobAssignment.provider_id == profile.id,
            JobAssignment.status.in_([
                AssignmentStatus.ACCEPTED,
            ]),
        )
        .order_by(JobAssignment.responded_at.desc())
        .limit(1)
    )
    active_assignment = (await db.execute(active_assignment_stmt)).scalar_one_or_none()

    active_job_out = None
    if active_assignment:
        job_stmt = sa_select(Job).where(Job.id == active_assignment.job_id)
        active_job = (await db.execute(job_stmt)).scalar_one_or_none()
        if active_job and active_job.status in (
            JobStatus.PENDING_APPROVAL,
            JobStatus.SCHEDULED,
            JobStatus.PROVIDER_ACCEPTED,
            JobStatus.PROVIDER_EN_ROUTE,
            JobStatus.IN_PROGRESS,
        ):
            from src.models.taxonomy import ServiceTask
            from sqlalchemy.orm import selectinload
            task_stmt = sa_select(ServiceTask).options(selectinload(ServiceTask.category)).where(ServiceTask.id == active_job.task_id)
            task = (await db.execute(task_stmt)).scalar_one_or_none()

            active_job_out = {
                "id": str(active_job.id),
                "referenceNumber": active_job.reference_number,
                "status": _mobile_status(active_job.status.value),
                "taskName": task.name if task else "Service",
                "categoryName": task.category.name if task and hasattr(task, 'category') and task.category else None,
                "serviceAddress": active_job.service_address,
                "serviceCity": active_job.service_city,
                "address": {
                    "street": active_job.service_address or "",
                    "city": active_job.service_city or "",
                    "latitude": float(active_job.service_latitude) if active_job.service_latitude else 0,
                    "longitude": float(active_job.service_longitude) if active_job.service_longitude else 0,
                },
                "isEmergency": active_job.is_emergency,
                "quotedPriceCents": active_job.quoted_price_cents,
                "estimatedPrice": (active_job.quoted_price_cents / 100) if active_job.quoted_price_cents else 0.0,
                "level": 1, # default level fallback
                "startedAt": active_job.started_at.isoformat() if active_job.started_at else None,
                "completedAt": active_job.completed_at.isoformat() if active_job.completed_at else None,
            }

    # 4. Pending offers — reuse the offers logic
    try:
        raw_offers = await providerService.get_pending_offers(db, profile.id)
        from src.api.schemas.provider import (
            JobOfferOut, OfferTaskInfo, OfferCustomerInfo,
            OfferPricingInfo, OfferSLAInfo,
        )
        pending_offers_out = []
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
            pending_offers_out.append(item.model_dump(by_alias=True))
    except Exception:
        pending_offers_out = []

    return {"data": {
        "profile": profile_out,
        "activeJob": active_job_out,
        "pendingOffers": pending_offers_out,
        "earnings": {
            "today": 0,
            "thisWeek": 0,
            "thisMonth": 0,
            "pendingPayout": 0,
            "totalEarned": 0,
        },
        "performanceScore": float(profile.internal_score) if profile.internal_score else 0,
    }}


# ---------------------------------------------------------------------------
# GET /api/v1/provider/verification
# ---------------------------------------------------------------------------

@router.get(
    "/verification",
    summary="Provider verification status and credentials",
)
async def get_verification(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    """Return credentials and current level for the verification screen."""
    from src.models.provider import ProviderProfile
    from src.models.verification import ProviderCredential
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    profile_stmt = (
        sa_select(ProviderProfile)
        .options(selectinload(ProviderProfile.credentials))
        .where(ProviderProfile.user_id == user.id)
    )
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()

    if profile is None:
        return {"data": {"credentials": [], "currentLevel": 1}}

    _cred_type_map = {
        "background_check": "criminal_record_check",
        "license": "trade_license",
        "certification": "certification",
        "portfolio": "portfolio",
        "permit": "trade_license",
        "training": "certification",
    }
    _cred_status_map = {
        "pending_review": "pending",
        "verified": "approved",
        "rejected": "rejected",
        "expired": "expired",
        "revoked": "rejected",
    }

    creds_out = []
    for c in profile.credentials:
        creds_out.append({
            "id": str(c.id),
            "type": _cred_type_map.get(c.credential_type.value, c.credential_type.value),
            "label": c.name,
            "status": _cred_status_map.get(c.status.value, "pending"),
            "documentUrl": c.document_url,
            "expiresAt": c.expiry_date.isoformat() if c.expiry_date else None,
            "rejectionReason": c.rejection_reason,
            "uploadedAt": c.created_at.isoformat() if c.created_at else None,
            "reviewedAt": c.verified_at.isoformat() if c.verified_at else None,
        })

    level_int = int(profile.current_level.value) if profile.current_level else 1

    return {"data": {
        "credentials": creds_out,
        "currentLevel": level_int,
    }}


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
# GET /api/v1/provider/jobs/{job_id}
# ---------------------------------------------------------------------------

@router.get(
    "/jobs/{job_id}",
    summary="Get active job details",
    description="Fetch full details of a job assigned to this provider.",
)
async def get_job_detail(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from src.models.job import Job, JobAssignment
    from src.models.service import ServiceTask
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    job_stmt = sa_select(Job).where(Job.id == job_id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    task_stmt = (
        sa_select(ServiceTask)
        .options(selectinload(ServiceTask.category))
        .where(ServiceTask.id == job.task_id)
    )
    task = (await db.execute(task_stmt)).scalar_one_or_none()

    return {"data": {
        "id": str(job.id),
        "referenceNumber": job.reference_number,
        "status": _mobile_status(job.status.value),
        "taskName": task.name if task else "Service",
        "categoryName": task.category.name if task and task.category else None,
        "serviceAddress": job.service_address,
        "serviceCity": job.service_city,
        "address": {
            "street": job.service_address or "",
            "city": job.service_city or "",
            "latitude": float(job.service_latitude) if job.service_latitude else 0,
            "longitude": float(job.service_longitude) if job.service_longitude else 0,
        },
        "isEmergency": job.is_emergency,
        "quotedPriceCents": job.quoted_price_cents,
        "estimatedPrice": (job.quoted_price_cents / 100) if job.quoted_price_cents else 0.0,
        "level": 1, # default level fallback
        "startedAt": job.started_at.isoformat() if job.started_at else None,
        "completedAt": job.completed_at.isoformat() if job.completed_at else None,
    }}


# ---------------------------------------------------------------------------
# POST /api/v1/provider/jobs/{job_id}/en-route
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/en-route",
    summary="Mark provider as en route",
    description="Provider starts navigating to the customer location.",
)
async def start_en_route(
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
        job = await jobService.update_job_status(
            db,
            job_id,
            "provider_en_route",
            actor_id=provider_id,
            actor_type="provider",
        )
    except jobService.JobNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return {"data": {"jobId": str(job.id), "status": _mobile_status(job.status.value)}}


# ---------------------------------------------------------------------------
# POST /api/v1/provider/jobs/{job_id}/arrive
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/arrive",
    summary="Mark provider as arrived / start job",
    description="Provider has arrived at customer location. Job transitions to in_progress.",
)
async def arrive_at_job(
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
        job = await jobService.update_job_status(
            db,
            job_id,
            "in_progress",
            actor_id=provider_id,
            actor_type="provider",
        )
    except jobService.JobNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return {"data": {"jobId": str(job.id), "status": _mobile_status(job.status.value), "startedAt": job.started_at.isoformat() if job.started_at else None}}


# ---------------------------------------------------------------------------
# POST /api/v1/provider/jobs/{job_id}/complete
# ---------------------------------------------------------------------------

@router.post(
    "/jobs/{job_id}/complete",
    summary="Complete a job",
    description="Provider marks the job as completed.",
)
async def complete_job(
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
        job = await jobService.update_job_status(
            db,
            job_id,
            "completed",
            actor_id=provider_id,
            actor_type="provider",
        )
    except jobService.JobNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Job not found.",
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return {"data": {"jobId": str(job.id), "status": _mobile_status(job.status.value), "completedAt": job.completed_at.isoformat() if job.completed_at else None}}


# ---------------------------------------------------------------------------
# PATCH /api/v1/provider/status
# ---------------------------------------------------------------------------

@router.patch(
    "/status",
    summary="Update provider availability status",
    description="Set the provider's online/offline status.",
)
async def update_status(
    db: DBSession,
    user: CurrentUser,
    body: ProviderStatusUpdateRequest,
) -> dict[str, Any]:
    from src.models.provider import ProviderProfile
    from sqlalchemy import select as sa_select

    stmt = sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(stmt)).scalar_one_or_none()
    if not profile:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    # Accept both formats: {isOnline: bool} or {status: "ONLINE"}
    if body.isOnline is not None:
        profile.is_online = body.isOnline
    elif body.status:
        profile.is_online = body.status.upper() == "ONLINE"

    await db.commit()
    await db.refresh(profile)

    return {"data": {"isOnline": profile.is_online}}


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


# ---------------------------------------------------------------------------
# POST /api/v1/provider/credentials  — upload a credential document
# ---------------------------------------------------------------------------

# Map mobile type strings → backend CredentialType enum
_MOBILE_CRED_TYPE_MAP: dict[str, str] = {
    "trade_license": "license",
    "certification": "certification",
    "criminal_record_check": "background_check",
    "insurance_certificate": "certification",
    "portfolio": "portfolio",
    "drivers_license": "license",
}


@router.post(
    "/credentials",
    summary="Upload a credential document",
    description="Upload a new credential document for verification review.",
    status_code=status.HTTP_201_CREATED,
)
async def upload_credential(
    db: DBSession,
    user: CurrentUser,
    file: UploadFile = File(...),
    type: str = Form(...),
    task_id: Optional[str] = Form(None),
) -> dict[str, Any]:
    import os
    from datetime import datetime, timezone
    from src.models.verification import ProviderCredential, CredentialType, CredentialStatus
    from src.models.taxonomy import ServiceTask
    from sqlalchemy import select as sa_select

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    # Map mobile type string to backend enum
    mapped_type = _MOBILE_CRED_TYPE_MAP.get(type, type)
    try:
        cred_type = CredentialType(mapped_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid credential type: {type}",
        )

    # Save file to uploads directory
    uploads_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "uploads",
        "credentials",
        str(provider_id),
    )
    os.makedirs(uploads_dir, exist_ok=True)

    safe_filename = f"{uuid.uuid4()}_{file.filename or 'upload.jpg'}"
    file_path = os.path.join(uploads_dir, safe_filename)
    content = await file.read()
    with open(file_path, "wb") as f:
        f.write(content)

    # Determine credential name: use task name if task_id provided, else filename
    cred_name = file.filename or "Uploaded Document"
    task_uuid: Optional[uuid.UUID] = None
    if task_id:
        try:
            task_uuid = uuid.UUID(task_id)
        except ValueError:
            task_uuid = None
        if task_uuid is not None:
            task_stmt = sa_select(ServiceTask).where(ServiceTask.id == task_uuid)
            task_obj = (await db.execute(task_stmt)).scalar_one_or_none()
            if task_obj:
                cred_name = task_obj.name
            else:
                task_uuid = None  # bogus id — don't store an FK that won't resolve

    # Create the credential record
    credential = ProviderCredential(
        id=uuid.uuid4(),
        provider_id=provider_id,
        credential_type=cred_type,
        name=cred_name,
        task_id=task_uuid,
        status=CredentialStatus.PENDING_REVIEW,
        document_url=f"/uploads/credentials/{provider_id}/{safe_filename}",
    )
    db.add(credential)
    await db.commit()
    await db.refresh(credential)

    return {
        "data": {
            "id": str(credential.id),
            "type": credential.credential_type.value,
            "status": credential.status.value,
            "documentUrl": credential.document_url,
            "createdAt": credential.created_at.isoformat() if credential.created_at else None,
        }
    }


# ---------------------------------------------------------------------------
# POST /provider/time-off — Request time off
# ---------------------------------------------------------------------------

class TimeOffBody(BaseModel):
    start_date: str
    end_date: str
    reason: str = "Personal"


@router.post(
    "/time-off",
    summary="Request time off",
    status_code=status.HTTP_201_CREATED,
)
async def request_time_off(
    db: DBSession,
    user: CurrentUser,
    body: TimeOffBody,
) -> dict[str, Any]:
    """Submit a time-off request for approval."""
    from sqlalchemy import text
    from datetime import date as date_type

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    start = date_type.fromisoformat(body.start_date)
    end = date_type.fromisoformat(body.end_date)

    request_id = uuid.uuid4()
    await db.execute(
        text("""
            INSERT INTO provider_time_off_requests (id, provider_id, start_date, end_date, reason, status, created_at, updated_at)
            VALUES (:id, :provider_id, :start_date, :end_date, :reason, 'pending', NOW(), NOW())
        """),
        {
            "id": request_id,
            "provider_id": provider_id,
            "start_date": start,
            "end_date": end,
            "reason": body.reason,
        },
    )
    await db.commit()

    return {
        "data": {
            "id": str(request_id),
            "startDate": body.start_date,
            "endDate": body.end_date,
            "reason": body.reason,
            "status": "pending",
        }
    }


# ---------------------------------------------------------------------------

@router.get(
    "/taxonomy",
    response_model=DataResponse,
    summary="Get full service taxonomy for provider onboarding",
)
async def get_provider_taxonomy(db: DBSession) -> Any:
    """Return all active categories and their active tasks."""
    try:
        categories = await taxonomy_service.get_full_active_taxonomy(db)
        
        # Serialize manually to prevent Pydantic/ORM conflict
        data = []
        for c in categories:
            # Defensive access: fetch active_tasks_list via getattr in case 
            # taxonomy_service logic didn't run or is outdated.
            tasks_orm = getattr(c, "active_tasks_list", [])
            
            # Manual validation of tasks to avoid ANY Pydantic/ORM lazy load issues
            tasks_data = []
            for t in tasks_orm:
                # Handle Level Enum manually if needed
                level_val = t.level.value if hasattr(t.level, 'value') else str(t.level)
                
                tasks_data.append({
                    "id": t.id,
                    "slug": t.slug,
                    "name": t.name,
                    "description": t.description,
                    "level": level_val,
                    "category_id": t.category_id,
                    "regulated": t.regulated,
                    "license_required": t.license_required,
                    "certification_required": t.certification_required,
                    "hazardous": t.hazardous,
                    "structural": t.structural,
                    "is_active": t.is_active,
                })

            cat_dict = {
                "id": c.id,
                "slug": c.slug,
                "name": c.name,
                "icon_url": c.icon_url,
                "display_order": c.display_order,
                "active_tasks_list": tasks_data,
            }
            data.append(
                ProviderCategoryOut.model_validate(cat_dict).model_dump(by_alias=True)
            )
            
        return {"data": data}
    except Exception as e:
        import traceback
        traceback.print_exc() # Print full stack trace to server logs
        print(f"ERROR /taxonomy: {e}")
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Server Error in /taxonomy: {str(e)}"
        )


# ---------------------------------------------------------------------------
# GET /provider/services — current qualified task IDs
# ---------------------------------------------------------------------------

@router.get(
    "/services",
    summary="Get provider's current service qualifications",
)
async def get_services(
    db: DBSession,
    user: CurrentUser,
) -> Any:
    """Return the list of task IDs the provider is currently qualified for."""
    from src.models.provider import ProviderProfile
    from src.models.taxonomy import ProviderTaskQualification
    from sqlalchemy import select as sa_select

    profile_stmt = sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()

    if profile is None:
        return {"data": {"taskIds": [], "level": None}}

    qual_stmt = sa_select(ProviderTaskQualification.task_id).where(
        ProviderTaskQualification.provider_id == profile.id
    )
    result = await db.execute(qual_stmt)
    task_ids = [str(row[0]) for row in result.all()]

    return {
        "data": {
            "taskIds": task_ids,
            "level": profile.current_level.value if profile.current_level else "1",
            "status": profile.status.value if profile.status else "onboarding",
        }
    }


@router.get(
    "/service-catalog",
    summary="Get provider's service catalog items",
)
async def get_service_catalog(
    db: DBSession,
    user: CurrentUser,
) -> Any:
    return [
       {
           "id": "item1",
           "name": "Standard Residential Cleaning",
           "categoryId": "cat1",
           "categoryName": "Cleaning",
           "level": "1",
           "estimatedDurationMin": 60,
           "rateDescription": "$50/hr",
           "isAvailable": True
       }
    ]

from pydantic import BaseModel as _BaseModel

class _ServiceUpdateBody(_BaseModel):
    taskIds: list[str] = []

@router.post(
    "/services",
    summary="Update provider service qualifications",
)
async def update_services(
    db: DBSession,
    user: CurrentUser,
    body: _ServiceUpdateBody,
) -> Any:
    """Update the list of tasks the provider is qualified for.
    
    Expects JSON: { "taskIds": ["uuid1", "uuid2", ...] }
    """
    from src.models.taxonomy import ProviderTaskQualification, ServiceTask
    from sqlalchemy import delete as sa_delete, select as sa_select
    from datetime import datetime, timezone
    import uuid as _uuid

    try:
        task_ids = [_uuid.UUID(tid) for tid in body.taskIds]
    except ValueError as e:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Invalid task ID format: {e}",
        )

    # Resolve provider_id — auto-create profile if this is onboarding
    from src.models.provider import ProviderProfile, ProviderProfileStatus, ProviderLevel
    from sqlalchemy import select as sa_select2

    profile_stmt = sa_select2(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()

    if profile is None:
        # First time onboarding — create a provider profile with defaults
        profile = ProviderProfile(
            user_id=user.id,
            status=ProviderProfileStatus.ONBOARDING,
            current_level=ProviderLevel.LEVEL_1,
        )
        db.add(profile)
        await db.flush()  # get the generated profile.id

    provider_id = profile.id

    # 1. Clear existing qualifications (full replace)
    stmt = sa_delete(ProviderTaskQualification).where(
        ProviderTaskQualification.provider_id == provider_id
    )
    await db.execute(stmt)

    if not task_ids:
        await db.commit()
        return {"message": "Services cleared successfully"}

    # 2. Fetch task definitions to check requirements
    task_stmt = sa_select(ServiceTask).where(ServiceTask.id.in_(task_ids))
    tasks = (await db.execute(task_stmt)).scalars().all()

    # 3. Create new qualifications
    for task in tasks:
        is_restricted = (
            task.regulated or
            task.license_required or
            task.certification_required or
            task.hazardous or
            task.structural
        )
        is_qualified = not is_restricted

        qual = ProviderTaskQualification(
            provider_id=provider_id,
            task_id=task.id,
            qualified=is_qualified,
            auto_granted=is_qualified,
            qualified_at=datetime.now(timezone.utc) if is_qualified else None,
        )
        db.add(qual)

    await db.commit()
    return {"message": "Services updated successfully"}


# ---------------------------------------------------------------------------
# GET /provider/pending-credentials — services needing document upload
# ---------------------------------------------------------------------------

@router.get(
    "/pending-credentials",
    summary="Get services that need credential upload",
)
async def get_pending_credentials(
    db: DBSession,
    user: CurrentUser,
) -> Any:
    """Return unqualified services requiring docs, grouped by requirement type.

    Each item includes the service name, what document type is needed
    (license vs certification), and the current qualification status.
    """
    from src.models.provider import ProviderProfile
    from src.models.taxonomy import ProviderTaskQualification, ServiceTask
    from sqlalchemy import select as sa_select
    from sqlalchemy.orm import selectinload

    profile_stmt = sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()

    if profile is None:
        return {"data": []}

    # Fetch qualifications that are NOT qualified (pending approval)
    qual_stmt = (
        sa_select(ProviderTaskQualification)
        .options(selectinload(ProviderTaskQualification.task))
        .where(
            ProviderTaskQualification.provider_id == profile.id,
            ProviderTaskQualification.qualified == False,  # noqa: E712
        )
    )
    result = await db.execute(qual_stmt)
    unqualified = result.scalars().all()

    # Also fetch existing credentials for this provider to check upload status
    from src.models.verification import ProviderCredential
    cred_stmt = sa_select(ProviderCredential).where(
        ProviderCredential.provider_id == profile.id,
    )
    cred_result = await db.execute(cred_stmt)
    existing_creds = cred_result.scalars().all()

    # Build lookup: map by credential name (lower) AND by credential_type
    cred_by_name = {c.name.lower(): c for c in existing_creds}
    cred_by_type: dict[str, list] = {}
    for c in existing_creds:
        cred_by_type.setdefault(c.credential_type.value, []).append(c)

    pending = []
    for qual in unqualified:
        task = qual.task
        if not task:
            continue

        # Determine required doc type
        if task.license_required:
            required_type = "license"
            badge = "🛡 License Required"
        elif task.certification_required:
            required_type = "certification"
            badge = "📄 Certificate Required"
        elif task.regulated:
            required_type = "certification"
            badge = "⚠️ Regulated — Document Required"
        elif task.hazardous or task.structural:
            required_type = "certification"
            badge = "📄 Document Required"
        else:
            continue  # Not a doc-required task

        # Check if a credential has been uploaded for this task
        # First try exact name match, then fall back to credential_type match
        matching_cred = cred_by_name.get(task.name.lower())
        if not matching_cred:
            # Fallback: find any credential with matching type
            type_key = "license" if required_type == "license" else "certification"
            type_creds = cred_by_type.get(type_key, [])
            if type_creds:
                matching_cred = type_creds[0]  # Use the most recent one

        upload_status = "not_uploaded"
        credential_id = None
        if matching_cred:
            upload_status = matching_cred.status.value  # pending_review, verified, etc.
            credential_id = str(matching_cred.id)

        pending.append({
            "taskId": str(task.id),
            "taskName": task.name,
            "taskSlug": task.slug,
            "requiredType": required_type,
            "badge": badge,
            "uploadStatus": upload_status,
            "credentialId": credential_id,
        })

    return {"data": pending}


# ---------------------------------------------------------------------------
# Provider payouts — Stripe Connect onboarding
# ---------------------------------------------------------------------------

# Stripe requires HTTPS URLs for AccountLink — the backend exposes landing
# pages at these URLs that auto-redirect to the visptasker:// deep link.
from src.core.config import settings as _settings  # noqa: E402

_STRIPE_CONNECT_REFRESH_URL = _settings.stripe_connect_refresh_url
_STRIPE_CONNECT_RETURN_URL = _settings.stripe_connect_return_url


@router.post(
    "/payouts/setup",
    summary="Start or continue Stripe Connect onboarding for a provider",
    description=(
        "Creates a Stripe Express connected account for the authenticated "
        "provider if one does not exist, persists the account id, and "
        "returns a fresh onboarding URL the app can open."
    ),
)
async def setup_payouts(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.models.provider import ProviderProfile
    from src.integrations.stripe.payoutService import (
        create_connected_account as stripe_create_account,
        create_account_link as stripe_create_link,
        check_account_status as stripe_status,
    )
    from src.integrations.stripe.paymentService import PaymentError
    from sqlalchemy import select as sa_select

    stmt = sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(stmt)).scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    # Pre-validate the VISP profile so we don't hand Stripe an account that
    # will immediately get blocked by missing address fields. We require the
    # fields Stripe insists on for transfers in CA: street, city, province,
    # postal code. Country defaults to CA when missing.
    missing: list[str] = []
    if not (user.default_address_street or profile.home_address):
        missing.append("street")
    if not (user.default_address_city or profile.home_city):
        missing.append("city")
    if not (user.default_address_province or profile.home_province_state):
        missing.append("province")
    if not (user.default_address_postal_code or profile.home_postal_zip):
        missing.append("postalCode")

    if missing:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "profile_incomplete",
                "missing": missing,
                "message": (
                    "Complete your VISP profile (address) before setting up "
                    "payouts. Stripe requires these fields."
                ),
            },
        )

    # Validate country is one Stripe Connect supports for transfers-only
    # Express accounts. Mexico (MX), for example, requires the card_payments
    # capability alongside transfers, which doesn't fit VISP's merchant-of-
    # record model. Marketplace scope per CLAUDE.md is Canada & USA only.
    raw_country = (
        user.default_address_country
        or profile.home_country
        or "CA"
    ).upper()
    SUPPORTED_PAYOUT_COUNTRIES = {"CA", "US"}
    if raw_country not in SUPPORTED_PAYOUT_COUNTRIES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unsupported_country",
                "country": raw_country,
                "supportedCountries": sorted(SUPPORTED_PAYOUT_COUNTRIES),
                "message": (
                    "VISP payouts are currently available only for providers "
                    "in Canada and the USA. Update your address to continue."
                ),
            },
        )

    try:
        # If we already have a stripe_account_id, verify it still exists on
        # Stripe. Accounts can be deleted from the Stripe dashboard or via
        # cleanup scripts; when that happens we need to create a fresh one
        # instead of trying to issue an AccountLink against a dead id.
        if profile.stripe_account_id:
            logger.info(
                "setup_payouts: checking existing stripe account %s for provider %s",
                profile.stripe_account_id, profile.id,
            )
            current = await stripe_status(profile.stripe_account_id)
            if current.deleted:
                logger.warning(
                    "Provider %s had stale stripe_account_id %s (deleted); recreating",
                    profile.id,
                    profile.stripe_account_id,
                )
                profile.stripe_account_id = None
                await db.commit()
                await db.refresh(profile)

        if not profile.stripe_account_id:
            country_code = (
                user.default_address_country
                or profile.home_country
                or "CA"
            )
            result = await stripe_create_account(
                provider_id=profile.id,
                email=user.email,
                country=country_code,
                first_name=user.first_name,
                last_name=user.last_name,
                phone=user.phone,
                address_line1=user.default_address_street or profile.home_address,
                address_city=user.default_address_city or profile.home_city,
                address_state=(
                    user.default_address_province or profile.home_province_state
                ),
                address_postal_code=(
                    user.default_address_postal_code or profile.home_postal_zip
                ),
            )
            profile.stripe_account_id = result.account_id
            await db.commit()
            await db.refresh(profile)

        url = await stripe_create_link(
            account_id=profile.stripe_account_id,
            refresh_url=_STRIPE_CONNECT_REFRESH_URL,
            return_url=_STRIPE_CONNECT_RETURN_URL,
        )
    except PaymentError as exc:
        logger.error("setup_payouts Stripe error for provider %s: %s", profile.id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe error: {exc}",
        )
    except HTTPException:
        raise
    except Exception as exc:
        # Catch-all so the worker returns a JSON 500 instead of dying mid-
        # response (which Cloudflare then wraps in its "origin returned
        # invalid response" HTML page). The traceback still lands in logs.
        logger.exception("setup_payouts unexpected error for provider %s", profile.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error during payouts setup: {type(exc).__name__}",
        )

    return {
        "data": {
            "accountId": profile.stripe_account_id,
            "onboardingUrl": url,
        }
    }


# ---------------------------------------------------------------------------
# Stripe Connect Accounts v2 — native onboarding (replaces hosted Express flow)
# ---------------------------------------------------------------------------
#
# 7 endpoints + 1 status endpoint that walk the provider through KYC entirely
# inside the VISP mobile app. Each step pushes the captured data to Stripe
# via the v2 / v1 surface and returns the updated onboarding state.
#
#   POST /payouts/v2/init               → create v2 account
#   POST /payouts/v2/identity           → submit personal info
#   POST /payouts/v2/tax                → submit SSN/SIN
#   POST /payouts/v2/bank               → attach bank account
#   POST /payouts/v2/identity-document  → open Stripe Identity session
#   POST /payouts/v2/tos                → record TOS acceptance
#   GET  /payouts/v2/status             → fetch current state
# ---------------------------------------------------------------------------


async def _get_my_provider_profile(db, user):  # type: ignore[no-untyped-def]
    """Return the caller's ProviderProfile or raise 403."""
    from src.models.provider import ProviderProfile
    from sqlalchemy import select as sa_select

    stmt = sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(stmt)).scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )
    return profile


def _v2_status_dict(profile, status_result, has_external_account: bool) -> dict[str, Any]:  # type: ignore[no-untyped-def]
    """Shape a V2AccountResult into the JSON payload the mobile UI expects."""
    return {
        "data": {
            "accountId": status_result.account_id,
            "onboardingStep": status_result.onboarding_step,
            "requirementsDue": status_result.requirements_due,
            "capabilities": status_result.capabilities,
            "payoutsEnabled": status_result.payouts_enabled,
            "detailsSubmitted": status_result.details_submitted,
            "hasExternalAccount": has_external_account,
            "identitySessionId": profile.stripe_identity_session_id,
        }
    }


@router.post(
    "/payouts/v2/init",
    summary="Create a Stripe Connect v2 account for the provider",
    description=(
        "Creates a Stripe Connect account via /v2/core/accounts with "
        "controller.requirement_collection='application', so VISP collects "
        "the KYC fields natively in the mobile app instead of redirecting "
        "to Stripe's hosted form. Idempotent — if the provider already has "
        "an account id, returns the current status instead of creating "
        "another."
    ),
)
async def init_payouts_v2(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.connectV2Service import (
        create_v2_account,
        get_account_status,
    )
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)

    # Country defaults to the user's home address country, falling back to CA
    # (Ontario-first market). US fully supported; rest of the world is gated
    # at the platform level — same allow-list as the Express endpoint.
    country = (
        (user.default_address_country or profile.home_country or "CA")
        .upper()
    )
    if country not in ("CA", "US"):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail={
                "code": "unsupported_country",
                "supported": ["CA", "US"],
                "country": country,
            },
        )

    try:
        if profile.stripe_account_id:
            result = await get_account_status(profile.stripe_account_id)
        else:
            result = await create_v2_account(
                provider_id=profile.id,
                email=user.email,
                country=country,
            )
            profile.stripe_account_id = result.account_id

        profile.stripe_onboarding_step = result.onboarding_step
        profile.stripe_requirements_due = result.requirements_due
        profile.stripe_capabilities = result.capabilities
        await db.commit()

    except PaymentError as exc:
        logger.error("init_payouts_v2 Stripe error for provider %s: %s", profile.id, exc)
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe error: {exc}",
        )
    except HTTPException:
        raise
    except Exception as exc:
        logger.exception("init_payouts_v2 unexpected error for provider %s", profile.id)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"Internal error during payouts init: {type(exc).__name__}",
        )

    return _v2_status_dict(
        profile, result, has_external_account=bool(profile.stripe_external_account_id),
    )


@router.post(
    "/payouts/v2/identity",
    summary="Submit personal identity fields for the provider's Stripe account",
)
async def submit_payouts_identity(
    payload: "PayoutIdentityIn",  # forward ref — imported below
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.connectV2Service import submit_identity
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /payouts/v2/init first to create the connected account.",
        )

    try:
        result = await submit_identity(
            profile.stripe_account_id,
            first_name=payload.first_name,
            last_name=payload.last_name,
            dob_year=payload.dob_year,
            dob_month=payload.dob_month,
            dob_day=payload.dob_day,
            address_line1=payload.address_line1,
            address_city=payload.address_city,
            address_state=payload.address_state,
            address_postal_code=payload.address_postal_code,
            address_country=payload.address_country,
            phone=payload.phone,
            email=payload.email,
        )
        profile.stripe_onboarding_step = result.onboarding_step
        profile.stripe_requirements_due = result.requirements_due
        profile.stripe_capabilities = result.capabilities
        await db.commit()
    except PaymentError as exc:
        logger.error("submit_payouts_identity Stripe error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe rejected identity data: {exc}",
        )

    return _v2_status_dict(
        profile, result, has_external_account=bool(profile.stripe_external_account_id),
    )


@router.post(
    "/payouts/v2/tax",
    summary="Submit national tax identifier (SSN for US, SIN for CA)",
)
async def submit_payouts_tax(
    payload: "PayoutTaxIn",
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.connectV2Service import submit_tax
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /payouts/v2/init first.",
        )

    try:
        result = await submit_tax(
            profile.stripe_account_id,
            id_number=payload.id_number,
        )
        profile.stripe_onboarding_step = result.onboarding_step
        profile.stripe_requirements_due = result.requirements_due
        profile.stripe_capabilities = result.capabilities
        await db.commit()
    except PaymentError as exc:
        logger.error("submit_payouts_tax Stripe error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe rejected tax id: {exc}",
        )

    return _v2_status_dict(
        profile, result, has_external_account=bool(profile.stripe_external_account_id),
    )


@router.post(
    "/payouts/v2/bank",
    summary="Attach a bank account for payouts (routing + account number)",
)
async def submit_payouts_bank(
    payload: "PayoutBankIn",
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.connectV2Service import submit_bank
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /payouts/v2/init first.",
        )

    try:
        result, external_account_id = await submit_bank(
            profile.stripe_account_id,
            country=payload.country,
            currency=payload.currency,
            account_holder_name=payload.account_holder_name,
            routing_number=payload.routing_number,
            account_number=payload.account_number,
        )
        profile.stripe_external_account_id = external_account_id
        profile.stripe_onboarding_step = result.onboarding_step
        profile.stripe_requirements_due = result.requirements_due
        profile.stripe_capabilities = result.capabilities
        await db.commit()
    except PaymentError as exc:
        logger.error("submit_payouts_bank Stripe error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe rejected bank account: {exc}",
        )

    return _v2_status_dict(profile, result, has_external_account=True)


@router.post(
    "/payouts/v2/identity-document",
    summary="Open a Stripe Identity session for ID document + selfie capture",
)
async def open_identity_session(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.connectV2Service import create_identity_session
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /payouts/v2/init first.",
        )

    try:
        session = await create_identity_session(
            profile.stripe_account_id,
            customer_email=user.email,
        )
        profile.stripe_identity_session_id = session.session_id
        await db.commit()
    except PaymentError as exc:
        logger.error("open_identity_session Stripe error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe Identity error: {exc}",
        )

    return {
        "data": {
            "sessionId": session.session_id,
            "clientSecret": session.client_secret,
            "ephemeralKeySecret": session.ephemeral_key_secret,
            "publishableKey": _settings.stripe_publishable_key,
        }
    }


@router.post(
    "/payouts/v2/tos",
    summary="Record provider acceptance of the Stripe Services Agreement",
)
async def accept_payouts_tos(
    payload: "PayoutTosIn",
    request: Request,
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from datetime import datetime, timezone
    from src.integrations.stripe.connectV2Service import accept_tos
    from src.integrations.stripe.paymentService import PaymentError

    if not payload.accepted:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Acceptance flag must be true.",
        )

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /payouts/v2/init first.",
        )

    # Use the request-side IP + user agent so the client can't spoof them.
    # Cloudflare and other proxies set X-Forwarded-For — prefer it if present.
    fwd = request.headers.get("x-forwarded-for") or ""
    client_ip = (fwd.split(",")[0].strip() if fwd else (request.client.host if request.client else "0.0.0.0"))
    user_agent = request.headers.get("user-agent", "unknown")[:500]
    accepted_at = datetime.now(timezone.utc)

    try:
        result = await accept_tos(
            profile.stripe_account_id,
            ip=client_ip,
            user_agent=user_agent,
            accepted_at=accepted_at,
        )
        profile.stripe_tos_accepted_at = accepted_at
        profile.stripe_tos_acceptance_ip = client_ip
        profile.stripe_tos_acceptance_user_agent = user_agent
        profile.stripe_onboarding_step = result.onboarding_step
        profile.stripe_requirements_due = result.requirements_due
        profile.stripe_capabilities = result.capabilities
        await db.commit()
    except PaymentError as exc:
        logger.error("accept_payouts_tos Stripe error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Stripe rejected TOS acceptance: {exc}",
        )

    return _v2_status_dict(
        profile, result, has_external_account=bool(profile.stripe_external_account_id),
    )


@router.get(
    "/payouts/v2/status",
    summary="Current Stripe Connect v2 onboarding state for the authenticated provider",
)
async def get_payouts_v2_status(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.connectV2Service import get_account_status
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        return {
            "data": {
                "accountId": None,
                "onboardingStep": "init",
                "requirementsDue": [],
                "capabilities": {},
                "payoutsEnabled": False,
                "detailsSubmitted": False,
                "hasExternalAccount": False,
                "identitySessionId": None,
            }
        }

    try:
        result = await get_account_status(profile.stripe_account_id)
        profile.stripe_onboarding_step = result.onboarding_step
        profile.stripe_requirements_due = result.requirements_due
        profile.stripe_capabilities = result.capabilities
        await db.commit()
    except PaymentError as exc:
        logger.warning("get_payouts_v2_status Stripe error: %s — returning cached", exc)
        # Fall back to cached state so the mobile UI keeps working when
        # Stripe is briefly unreachable.
        return {
            "data": {
                "accountId": profile.stripe_account_id,
                "onboardingStep": profile.stripe_onboarding_step or "identity",
                "requirementsDue": list(profile.stripe_requirements_due or []),
                "capabilities": dict(profile.stripe_capabilities or {}),
                "payoutsEnabled": False,
                "detailsSubmitted": False,
                "hasExternalAccount": bool(profile.stripe_external_account_id),
                "identitySessionId": profile.stripe_identity_session_id,
            }
        }

    return _v2_status_dict(
        profile, result, has_external_account=bool(profile.stripe_external_account_id),
    )


@router.get(
    "/payouts/status",
    summary="Check Stripe Connect status for the authenticated provider",
)
async def get_payouts_status(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.models.provider import ProviderProfile
    from src.integrations.stripe.payoutService import check_account_status as stripe_status
    from src.integrations.stripe.paymentService import PaymentError
    from sqlalchemy import select as sa_select

    stmt = sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
    profile = (await db.execute(stmt)).scalar_one_or_none()
    if profile is None or not profile.stripe_account_id:
        return {
            "data": {
                "connected": False,
                "accountId": None,
                "detailsSubmitted": False,
                "chargesEnabled": False,
                "payoutsEnabled": False,
                "transfersCapability": "unknown",
                "disabledReason": None,
                "requirementsDue": [],
            }
        }

    try:
        info = await stripe_status(profile.stripe_account_id)
    except PaymentError as exc:
        raise HTTPException(
            status_code=status.HTTP_502_BAD_GATEWAY,
            detail=f"Stripe error: {exc}",
        )

    # If Stripe reports the account no longer exists, clear it in our DB so
    # the next setup_payouts call rebuilds cleanly. We do NOT raise here —
    # the frontend treats this as "not connected" and will offer to retry.
    if info.deleted:
        profile.stripe_account_id = None
        await db.commit()
        return {
            "data": {
                "connected": False,
                "accountId": None,
                "detailsSubmitted": False,
                "chargesEnabled": False,
                "payoutsEnabled": False,
                "transfersCapability": "unknown",
                "disabledReason": "deleted",
                "requirementsDue": [],
            }
        }

    return {
        "data": {
            "connected": True,
            "accountId": info.account_id,
            "detailsSubmitted": info.details_submitted,
            "chargesEnabled": info.charges_enabled,
            "payoutsEnabled": info.payouts_enabled,
            "transfersCapability": info.transfers_capability,
            "disabledReason": info.disabled_reason,
            "requirementsDue": info.requirements_due,
        }
    }
