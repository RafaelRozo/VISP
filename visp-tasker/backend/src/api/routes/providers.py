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
    DataResponse,
    ProviderCategoryOut,
)
from src.services import providerService, taxonomy_service


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

    profile_out = {
        "id": str(profile.id),
        "userId": str(profile.user_id),
        "level": level_int,
        "performanceScore": float(profile.internal_score) if profile.internal_score else 0,
        "isOnline": False,  # TODO: read from availability status
        "isOnCall": False,
        "completedJobs": 0,  # TODO: count from job_assignments
        "rating": 0.0,  # TODO: compute from reviews
        "stripeConnectStatus": "not_connected" if not profile.stripe_account_id else "active",
        "credentials": creds_out,
    }

    return {"data": {
        "profile": profile_out,
        "activeJob": None,  # TODO: query active assignments
        "pendingOffers": [],  # TODO: query pending offers
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


# ---------------------------------------------------------------------------
# Onboarding / Taxonomy
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

