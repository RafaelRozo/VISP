"""
Job API Routes -- VISP-BE-JOBS-002
====================================

REST endpoints for job lifecycle management.

Routes:
  POST   /api/v1/jobs                         -- Create a new job (internal)
  POST   /api/v1/jobs/book                    -- Create a new job (mobile)
  GET    /api/v1/jobs/active                  -- Active jobs for current user
  GET    /api/v1/jobs/{job_id}                -- Get job detail with assignment
  PATCH  /api/v1/jobs/{job_id}/status          -- Update job status (internal)
  PATCH  /api/v1/jobs/{job_id}/update-status   -- Update job status (mobile)
  POST   /api/v1/jobs/{job_id}/cancel          -- Cancel a job
  GET    /api/v1/jobs/{job_id}/tracking        -- Real-time job tracking
  GET    /api/v1/jobs/customer/{customer_id}   -- Jobs by customer (paginated)
  GET    /api/v1/jobs/provider/{provider_id}   -- Jobs by provider (paginated)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.job import (
    JobBrief,
    JobCancelRequest,
    JobCreateRequest,
    JobListResponse,
    JobOut,
    JobStatusUpdateRequest,
    PaginationMeta,
)
from src.api.schemas.provider import (
    EstimatedPriceOut,
    JobCreateResponse,
    JobTrackingOut,
    MobileJobCreateRequest,
    MobileJobOut,
    MobileJobStatusUpdateRequest,
)
from src.core.config import settings
from src.services import jobService

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["Jobs"])


# ---------------------------------------------------------------------------
# POST /api/v1/jobs -- Create a new job
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=JobOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new job",
    description=(
        "Creates a new job from the closed task catalog. The SLA terms from "
        "the matching sla_profiles record are captured as an immutable snapshot "
        "at creation time. The job starts in 'draft' status."
    ),
)
async def create_job(
    db: DBSession,
    body: JobCreateRequest,
) -> JobOut:
    try:
        job = await jobService.create_job(
            db,
            customer_id=body.customer_id,
            task_id=body.task_id,
            location=body.location.model_dump(),
            schedule=body.schedule.model_dump() if body.schedule else None,
            priority=body.priority,
            is_emergency=body.is_emergency,
            customer_notes_json=body.customer_notes_json,
        )
    except jobService.TaskNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/book -- Mobile-friendly job booking
# ---------------------------------------------------------------------------

@router.post(
    "/book",
    status_code=status.HTTP_201_CREATED,
    summary="Book a new job (mobile)",
    description=(
        "Mobile-friendly endpoint for booking a job. Uses camelCase request "
        "body and wraps the response in { data: { job, estimatedPrice } }. "
        "Creates the job, snapshots SLA, estimates pricing, and starts matching."
    ),
)
async def book_job(
    db: DBSession,
    user: CurrentUser,
    body: MobileJobCreateRequest,
) -> dict[str, Any]:
    # Determine priority from emergency flag
    priority = "emergency" if body.is_emergency else "standard"

    # Build schedule from scheduledAt if provided
    schedule = None
    if body.scheduled_at:
        schedule = {
            "requested_date": body.scheduled_at.date(),
            "requested_time_start": body.scheduled_at.time(),
            "requested_time_end": None,
            "flexible_schedule": False,
        }

    try:
        job = await jobService.create_job(
            db,
            customer_id=user.id,
            task_id=body.service_task_id,
            location={
                "latitude": body.location_lat,
                "longitude": body.location_lng,
                "address": body.location_address,
                "city": body.city,
                "province_state": body.province_state,
                "postal_zip": body.postal_zip,
                "country": body.country,
                "unit": body.unit,
            },
            schedule=schedule,
            priority=priority,
            is_emergency=body.is_emergency,
            customer_notes_json=body.notes or [],
        )
    except jobService.TaskNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )

    # Transition from DRAFT to PENDING_MATCH to kick off matching
    try:
        job = await jobService.update_job_status(
            db,
            job.id,
            "pending_match",
            actor_type="system",
        )
    except (jobService.JobNotFoundError, jobService.InvalidTransitionError):
        pass  # Stay in DRAFT if transition fails

    # Attempt price estimation
    estimated_price = EstimatedPriceOut(
        min_cents=job.quoted_price_cents or 0,
        max_cents=job.quoted_price_cents or 0,
        currency=job.currency,
        is_emergency=job.is_emergency,
        dynamic_multiplier=None,
    )

    # Try to calculate from the pricing engine
    try:
        from src.services.pricingEngine import calculate_price as calc_price

        estimate = await calc_price(
            db,
            task_id=job.task_id,
            latitude=job.service_latitude,
            longitude=job.service_longitude,
            requested_date=job.requested_date,
            is_emergency=job.is_emergency,
            country=job.service_country,
        )
        estimated_price = EstimatedPriceOut(
            min_cents=estimate.final_price_min_cents,
            max_cents=estimate.final_price_max_cents,
            currency=estimate.currency,
            is_emergency=estimate.is_emergency,
            dynamic_multiplier=estimate.dynamic_multiplier,
        )

        # Update the job with the quoted price
        job.quoted_price_cents = estimate.final_price_min_cents
        job.commission_rate = estimate.commission_rate_default
        job.commission_amount_cents = int(
            Decimal(str(estimate.final_price_min_cents))
            * estimate.commission_rate_default
        )
        job.provider_payout_cents = (
            estimate.final_price_min_cents - job.commission_amount_cents
        )
        await db.flush()
    except Exception as exc:
        logger.warning("Price estimation failed for job %s: %s", job.id, exc)

    # Start matching (best-effort for MVP)
    try:
        from src.services.matchingEngine import assign_provider, find_matching_providers

        match_result = await find_matching_providers(db, job, max_results=1)
        if match_result["matches"]:
            best = match_result["matches"][0]
            await assign_provider(
                db,
                job.id,
                best["provider_id"],
                match_score=float(best["composite_score"]),
            )
    except Exception as exc:
        logger.warning("Auto-matching failed for job %s: %s", job.id, exc)

    # Build mobile-friendly response
    job_out = MobileJobOut.model_validate(job)
    response = JobCreateResponse(
        job=job_out,
        estimated_price=estimated_price,
    )

    return {"data": response.model_dump(by_alias=True)}


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/active -- Active jobs for current user
# ---------------------------------------------------------------------------

@router.get(
    "/active",
    summary="Get customer's active jobs",
    description=(
        "Returns active jobs for the authenticated customer. Active means "
        "any status except completed, cancelled, disputed, and refunded."
    ),
)
async def get_active_jobs(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from src.models.job import Job, JobStatus

    terminal_statuses = {
        JobStatus.COMPLETED,
        JobStatus.CANCELLED_BY_CUSTOMER,
        JobStatus.CANCELLED_BY_PROVIDER,
        JobStatus.CANCELLED_BY_SYSTEM,
        JobStatus.DISPUTED,
        JobStatus.REFUNDED,
    }

    stmt = (
        select(Job)
        .options(selectinload(Job.assignments))
        .where(
            Job.customer_id == user.id,
            Job.status.not_in(terminal_statuses),
        )
        .order_by(Job.created_at.desc())
    )
    result = await db.execute(stmt)
    jobs = result.scalars().all()

    items = [MobileJobOut.model_validate(j).model_dump(by_alias=True) for j in jobs]

    return {
        "data": {
            "items": items,
            "meta": {
                "page": 1,
                "pageSize": len(items),
                "totalItems": len(items),
                "totalPages": 1,
            },
        },
    }


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/customer/{customer_id} -- Jobs by customer
# ---------------------------------------------------------------------------
# IMPORTANT: These parameterized list routes MUST be defined before
# /{job_id} so FastAPI does not interpret "customer" as a UUID.
# ---------------------------------------------------------------------------

@router.get(
    "/customer/{customer_id}",
    response_model=JobListResponse,
    summary="List jobs by customer",
    description="Returns a paginated list of jobs for a specific customer.",
)
async def list_jobs_by_customer(
    db: DBSession,
    customer_id: uuid.UUID,
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Filter by job status",
    ),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> JobListResponse:
    try:
        result = await jobService.get_jobs_by_customer(
            db,
            customer_id,
            status_filter=status_filter,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return JobListResponse(
        data=[JobBrief.model_validate(job) for job in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/provider/{provider_id} -- Jobs by provider
# ---------------------------------------------------------------------------

@router.get(
    "/provider/{provider_id}",
    response_model=JobListResponse,
    summary="List jobs by provider",
    description=(
        "Returns a paginated list of jobs assigned to a specific provider. "
        "Only includes jobs with active (non-declined/expired) assignments."
    ),
)
async def list_jobs_by_provider(
    db: DBSession,
    provider_id: uuid.UUID,
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Filter by job status",
    ),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> JobListResponse:
    try:
        result = await jobService.get_jobs_by_provider(
            db,
            provider_id,
            status_filter=status_filter,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return JobListResponse(
        data=[JobBrief.model_validate(job) for job in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id} -- Get job by ID
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}",
    response_model=JobOut,
    summary="Get job detail",
    description=(
        "Returns the full detail for a single job, including SLA snapshot, "
        "pricing, location, and schedule information."
    ),
)
async def get_job(
    db: DBSession,
    job_id: uuid.UUID,
) -> JobOut:
    job = await jobService.get_job(db, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job with id '{job_id}' not found.",
        )

    # Build enriched response with assignment and provider info
    job_data = JobOut.model_validate(job).model_dump()

    # Attach assignment and provider info for the mobile app
    assignment_data = None
    provider_data = None
    if job.assignments:
        from src.models.job import AssignmentStatus

        active_assignment = None
        for a in job.assignments:
            if a.status in (AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED):
                active_assignment = a
                break

        if active_assignment:
            assignment_data = {
                "id": str(active_assignment.id),
                "status": active_assignment.status.value,
                "offeredAt": (
                    active_assignment.offered_at.isoformat()
                    if active_assignment.offered_at
                    else None
                ),
                "respondedAt": (
                    active_assignment.responded_at.isoformat()
                    if active_assignment.responded_at
                    else None
                ),
                "slaResponseDeadline": (
                    active_assignment.sla_response_deadline.isoformat()
                    if active_assignment.sla_response_deadline
                    else None
                ),
                "slaArrivalDeadline": (
                    active_assignment.sla_arrival_deadline.isoformat()
                    if active_assignment.sla_arrival_deadline
                    else None
                ),
                "estimatedArrivalMin": active_assignment.estimated_arrival_min,
            }

            # Load provider info
            try:
                from sqlalchemy import select
                from sqlalchemy.orm import selectinload

                from src.models.provider import ProviderProfile

                prov_stmt = (
                    select(ProviderProfile)
                    .options(selectinload(ProviderProfile.user))
                    .where(ProviderProfile.id == active_assignment.provider_id)
                )
                prov_result = await db.execute(prov_stmt)
                provider = prov_result.scalar_one_or_none()

                if provider and provider.user:
                    provider_data = {
                        "id": str(provider.id),
                        "displayName": (
                            provider.user.display_name
                            or f"{provider.user.first_name} {provider.user.last_name}"
                        ),
                        "level": provider.current_level.value,
                        "avatarUrl": provider.user.avatar_url,
                    }
            except Exception:
                pass

    return {
        "data": {
            "job": job_data,
            "assignment": assignment_data,
            "provider": provider_data,
        },
    }


# ---------------------------------------------------------------------------
# PATCH /api/v1/jobs/{job_id}/status -- Update job status (internal)
# ---------------------------------------------------------------------------

@router.patch(
    "/{job_id}/status",
    response_model=JobOut,
    summary="Update job status",
    description=(
        "Transitions a job to a new status. All transitions are validated "
        "against the state machine. Invalid transitions return 409 Conflict."
    ),
)
async def update_job_status(
    db: DBSession,
    job_id: uuid.UUID,
    body: JobStatusUpdateRequest,
) -> JobOut:
    try:
        job = await jobService.update_job_status(
            db,
            job_id,
            body.new_status,
            actor_id=body.actor_id,
            actor_type=body.actor_type,
        )
    except jobService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/cancel -- Cancel a job
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/cancel",
    response_model=JobOut,
    summary="Cancel a job",
    description=(
        "Cancels a job. The cancellation type is determined by the actor_type: "
        "customer -> cancelled_by_customer, provider -> cancelled_by_provider, "
        "system/admin -> cancelled_by_system. Guards enforce that customers "
        "can only cancel before a provider is en route."
    ),
)
async def cancel_job(
    db: DBSession,
    job_id: uuid.UUID,
    body: JobCancelRequest,
) -> JobOut:
    try:
        job = await jobService.cancel_job(
            db,
            job_id,
            cancelled_by=body.cancelled_by,
            actor_type=body.actor_type,
            reason=body.reason,
        )
    except jobService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# PATCH /api/v1/jobs/{job_id}/update-status -- Mobile-friendly status update
# ---------------------------------------------------------------------------

@router.patch(
    "/{job_id}/update-status",
    summary="Update job status (mobile)",
    description=(
        "Mobile-friendly endpoint for updating a job's status. Accepts "
        "simplified status values and determines actor type from the "
        "authenticated user."
    ),
)
async def mobile_update_job_status(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: MobileJobStatusUpdateRequest,
) -> dict[str, Any]:
    # Map mobile status values to internal status and actor type
    status_map = {
        "cancelled": "cancelled_by_customer",
        "en_route": "provider_en_route",
        "arrived": "in_progress",  # Map arrived to in_progress for now
        "in_progress": "in_progress",
        "completed": "completed",
    }

    internal_status = status_map.get(body.status)
    if internal_status is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown status '{body.status}'.",
        )

    # Determine actor type from user roles
    actor_type = "customer"
    if user.role_provider:
        actor_type = "provider"
    if user.role_admin:
        actor_type = "admin"

    # Special case: cancellation
    if body.status == "cancelled":
        if actor_type == "provider":
            internal_status = "cancelled_by_provider"
        elif actor_type in ("admin", "system"):
            internal_status = "cancelled_by_system"

    try:
        job = await jobService.update_job_status(
            db,
            job_id,
            internal_status,
            actor_id=user.id,
            actor_type=actor_type,
        )
    except jobService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    job_out = MobileJobOut.model_validate(job)
    return {"data": {"job": job_out.model_dump(by_alias=True)}}


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id}/tracking -- Real-time tracking
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/tracking",
    summary="Get real-time job tracking info",
    description=(
        "Returns provider location, ETA, and current status for tracking "
        "the provider during an active job."
    ),
)
async def get_job_tracking(
    db: DBSession,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from src.services import providerService

    tracking = await providerService.get_job_tracking(db, job_id)
    result = JobTrackingOut(**tracking)
    return {"data": result.model_dump(by_alias=True)}
