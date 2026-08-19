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
    from src.models.taxonomy import ServiceTask
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
    except jobService.JobStartNotAllowedError as exc:
        # Not yet on-site / not yet the scheduled time — surface the human reason
        # (the app reads `detail` as a string and shows it to the provider).
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.reason,
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
#
# OJO al editar: este mapa colapsaba tres documentos distintos en un solo tipo y
# de ahí salieron dos bugs reales. Cada línea que apunte dos claves al mismo
# valor hace que esos dos renglones de la pantalla de Verification compartan
# estado (subes uno y los dos se ponen en verde).
_MOBILE_CRED_TYPE_MAP: dict[str, str] = {
    "trade_license": "license",
    "certification": "certification",
    "criminal_record_check": "background_check",
    # El certificado de seguro NO es una credencial: la póliza vive en
    # `provider_insurance_policies` (nº, aseguradora, cobertura, vigencia) y es
    # ahí donde la lee el motor. Se mantiene la entrada para no romper subidas
    # antiguas, pero el flujo nuevo va por POST /api/v1/provider/insurance.
    "insurance_certificate": "certification",
    "portfolio": "portfolio",
    # Tipo PROPIO desde la migración 035. Antes apuntaba a "license" y por eso
    # una licencia de conducir aprobada contaba como licencia de oficio.
    "drivers_license": "drivers_license",
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
    category_id: Optional[str] = Form(None),
) -> dict[str, Any]:
    import os
    from datetime import datetime, timezone
    from src.models.verification import ProviderCredential, CredentialType, CredentialStatus
    from src.models.taxonomy import ServiceCategory, ServiceTask
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

    # Determine credential name: prefer the SECTION name (section-based model,
    # migration 029), then task name (legacy), else the filename.
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

    # Section document (the current model): attach to the category so approval
    # unlocks the whole section and flips the provider's level.
    category_uuid: Optional[uuid.UUID] = None
    if category_id:
        try:
            category_uuid = uuid.UUID(category_id)
        except ValueError:
            category_uuid = None
        if category_uuid is not None:
            cat_obj = (
                await db.execute(
                    sa_select(ServiceCategory).where(ServiceCategory.id == category_uuid)
                )
            ).scalar_one_or_none()
            if cat_obj:
                cred_name = cat_obj.name  # section name wins over task/filename
            else:
                category_uuid = None  # bogus id — don't store an unresolvable FK

    # Create the credential record
    credential = ProviderCredential(
        id=uuid.uuid4(),
        provider_id=provider_id,
        credential_type=cred_type,
        name=cred_name,
        task_id=task_uuid,
        category_id=category_uuid,
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
            "categoryId": str(credential.category_id) if credential.category_id else None,
            "documentUrl": credential.document_url,
            "createdAt": credential.created_at.isoformat() if credential.created_at else None,
        }
    }


# ---------------------------------------------------------------------------
# POST /api/v1/provider/insurance  — subir la PÓLIZA (no un archivo suelto)
# ---------------------------------------------------------------------------
#
# POR QUÉ ESTE ENDPOINT EXISTE (WP1b, decisión del cliente 2026-08-10):
# la pantalla de Verification subía el certificado de seguro como una credencial
# genérica (`_MOBILE_CRED_TYPE_MAP` lo mandaba a CredentialType.CERTIFICATION):
# un PDF suelto, sin número de póliza, sin aseguradora, sin monto y SIN FECHA DE
# VENCIMIENTO. Mientras tanto el motor lee `provider_insurance_policies`, que
# estaba vacía. Resultado: el proveedor subía su certificado, el admin lo
# aprobaba, y el gate de seguro seguía respondiendo "no tiene seguro".
#
# Sin vencimiento una póliza caducada se ve idéntica a una vigente, que es justo
# el riesgo que el seguro venía a cubrir — de ahí que los campos sean requeridos.
#
# El endpoint viejo `POST /verification/insurance` recibe `provider_id` EN EL
# BODY sin autenticar (un proveedor podría dar de alta una póliza a nombre de
# otro) y no acepta archivo. Este toma el proveedor del token.


