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
    import traceback as tb_mod
    try:
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

            # Update the job with the quoted price (midpoint of range = same as customer estimate)
            midpoint_cents = (estimate.final_price_min_cents + estimate.final_price_max_cents) // 2
            job.quoted_price_cents = midpoint_cents
            job.commission_rate = estimate.commission_rate_default
            job.commission_amount_cents = int(
                Decimal(str(midpoint_cents))
                * estimate.commission_rate_default
            )
            job.provider_payout_cents = (
                midpoint_cents - job.commission_amount_cents
            )
            await db.flush()
        except Exception as exc:
            logger.warning("Price estimation failed for job %s: %s", job.id, exc)

        # Broadcast OFFERED assignments to ALL qualified providers.
        # The job stays in PENDING_MATCH — it only transitions when a
        # provider manually accepts the offer.
        try:
            from src.services.matchingEngine import find_matching_providers
            from src.models.job import JobAssignment, AssignmentStatus
            from datetime import timedelta

            match_result = await find_matching_providers(db, job, max_results=20)
            now_utc = datetime.now(timezone.utc)
            for m in match_result.get("matches", []):
                # Create OFFERED assignment for each qualified provider
                sla_response_deadline = None
                if job.sla_response_time_min:
                    sla_response_deadline = now_utc + timedelta(
                        minutes=job.sla_response_time_min
                    )
                offer = JobAssignment(
                    job_id=job.id,
                    provider_id=m["provider_id"],
                    status=AssignmentStatus.OFFERED,
                    offered_at=now_utc,
                    match_score=Decimal(str(m["composite_score"])),
                    sla_response_deadline=sla_response_deadline,
                )
                db.add(offer)
            await db.flush()
            logger.info(
                "Broadcast %d offers for job %s",
                len(match_result.get("matches", [])),
                job.id,
            )
        except Exception as exc:
            logger.warning("Offer broadcast failed for job %s: %s", job.id, exc)

        # Build mobile-friendly response
        try:
            job_out = MobileJobOut.model_validate(job)
            response = JobCreateResponse(
                job=job_out,
                estimated_price=estimated_price,
            )
            return {"data": response.model_dump(by_alias=True)}
        except Exception as exc:
            logger.error(
                "Failed to serialise job %s for mobile response: %s",
                job.id,
                exc,
                exc_info=True,
            )
            # Return a minimal success response so the mobile client can navigate
            return {
                "data": {
                    "job": {"id": str(job.id)},
                    "estimatedPrice": {
                        "minCents": estimated_price.min_cents,
                        "maxCents": estimated_price.max_cents,
                        "currency": "CAD",
                        "isEmergency": body.is_emergency,
                        "dynamicMultiplier": None,
                    },
                }
            }

    except HTTPException:
        raise  # Let FastAPI handle HTTP exceptions normally

    except Exception as exc:
        # Catch-all: return the Python error in the response detail
        error_tb = tb_mod.format_exc()
        logger.error("book_job UNHANDLED ERROR: %s\n%s", exc, error_tb)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"book_job crashed: {type(exc).__name__}: {exc}",
        )


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
    from src.models.taxonomy import ServiceTask

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

    # Build task name cache
    task_ids = {j.task_id for j in jobs if j.task_id}
    task_map: dict = {}
    if task_ids:
        task_stmt = (
            select(ServiceTask)
            .options(selectinload(ServiceTask.category))
            .where(ServiceTask.id.in_(task_ids))
        )
        tasks = (await db.execute(task_stmt)).scalars().all()
        for t in tasks:
            task_map[t.id] = {
                "name": t.name,
                "categoryName": t.category.name if t.category else None,
            }

    from src.api.routes.providers import _mobile_status

    items = []
    for j in jobs:
        item = MobileJobOut.model_validate(j).model_dump(by_alias=True)
        # Convert backend enum (UPPERCASE) to mobile-friendly lowercase
        item["status"] = _mobile_status(j.status.value)
        task_info = task_map.get(j.task_id, {})
        item["taskName"] = task_info.get("name", j.reference_number)
        item["categoryName"] = task_info.get("categoryName")
        items.append(item)

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
    summary="Get job detail",
    description=(
        "Returns the full detail for a single job, including SLA snapshot, "
        "pricing, location, and schedule information."
    ),
)
async def get_job(
    db: DBSession,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    job = await jobService.get_job(db, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job with id '{job_id}' not found.",
        )

    # Build enriched response with assignment and provider info
    from src.api.routes.providers import _mobile_status

    try:
        job_data = JobOut.model_validate(job).model_dump()
        # Convert UPPERCASE enum to mobile-friendly lowercase
        job_data["status"] = _mobile_status(job.status.value)
    except Exception:
        # Fallback: manually construct the dict if Pydantic validation fails
        job_data = {
            "id": str(job.id),
            "reference_number": job.reference_number,
            "customer_id": str(job.customer_id),
            "task_id": str(job.task_id),
            "status": _mobile_status(
                job.status.value if hasattr(job.status, 'value') else str(job.status)
            ),
            "priority": job.priority.value if hasattr(job.priority, 'value') else str(job.priority),
            "is_emergency": job.is_emergency,
            "service_latitude": str(job.service_latitude),
            "service_longitude": str(job.service_longitude),
            "service_address": job.service_address,
            "service_unit": job.service_unit,
            "service_city": job.service_city,
            "service_province_state": job.service_province_state,
            "service_postal_zip": job.service_postal_zip,
            "service_country": job.service_country,
            "requested_date": str(job.requested_date) if job.requested_date else None,
            "requested_time_start": str(job.requested_time_start) if job.requested_time_start else None,
            "requested_time_end": str(job.requested_time_end) if job.requested_time_end else None,
            "flexible_schedule": job.flexible_schedule,
            "quoted_price_cents": job.quoted_price_cents,
            "final_price_cents": job.final_price_cents,
            "currency": job.currency,
            "customer_notes_json": job.customer_notes_json or [],
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "cancelled_at": job.cancelled_at.isoformat() if job.cancelled_at else None,
            "cancellation_reason": job.cancellation_reason,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        }

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
                        "phone": provider.user.phone,
                        "rating": float(provider.average_rating) if provider.average_rating else None,
                        "completedJobs": provider.total_completed_jobs or 0,
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
    from src.api.routes.providers import _mobile_status
    from src.services import providerService

    tracking = await providerService.get_job_tracking(db, job_id)
    tracking["status"] = _mobile_status(tracking["status"])
    result = JobTrackingOut(**tracking)
    return {"data": result.model_dump(by_alias=True)}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/provider-location -- Update provider location
# ---------------------------------------------------------------------------

@router.post(
    "/provider-location",
    summary="Update provider location",
    description=(
        "Called by the partner app to update the provider's current GPS "
        "coordinates. This data is consumed by the customer tracking screen."
    ),
)
async def update_provider_location(
    db: DBSession,
    user: CurrentUser,
    body: dict[str, Any],
) -> dict[str, Any]:
    from src.services import providerService

    lat = body.get("latitude")
    lng = body.get("longitude")
    if lat is None or lng is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="latitude and longitude are required",
        )

    await providerService.update_provider_location(
        db, user.id, float(lat), float(lng)
    )
    await db.commit()
    return {"data": {"ok": True}}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/approve-provider -- Customer approves provider
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/approve-provider",
    summary="Customer approves the assigned provider",
    description=(
        "After a provider accepts an offer, the customer reviews and "
        "approves them. Job transitions from PENDING_APPROVAL to SCHEDULED."
    ),
)
async def approve_provider(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus

    # Load job
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Job is in {job.status.value}, expected pending_approval",
        )

    # Transition to SCHEDULED
    job.status = JobStatus.SCHEDULED

    await db.commit()
    return {"data": {"ok": True, "status": "scheduled"}}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/reject-provider -- Customer rejects provider
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/reject-provider",
    summary="Customer rejects the assigned provider",
    description=(
        "Customer rejects the provider. The assignment is reverted, and "
        "the job goes back to MATCHED status for re-matching."
    ),
)
async def reject_provider(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus

    # Load job
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=400,
            detail=f"Job is in {job.status.value}, expected pending_approval",
        )

    # Find the accepted assignment and revert it
    asgn_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status == AssignmentStatus.ACCEPTED,
    )
    assignment = (await db.execute(asgn_stmt)).scalar_one_or_none()
    if assignment:
        assignment.status = AssignmentStatus.DECLINED
        assignment.responded_at = datetime.now(timezone.utc)

    # Back to MATCHED for re-matching
    job.status = JobStatus.MATCHED

    await db.commit()
    return {"data": {"ok": True, "status": "matched"}}


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id}/pending-provider  -- Provider info for approval
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/pending-provider",
    summary="Get provider info for customer approval",
    description=(
        "Returns the provider's public info for the customer to review "
        "before approving or rejecting."
    ),
)
async def get_pending_provider(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus
    from src.models.provider import ProviderProfile
    from src.models.user import User

    # Load job (must be owned by customer)
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.PENDING_APPROVAL:
        return {"data": None}

    # Find accepted assignment
    asgn_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status == AssignmentStatus.ACCEPTED,
    )
    assignment = (await db.execute(asgn_stmt)).scalar_one_or_none()
    if assignment is None:
        return {"data": None}

    # Load provider profile + user
    prov_stmt = (
        select(ProviderProfile)
        .options(selectinload(ProviderProfile.user))
        .where(ProviderProfile.id == assignment.provider_id)
    )
    provider = (await db.execute(prov_stmt)).scalar_one_or_none()
    if provider is None:
        return {"data": None}

    user_record = provider.user

    # Compute avg rating from reviews
    from src.models.review import Review as _Review
    from sqlalchemy import func as _func
    _avg_stmt = select(_func.avg(_Review.overall_rating)).where(
        _Review.reviewee_id == provider.user_id
    )
    _avg_raw = (await db.execute(_avg_stmt)).scalar()
    _prov_rating = round(float(_avg_raw), 2) if _avg_raw else None

    return {"data": {
        "providerId": str(provider.id),
        "displayName": (
            user_record.display_name
            or f"{user_record.first_name} {user_record.last_name}"
            if user_record else "Unknown"
        ),
        "level": int(provider.current_level.value) if provider.current_level else 1,
        "yearsExperience": provider.years_experience,
        "rating": _prov_rating,
        "profilePhotoUrl": user_record.avatar_url if user_record else None,
        "bio": provider.bio,
    }}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/approve-provider  -- Customer approves provider
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/approve-provider",
    summary="Approve the matched provider",
    description=(
        "Customer approves the provider. Transitions job to PROVIDER_ACCEPTED "
        "so the provider can begin traveling to the service location."
    ),
)
async def approve_provider(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus

    # Must be owned by this customer
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not pending approval (current: {job.status.value})",
        )

    # Transition job to PROVIDER_ACCEPTED
    job.status = JobStatus.PROVIDER_ACCEPTED

    await db.commit()
    logger.info("Customer %s approved provider for job %s", user.id, job_id)

    return {"data": {"ok": True, "status": job.status.value}}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/reject-provider  -- Customer rejects provider
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/reject-provider",
    summary="Reject the matched provider",
    description=(
        "Customer rejects the provider. The job goes back to PENDING_MATCH "
        "and the assignment is marked DECLINED so matching can retry."
    ),
)
async def reject_provider(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus

    # Must be owned by this customer
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.PENDING_APPROVAL:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not pending approval (current: {job.status.value})",
        )

    # Mark the accepted assignment as DECLINED
    asgn_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status == AssignmentStatus.ACCEPTED,
    )
    assignment = (await db.execute(asgn_stmt)).scalar_one_or_none()
    if assignment:
        assignment.status = AssignmentStatus.DECLINED

    # Send job back to PENDING_MATCH for re-matching
    job.status = JobStatus.PENDING_MATCH

    await db.commit()
    logger.info("Customer %s rejected provider for job %s", user.id, job_id)

    return {"data": {"ok": True, "status": job.status.value}}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/rating  -- Customer submits job rating
