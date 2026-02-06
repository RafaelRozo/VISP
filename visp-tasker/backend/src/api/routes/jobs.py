"""
Job API Routes -- VISP-BE-JOBS-002
====================================

REST endpoints for job lifecycle management.

Routes:
  POST   /api/v1/jobs                         -- Create a new job
  GET    /api/v1/jobs/{job_id}                 -- Get job by ID
  PATCH  /api/v1/jobs/{job_id}/status          -- Update job status
  POST   /api/v1/jobs/{job_id}/cancel          -- Cancel a job
  GET    /api/v1/jobs/customer/{customer_id}   -- Jobs by customer (paginated)
  GET    /api/v1/jobs/provider/{provider_id}   -- Jobs by provider (paginated)
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, Query, status

from src.api.deps import DBSession
from src.api.schemas.job import (
    JobBrief,
    JobCancelRequest,
    JobCreateRequest,
    JobListResponse,
    JobOut,
    JobStatusUpdateRequest,
    PaginationMeta,
)
from src.core.config import settings
from src.services import jobService

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

    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# PATCH /api/v1/jobs/{job_id}/status -- Update job status
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