@router.post(
    "/insurance",
    status_code=status.HTTP_201_CREATED,
    summary="Submit an insurance policy with its document",
    description=(
        "Sube el certificado y los datos de la póliza. Queda en PENDING_REVIEW "
        "hasta que un admin la verifique.\n\n"
        "NO está atado a un nivel: cualquier proveedor puede subir su póliza en "
        "cualquier momento, y los servicios que exijan CGL se le abren cuando "
        "queda verificada."
    ),
)
async def submit_provider_insurance(
    db: DBSession,
    user: CurrentUser,
    file: UploadFile = File(..., description="Certificado de la póliza"),
    policyNumber: str = Form(...),
    insurerName: str = Form(...),
    coverageAmountCents: int = Form(..., description="Cobertura en CENTAVOS"),
    effectiveDate: str = Form(..., description="ISO date, p.ej. 2026-01-01"),
    expiryDate: str = Form(..., description="ISO date"),
    policyType: str = Form("general_liability"),
    deductibleCents: Optional[int] = Form(None),
) -> dict[str, Any]:
    import os
    from datetime import date as _date

    from src.models.verification import InsuranceStatus, ProviderInsurancePolicy

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    def _parse_date(raw: str, label: str) -> _date:
        try:
            return _date.fromisoformat(raw.strip())
        except ValueError:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"{label} must be an ISO date (YYYY-MM-DD).",
            )

    effective = _parse_date(effectiveDate, "effectiveDate")
    expiry = _parse_date(expiryDate, "expiryDate")

    # 400 y no 422/5xx: Cloudflare envuelve los 5xx y el proveedor no leería nada.
    if expiry <= effective:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The expiry date must be after the effective date.",
        )
    # Una póliza ya vencida no se acepta: entraría como PENDING_REVIEW y le haría
    # perder el tiempo al admin para acabar rechazándola.
    if expiry <= _date.today():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="This policy has already expired. Upload a policy that is still valid.",
        )
    if coverageAmountCents <= 0:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The coverage amount must be greater than zero.",
        )
    if not policyNumber.strip() or not insurerName.strip():
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Policy number and insurer name are required.",
        )

    uploads_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "uploads",
        "insurance",
        str(provider_id),
    )
    os.makedirs(uploads_dir, exist_ok=True)

    safe_filename = f"{uuid.uuid4()}_{file.filename or 'policy.pdf'}"
    with open(os.path.join(uploads_dir, safe_filename), "wb") as fh:
        fh.write(await file.read())

    policy = ProviderInsurancePolicy(
        provider_id=provider_id,
        policy_number=policyNumber.strip(),
        insurer_name=insurerName.strip(),
        policy_type=policyType.strip() or "general_liability",
        coverage_amount_cents=coverageAmountCents,
        deductible_cents=deductibleCents,
        effective_date=effective,
        expiry_date=expiry,
        status=InsuranceStatus.PENDING_REVIEW,
        document_url=f"/uploads/insurance/{provider_id}/{safe_filename}",
    )
    db.add(policy)
    await db.commit()
    await db.refresh(policy)

    return {
        "data": {
            "id": str(policy.id),
            "policyNumber": policy.policy_number,
            "insurerName": policy.insurer_name,
            "policyType": policy.policy_type,
            "coverageAmountCents": policy.coverage_amount_cents,
            "effectiveDate": policy.effective_date.isoformat(),
            "expiryDate": policy.expiry_date.isoformat(),
            "status": policy.status.value,
            "documentUrl": policy.document_url,
        }
    }


# ---------------------------------------------------------------------------
# Expediente de experiencia (L1) — WP1c
# ---------------------------------------------------------------------------
#
# Decisión del cliente (2026-08-11): el proveedor sube su CV, fotos de trabajos y
# cartas de recomendación en UN expediente global, y con eso valida experiencia
# para subir a L1. NO es por categoría (eso se planteó el 2026-08-04 y se revirtió).
#
# Lo que VISP valida es DOCUMENTAL, no de competencia: que la evidencia exista y
# esté legible. `REJECTED` significa "documentación incompleta o ilegible", nunca
# "no eres competente". Es importante que el copy de la app lo refleje.