# ---------------------------------------------------------------------------

from pydantic import BaseModel as _BaseModel, Field as _Field

class RatingSubmitRequest(_BaseModel):
    rating: int = _Field(ge=1, le=5, description="Star rating 1-5")
    tags: list[str] = _Field(default_factory=list, description="Feedback tag IDs")
    feedback: Optional[str] = _Field(default=None, description="Optional text feedback")


@router.post(
    "/{job_id}/rating",
    summary="Submit a job rating",
    description=(
        "Customer submits a star rating, optional feedback tags, and optional "
        "text feedback for a completed job. Creates a Review record with the "
        "customer as reviewer and the assigned provider as reviewee."
    ),
)
async def submit_job_rating(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: RatingSubmitRequest,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus
    from src.models.review import Review, ReviewStatus, ReviewerRole
    from src.models.provider import ProviderProfile

    # 1. Load job -- must belong to this customer and be completed
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not completed (current: {job.status.value})",
        )

    # 2. Check for duplicate review
    existing_review_stmt = select(Review).where(
        Review.job_id == job_id,
        Review.reviewer_id == user.id,
    )
    existing = (await db.execute(existing_review_stmt)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="You have already rated this job",
        )

    # 3. Find the assigned provider's user_id
    assignment_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status == AssignmentStatus.COMPLETED,
    )
    assignment = (await db.execute(assignment_stmt)).scalar_one_or_none()
    if assignment is None:
        # Fallback: try accepted assignment
        assignment_stmt2 = select(JobAssignment).where(
            JobAssignment.job_id == job_id,
            JobAssignment.status == AssignmentStatus.ACCEPTED,
        )
        assignment = (await db.execute(assignment_stmt2)).scalar_one_or_none()

    if assignment is None:
        raise HTTPException(
            status_code=404,
            detail="No provider assignment found for this job",
        )

    # Get provider's user_id from ProviderProfile
    provider_stmt = select(ProviderProfile).where(
        ProviderProfile.id == assignment.provider_id,
    )
    provider = (await db.execute(provider_stmt)).scalar_one_or_none()
    if provider is None:
        raise HTTPException(
            status_code=404,
            detail="Provider profile not found",
        )

    reviewee_user_id = provider.user_id

    # 4. Build tags as comma-separated comment prefix
    tags_text = ", ".join(body.tags) if body.tags else ""
    comment_parts = []
    if tags_text:
        comment_parts.append(f"[Tags: {tags_text}]")
    if body.feedback:
        comment_parts.append(body.feedback)
    comment = " ".join(comment_parts) if comment_parts else None

    # 5. Create the Review
    review = Review(
        job_id=job_id,
        reviewer_id=user.id,
        reviewee_id=reviewee_user_id,
        reviewer_role=ReviewerRole.CUSTOMER,
        overall_rating=Decimal(str(body.rating)),
        comment=comment,
        status=ReviewStatus.PUBLISHED,
    )
    db.add(review)
    await db.flush()

    logger.info(
        "Customer %s rated job %s with %d stars",
        user.id, job_id, body.rating,
    )

    await db.commit()

    return {"data": {
        "reviewId": str(review.id),
        "rating": body.rating,
        "tags": body.tags,
        "feedback": body.feedback,
        "message": "Rating submitted successfully",
    }}