_EXPERIENCE_UPLOAD_MAX_BYTES = 15 * 1024 * 1024


@router.get("/experience", summary="List my experience records")
async def list_my_experience(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from sqlalchemy import select as sa_select

    from src.models.verification import ProviderExperienceRecord

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    rows = (
        await db.execute(
            sa_select(ProviderExperienceRecord)
            .where(
                ProviderExperienceRecord.provider_id == provider_id,
                # Solo el expediente GLOBAL: category_id IS NULL. Lo atado a una
                # clasificación queda reservado para cuando se abra L2.
                ProviderExperienceRecord.category_id.is_(None),
            )
            .order_by(ProviderExperienceRecord.submitted_at.desc())
        )
    ).scalars().all()

    return {
        "data": [
            {
                "id": str(r.id),
                "kind": r.kind.value,
                "title": r.title,
                "description": r.description,
                "documentUrl": r.document_url,
                "status": r.status.value,
                "rejectionReason": r.rejection_reason,
                "submittedAt": r.submitted_at.isoformat() if r.submitted_at else None,
                "validatedAt": r.validated_at.isoformat() if r.validated_at else None,
            }
            for r in rows
        ]
    }


@router.post(
    "/experience",
    status_code=status.HTTP_201_CREATED,
    summary="Submit or replace one piece of experience evidence",
    description=(
        "Sube un documento del expediente de experiencia (CV, fotos de trabajos, "
        "carta de recomendación...). Queda en PENDING hasta que un admin lo "
        "valide.\n\n"
        "Si ya existe un documento del MISMO tipo, se REEMPLAZA y vuelve a "
        "PENDING: acumular dos CV distintos dejaría al validador sin saber cuál "
        "mirar."
    ),
)
async def submit_experience_record(
    db: DBSession,
    user: CurrentUser,
    file: UploadFile = File(...),
    kind: str = Form(..., description="resume | work_photos | recommendation_letter | ..."),
    title: Optional[str] = Form(None),
    description: Optional[str] = Form(None),
) -> dict[str, Any]:
    import os
    from datetime import datetime as _dt
    from datetime import timezone as _tz

    from sqlalchemy import select as sa_select

    from src.models.verification import (
        ExperienceRecordKind,
        ExperienceRecordStatus,
        ProviderExperienceRecord,
    )

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    raw_kind = (kind or "").strip()
    parsed_kind: Optional[ExperienceRecordKind] = None
    for candidate in (raw_kind.lower(), raw_kind.upper()):
        try:
            parsed_kind = ExperienceRecordKind(candidate)
            break
        except ValueError:
            attr = getattr(ExperienceRecordKind, candidate.upper(), None)
            if isinstance(attr, ExperienceRecordKind):
                parsed_kind = attr
                break
    if parsed_kind is None:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"Invalid kind '{kind}'. Valid: "
                + ", ".join(k.value for k in ExperienceRecordKind)
            ),
        )

    content = await file.read()
    if not content:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="The uploaded file is empty.",
        )
    if len(content) > _EXPERIENCE_UPLOAD_MAX_BYTES:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"File is too large ({len(content) // (1024 * 1024)} MB). "
                f"Maximum is {_EXPERIENCE_UPLOAD_MAX_BYTES // (1024 * 1024)} MB."
            ),
        )

    uploads_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "uploads",
        "experience",
        str(provider_id),
    )
    os.makedirs(uploads_dir, exist_ok=True)
    safe_filename = f"{uuid.uuid4()}_{file.filename or 'evidence'}"
    with open(os.path.join(uploads_dir, safe_filename), "wb") as fh:
        fh.write(content)
    document_url = f"/uploads/experience/{provider_id}/{safe_filename}"

    # Reemplazo, no acumulación. Coincide con el índice único parcial
    # `uq_experience_global_kind` de la migración 038: sin este upsert, un segundo
    # envío del mismo tipo devolvería un 500 por violación de unicidad.
    existing = (
        await db.execute(
            sa_select(ProviderExperienceRecord).where(
                ProviderExperienceRecord.provider_id == provider_id,
                ProviderExperienceRecord.category_id.is_(None),
                ProviderExperienceRecord.kind == parsed_kind,
            )
        )
    ).scalar_one_or_none()

    now = _dt.now(_tz.utc)
    if existing is not None:
        existing.title = (title or "").strip() or existing.title
        existing.description = (description or "").strip() or existing.description
        existing.document_url = document_url
        # Documento nuevo = validación nueva. Dejarlo VALIDATED permitiría
        # sustituir un documento aprobado por otro sin revisar.
        existing.status = ExperienceRecordStatus.PENDING
        existing.submitted_at = now
        existing.validated_at = None
        existing.rejection_reason = None
        record = existing
        created = False
    else:
        record = ProviderExperienceRecord(
            provider_id=provider_id,
            category_id=None,
            kind=parsed_kind,
            title=(title or "").strip() or None,
            description=(description or "").strip() or None,
            document_url=document_url,
            status=ExperienceRecordStatus.PENDING,
            submitted_at=now,
        )
        db.add(record)
        created = True

    await db.commit()
    await db.refresh(record)

    return {
        "data": {
            "id": str(record.id),
            "kind": record.kind.value,
            "title": record.title,
            "status": record.status.value,
            "documentUrl": record.document_url,
            "replaced": not created,
        }
    }


@router.delete("/experience/{record_id}", summary="Delete one experience record")
async def delete_experience_record(
    db: DBSession,
    user: CurrentUser,
    record_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select as sa_select

    from src.models.verification import ProviderExperienceRecord

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )

    record = (
        await db.execute(
            sa_select(ProviderExperienceRecord).where(
                ProviderExperienceRecord.id == record_id,
                # El filtro por provider_id no es cosmético: sin él, cualquier
                # proveedor autenticado podría borrar la evidencia de otro.
                ProviderExperienceRecord.provider_id == provider_id,
            )
        )
    ).scalar_one_or_none()
    if record is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="Experience record not found."
        )

    await db.delete(record)
    await db.commit()
    return {"data": {"id": str(record_id), "deleted": True}}


# ---------------------------------------------------------------------------
# Provider profile summary (bio + years) and free-form documents (VISP-8)
# ---------------------------------------------------------------------------

class ProviderProfilePatch(BaseModel):
    """Editable profile-summary fields the provider writes about themselves."""
    bio: Optional[str] = None
    yearsExperience: Optional[int] = None


@router.get("/profile", summary="Read provider profile summary (bio, years)")
async def get_provider_profile_summary(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    """Simétrico del PATCH. Existía el de escritura pero no el de lectura, así que
    la app no podía precargar la bio en su editor."""
    from sqlalchemy import select as sa_select

    from src.models.provider import ProviderProfile

    profile = (
        await db.execute(
            sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
        )
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )
    return {
        "data": {
            "bio": profile.bio,
            "yearsExperience": profile.years_experience,
        }
    }


@router.patch("/profile", summary="Update provider profile summary (bio, years)")
async def update_provider_profile(
    db: DBSession,
    user: CurrentUser,
    body: ProviderProfilePatch,
) -> dict[str, Any]:
    from sqlalchemy import select as sa_select
    from src.models.provider import ProviderProfile

    profile = (
        await db.execute(sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=403, detail="User does not have a provider profile.")

    if body.bio is not None:
        profile.bio = body.bio.strip() or None
    if body.yearsExperience is not None:
        profile.years_experience = max(0, body.yearsExperience)
    await db.commit()
    return {"data": {"bio": profile.bio, "yearsExperience": profile.years_experience}}


@router.post(
    "/documents",
    summary="Upload a free-form provider document/certificate",
    status_code=status.HTTP_201_CREATED,
)
async def upload_provider_document(
    db: DBSession,
    user: CurrentUser,
    file: UploadFile = File(...),
    name: Optional[str] = Form(None),
) -> dict[str, Any]:
    import os
    from src.models.provider import ProviderDocument

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(status_code=403, detail="User does not have a provider profile.")

    uploads_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "uploads",
        "provider_documents",
        str(provider_id),
    )
    os.makedirs(uploads_dir, exist_ok=True)

    safe_filename = f"{uuid.uuid4()}_{file.filename or 'document'}"
    with open(os.path.join(uploads_dir, safe_filename), "wb") as f:
        f.write(await file.read())

    doc = ProviderDocument(
        provider_id=provider_id,
        name=(name or file.filename or "Document").strip(),
        document_url=f"/uploads/provider_documents/{provider_id}/{safe_filename}",
    )
    db.add(doc)
    await db.commit()
    await db.refresh(doc)
    return {"data": {"id": str(doc.id), "name": doc.name, "documentUrl": doc.document_url}}


@router.get("/documents", summary="List the provider's own documents")
async def list_provider_documents(db: DBSession, user: CurrentUser) -> dict[str, Any]:
    from sqlalchemy import select as sa_select
    from src.models.provider import ProviderDocument

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        return {"data": []}

    rows = (
        await db.execute(
            sa_select(ProviderDocument)
            .where(ProviderDocument.provider_id == provider_id)
            .order_by(ProviderDocument.created_at.desc())
        )
    ).scalars().all()
    return {"data": [
        {"id": str(d.id), "name": d.name, "documentUrl": d.document_url} for d in rows
    ]}


@router.delete("/documents/{document_id}", summary="Delete one of the provider's documents")
async def delete_provider_document(
    db: DBSession, user: CurrentUser, document_id: uuid.UUID
) -> dict[str, Any]:
    from sqlalchemy import select as sa_select
    from src.models.provider import ProviderDocument

    try:
        provider_id = await _get_provider_id(db, user)
    except providerService.ProviderNotFoundError:
        raise HTTPException(status_code=403, detail="User does not have a provider profile.")

    doc = (
        await db.execute(
            sa_select(ProviderDocument).where(
                ProviderDocument.id == document_id,
                ProviderDocument.provider_id == provider_id,
            )
        )
    ).scalar_one_or_none()
    if doc is None:
        raise HTTPException(status_code=404, detail="Document not found.")
    await db.delete(doc)
    await db.commit()
    return {"data": {"deleted": True}}


@router.get(
    "/{provider_id}/public-profile",
    summary="Public provider profile (bio, rating, documents) for radar / job status",
)
async def get_provider_public_profile(
    db: DBSession,
    user: CurrentUser,
    provider_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import func, select as sa_select
    from src.models.provider import ProviderDocument, ProviderProfile
    from src.models.review import Review, ReviewStatus
    from src.models.user import User

    profile = (
        await db.execute(sa_select(ProviderProfile).where(ProviderProfile.id == provider_id))
    ).scalar_one_or_none()
    if profile is None:
        raise HTTPException(status_code=404, detail="Provider not found.")

    u = (await db.execute(sa_select(User).where(User.id == profile.user_id))).scalar_one_or_none()
    display_name = " ".join(
        [p for p in [getattr(u, "first_name", None), getattr(u, "last_name", None)] if p]
    ) or "Provider"

    rating_row = (
        await db.execute(
            sa_select(func.avg(Review.overall_rating), func.count(Review.id)).where(
                Review.reviewee_id == profile.user_id,
                Review.status == ReviewStatus.PUBLISHED,
            )
        )
    ).one()
    avg, cnt = rating_row
    docs = (
        await db.execute(
            sa_select(ProviderDocument)
            .where(ProviderDocument.provider_id == provider_id)
            .order_by(ProviderDocument.created_at.desc())
        )
    ).scalars().all()

    return {"data": {
        "providerId": str(provider_id),
        "displayName": display_name,
        "level": int(profile.current_level.value.replace("LEVEL_", "")) if profile.current_level else None,
        "bio": profile.bio,
        "yearsExperience": profile.years_experience,
        "rating": round(float(avg), 1) if avg is not None else None,
        "reviewCount": int(cnt or 0),
        "documents": [
            {"id": str(d.id), "name": d.name, "documentUrl": d.document_url} for d in docs
        ],
    }}


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
    """Real catalog for the provider's service-selection screen.

    Every active task is returned with its section-gating info so the app can
    render the section-based credentials model (migration 029):

    * ``isAvailable``      — the provider already offers this service.
    * ``requiresCredential`` — the section is gated (needs a section document).
    * ``locked``           — gated section the provider hasn't unlocked at their
                             current level; the app shows the help-message pop-up
                             and prompts a section-document upload before it can
                             be offered.
    * ``helpMessageEn/Fr`` — the per-section upload instructions (admin-set).
    """
    from sqlalchemy import select as sa_select
    from src.models.provider import ProviderLevel, ProviderProfile
    from src.models.taxonomy import (
        ProviderTaskQualification,
        ServiceCategory,
        ServiceTask,
    )
    from src.services.provider_level_service import (
        provider_has_valid_insurance,
        task_qualifies,
        tasks_requiring_insurance,
    )

    profile = (
        await db.execute(
            sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
        )
    ).scalar_one_or_none()
    current_level = profile.current_level if profile else ProviderLevel.LEVEL_1

    offered: set[uuid.UUID] = set()
    if profile is not None:
        offered = set(
            (
                await db.execute(
                    sa_select(ProviderTaskQualification.task_id).where(
                        ProviderTaskQualification.provider_id == profile.id
                    )
                )
            ).scalars().all()
        )

    rows = (
        await db.execute(
            sa_select(ServiceTask, ServiceCategory)
            .join(ServiceCategory, ServiceTask.category_id == ServiceCategory.id)
            .where(ServiceTask.is_active.is_(True))
            .order_by(
                ServiceCategory.display_order,
                ServiceTask.display_order,
                ServiceTask.name,
            )
        )
    ).all()

    # Gate de seguro POR SERVICIO. Se resuelve en DOS consultas para todo el
    # catálogo (qué servicios lo exigen + si el proveedor tiene póliza), no una
    # por servicio: son 147 servicios y esta pantalla se abre a menudo.
    insurance_tasks = await tasks_requiring_insurance(db, [t.id for t, _ in rows])
    has_insurance = (
        await provider_has_valid_insurance(db, profile.id) if profile else False
    )

    items: list[dict[str, Any]] = []
    for task, cat in rows:
        gated = cat.requires_credential
        needs_insurance = task.id in insurance_tasks
        # Sin póliza vigente NO se puede ofrecer un servicio que la exige. Se
        # informa aquí además de bloquearlo al guardar, para que el proveedor
        # entienda POR QUÉ está bloqueado en vez de ver un error al final.
        insurance_missing = needs_insurance and not has_insurance
        can_offer = task_qualifies(current_level, task.level, gated) and not insurance_missing
        if task.base_price_min_cents and task.base_price_max_cents:
            lo = task.base_price_min_cents // 100
            hi = task.base_price_max_cents // 100
            unit = task.pricing_unit.value if task.pricing_unit else ""
            rate_desc = f"${lo}-${hi}" + (f"/{unit}" if unit else "")
        else:
            rate_desc = ""
        items.append({
            "id": str(task.id),
            "name": task.name,
            "categoryId": str(cat.id),
            "categoryName": cat.name,
            "level": task.level.value.replace("LEVEL_", ""),
            "estimatedDurationMin": task.estimated_duration_min or 0,
            "rateDescription": rate_desc,
            "isAvailable": task.id in offered,
            # Section-based credential gating (migration 029).
            "requiresCredential": gated,
            "helpMessageEn": cat.help_message_en,
            "helpMessageFr": cat.help_message_fr,
            "locked": (gated and not can_offer) or insurance_missing,
            # La app usa esto para explicar el candado y ofrecer subir la póliza.
            "requiresInsurance": needs_insurance,
            "insuranceMissing": insurance_missing,
        })
    return items

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

    # 2. Fetch task definitions + their section (gating lives on the section now)
    from src.models.taxonomy import ServiceCategory
    from src.services.provider_level_service import (
        provider_has_valid_insurance,
        task_qualifies,
        tasks_requiring_insurance,
    )

    task_stmt = (
        sa_select(ServiceTask, ServiceCategory)
        .join(ServiceCategory, ServiceTask.category_id == ServiceCategory.id)
        .where(ServiceTask.id.in_(task_ids))
    )
    rows = (await db.execute(task_stmt)).all()

    # Gate de seguro. Se aplica también AQUÍ y no solo en el listado: el listado
    # es informativo y un cliente podría mandar el POST directamente con un
    # servicio bloqueado. La cualificación es lo que el matching lee, así que es
    # el único sitio donde el gate cuenta de verdad.
    insurance_tasks = await tasks_requiring_insurance(db, [t.id for t, _ in rows])
    has_insurance = await provider_has_valid_insurance(db, provider_id)

    # 3. Create new qualifications. A service is just an "I offer this" checkbox;
    #    whether it's immediately active depends on the provider's level vs the
    #    SECTION's gating (section-based model, migration 029). Providers in a
    #    gated section they haven't unlocked yet get qualified=False until their
    #    section document is approved (which flips their level + re-grants).
    now = datetime.now(timezone.utc)
    for task, category in rows:
        # Un servicio que exige seguro sin póliza vigente se guarda como elegido
        # pero NO cualificado: el proveedor lo ve en su lista con el motivo, y el
        # matching no se lo ofrece. Al verificarse la póliza,
        # `recompute_level_and_qualifications` lo activa solo.
        insurance_ok = task.id not in insurance_tasks or has_insurance
        is_qualified = (
            task_qualifies(profile.current_level, task.level, category.requires_credential)
            and insurance_ok
        )
        qual = ProviderTaskQualification(
            provider_id=provider_id,
            task_id=task.id,
            qualified=is_qualified,
            auto_granted=is_qualified,
            qualified_at=now if is_qualified else None,
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


# ---------------------------------------------------------------------------
# POST /provider/payouts/setup — RETIRADO el 2026-08-12
# ---------------------------------------------------------------------------
# Creaba una cuenta Stripe Express (`type: 'express'`) y devolvía un enlace de
# onboarding hospedado. Sustituido por completo por el flujo nativo
# /provider/payouts/v2/*, que usa Accounts v2.
#
# Por qué se retira y no se deja "por si acaso":
#   - Ninguna pantalla de la app lo llamaba (el wrapper existía en
#     providerService.ts sin usarse).
#   - Tener dos caminos para crear la cuenta de cobro del MISMO proveedor deja
#     abierta la posibilidad de una cuenta Express huérfana junto a la v2, y
#     que el dinero se enrute a la que no completó verificación.
#   - La guía de Stripe indica no usar los tipos legacy en plataformas nuevas.
#
# La validación de perfil incompleto y el gate de país que vivían aquí ya se
# aplican en el flujo v2.


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
            "disabledReason": status_result.disabled_reason,
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
    from src.integrations.stripe.connectV2Service import finalize_and_get_status
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
                "disabledReason": None,
                "hasExternalAccount": False,
                "identitySessionId": None,
            }
        }

    try:
        # Synchronously finalize: if stuck on identity_doc and a verified Identity
        # session exists, attach the document to the account, then re-read.
        result = await finalize_and_get_status(
            profile.stripe_account_id, profile.stripe_identity_session_id
        )
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


@router.post(
    "/payouts/v2/onboarding-link",
    summary="Hosted Stripe onboarding link to finish verification (incl. liveness)",
    description=(
        "Creates a short-lived Stripe-hosted account_onboarding link for the "
        "provider's connected account. Required for requirements the native "
        "flow cannot satisfy — notably individual.verification.proof_of_liveness "
        "— which Stripe only clears through its hosted verification (selfie/"
        "liveness). In test mode the hosted page completes with test data."
    ),
)
async def create_payouts_v2_onboarding_link(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from src.integrations.stripe.payoutService import create_account_link
    from src.integrations.stripe.paymentService import PaymentError

    profile = await _get_my_provider_profile(db, user)
    if not profile.stripe_account_id:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Call /payouts/v2/init first.",
        )

    try:
        url = await create_account_link(
            account_id=profile.stripe_account_id,
            refresh_url=_STRIPE_CONNECT_REFRESH_URL,
            return_url=_STRIPE_CONNECT_RETURN_URL,
        )
    except PaymentError as exc:
        logger.error("create_payouts_v2_onboarding_link Stripe error: %s", exc)
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=f"Could not create onboarding link: {exc}",
        )

    return {"data": {"url": url}}


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
