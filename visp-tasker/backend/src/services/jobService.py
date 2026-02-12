"""
Job Service -- VISP-BE-JOBS-002
================================

Business logic for job lifecycle management. All operations use async
SQLAlchemy sessions and enforce business rules including:

  - Closed task catalog (no free text -- task_id must reference service_tasks)
  - SLA snapshot immutability (copied from sla_profiles at creation time)
  - State machine enforcement via jobStateManager
  - Event emission on every state change

Key functions:
  - create_job        -- create with SLA snapshot
  - update_job_status -- state machine transition
  - cancel_job        -- cancellation with actor enforcement
  - get_job           -- single job retrieval
  - get_jobs_by_customer / get_jobs_by_provider -- paginated lists
  - generate_reference_number -- TSK-XXXXXX format
"""

from __future__ import annotations

import logging
import math
import random
import string
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timezone
from decimal import Decimal
from typing import Any, Optional, Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.events.jobEvents import (
    emit_job_cancelled,
    emit_job_completed,
    emit_job_created,
    emit_job_status_changed,
    emit_sla_snapshot_captured,
)
from src.models.job import Job, JobPriority, JobStatus
from src.models.sla import SLAProfile
from src.models.taxonomy import ServiceTask
from src.services.jobStateManager import ActorType, validate_transition

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Pagination helper (same pattern as taxonomy_service)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PaginatedResult:
    """Generic container for a page of results plus metadata."""

    items: Sequence
    total_items: int
    page: int
    page_size: int

    @property
    def total_pages(self) -> int:
        if self.total_items == 0:
            return 0
        return math.ceil(self.total_items / self.page_size)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class JobNotFoundError(Exception):
    """Raised when a job cannot be found by ID."""

    def __init__(self, job_id: uuid.UUID) -> None:
        self.job_id = job_id
        super().__init__(f"Job with id '{job_id}' not found.")


class TaskNotFoundError(Exception):
    """Raised when a task cannot be found by ID."""

    def __init__(self, task_id: uuid.UUID) -> None:
        self.task_id = task_id
        super().__init__(f"Task with id '{task_id}' not found.")


class InvalidTransitionError(Exception):
    """Raised when a job status transition is not allowed."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


# ---------------------------------------------------------------------------
# Reference number generation
# ---------------------------------------------------------------------------

def generate_reference_number() -> str:
    """Generate a human-readable reference number in TSK-XXXXXX format.

    Uses uppercase letters and digits for readability. Collision avoidance
    is handled at the database level via a unique constraint; callers should
    retry on IntegrityError.
    """
    chars = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(chars, k=6))
    return f"TSK-{suffix}"


# ---------------------------------------------------------------------------
# SLA snapshot capture
# ---------------------------------------------------------------------------

async def _capture_sla_snapshot(
    db: AsyncSession,
    task: ServiceTask,
    *,
    service_country: str = "CA",
    service_province_state: Optional[str] = None,
    service_city: Optional[str] = None,
) -> dict[str, Any]:
    """Find the best-matching SLA profile for a task and capture a snapshot.

    SLA profile matching priority (highest wins):
    1. Task-specific + most granular region match
    2. Level-wide + most granular region match
    3. Fallback to country-level default

    Returns a dict with the snapshot data, plus ``sla_profile_id`` if a
    profile was found.
    """
    # Build filter: active profiles matching the task's level
    today = date.today()
    filters = [
        SLAProfile.level == task.level,
        SLAProfile.is_active.is_(True),
        SLAProfile.effective_from <= today,
        or_(
            SLAProfile.effective_until.is_(None),
            SLAProfile.effective_until >= today,
        ),
        SLAProfile.country == service_country,
    ]

    stmt = (
        select(SLAProfile)
        .where(*filters)
        .order_by(
            # Prefer task-specific over level-wide
            SLAProfile.task_id == task.id,  # True sorts after False in PG, so desc
            SLAProfile.priority_order.desc(),
        )
    )

    result = await db.execute(stmt)
    profiles = result.scalars().all()

    if not profiles:
        logger.warning(
            "No SLA profile found for task %s (level=%s, country=%s). "
            "Job will be created without SLA targets.",
            task.id,
            task.level.value,
            service_country,
        )
        return {
            "sla_profile_id": None,
            "response_time_min": None,
            "arrival_time_min": None,
            "completion_time_min": None,
            "penalty_enabled": False,
            "penalty_per_min_cents": None,
            "penalty_cap_cents": None,
            "profile_name": None,
            "level": task.level.value,
            "region_value": None,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }

    # Pick the best match: prefer task-specific, then highest priority
    best: SLAProfile | None = None
    for profile in profiles:
        # Task-specific profiles always win
        if profile.task_id == task.id:
            if best is None or best.task_id != task.id:
                best = profile
            elif profile.priority_order > best.priority_order:
                best = profile
        elif best is None or best.task_id != task.id:
            if best is None or profile.priority_order > best.priority_order:
                best = profile

    if best is None:
        best = profiles[0]

    snapshot = {
        "sla_profile_id": str(best.id),
        "response_time_min": best.response_time_min,
        "arrival_time_min": best.arrival_time_min,
        "completion_time_min": best.completion_time_min,
        "penalty_enabled": best.penalty_enabled,
        "penalty_per_min_cents": best.penalty_per_min_cents,
        "penalty_cap_cents": best.penalty_cap_cents,
        "profile_name": best.name,
        "level": best.level.value,
        "region_value": best.region_value,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }

    return snapshot


# ---------------------------------------------------------------------------
# Job CRUD operations
# ---------------------------------------------------------------------------

async def create_job(
    db: AsyncSession,
    *,
    customer_id: uuid.UUID,
    task_id: uuid.UUID,
    location: dict[str, Any],
    schedule: dict[str, Any] | None = None,
    priority: str = "standard",
    is_emergency: bool = False,
    customer_notes_json: list[str] | None = None,
) -> Job:
    """Create a new job with SLA snapshot from sla_profiles.

    CRITICAL BUSINESS RULE: The SLA response_minutes and arrival_minutes
    are copied from sla_profiles into the job record at creation time.
    These values are IMMUTABLE after creation.

    Args:
        db: Async database session.
        customer_id: UUID of the customer creating the job.
        task_id: UUID of the task from the closed catalog.
        location: Dict with lat, lon, address, city, etc.
        schedule: Optional dict with requested_date, time_start, time_end.
        priority: Job priority (standard, priority, urgent, emergency).
        is_emergency: Whether this is an emergency job.
        customer_notes_json: List of predefined note selections.

    Returns:
        The newly created Job ORM instance.

    Raises:
        TaskNotFoundError: If the task_id does not exist in the catalog.
    """
    # 1. Validate task exists in the closed catalog
    task_stmt = select(ServiceTask).where(
        ServiceTask.id == task_id,
        ServiceTask.is_active.is_(True),
    )
    task_result = await db.execute(task_stmt)
    task = task_result.scalar_one_or_none()

    if task is None:
        raise TaskNotFoundError(task_id)

    # 2. Capture SLA snapshot (IMMUTABLE after this point)
    sla_snapshot = await _capture_sla_snapshot(
        db,
        task,
        service_country=location.get("country", "CA"),
        service_province_state=location.get("province_state"),
        service_city=location.get("city"),
    )

    sla_profile_id = (
        uuid.UUID(sla_snapshot["sla_profile_id"])
        if sla_snapshot.get("sla_profile_id")
        else None
    )

    # 3. Generate unique reference number
    reference_number = generate_reference_number()

    # 4. Build the job record
    job = Job(
        reference_number=reference_number,
        customer_id=customer_id,
        task_id=task_id,
        status=JobStatus.DRAFT,
        priority=JobPriority(priority),
        is_emergency=is_emergency,
        # Location
        service_latitude=Decimal(str(location["latitude"])),
        service_longitude=Decimal(str(location["longitude"])),
        service_address=location["address"],
        service_unit=location.get("unit"),
        service_city=location.get("city"),
        service_province_state=location.get("province_state"),
        service_postal_zip=location.get("postal_zip"),
        service_country=location.get("country", "CA"),
        # SLA snapshot (IMMUTABLE)
        sla_response_time_min=sla_snapshot.get("response_time_min"),
        sla_arrival_time_min=sla_snapshot.get("arrival_time_min"),
        sla_completion_time_min=sla_snapshot.get("completion_time_min"),
        sla_profile_id=sla_profile_id,
        sla_snapshot_json=sla_snapshot,
        # Notes
        customer_notes_json=customer_notes_json or [],
    )

    # 5. Apply schedule if provided
    if schedule:
        job.requested_date = schedule.get("requested_date")
        job.requested_time_start = schedule.get("requested_time_start")
        job.requested_time_end = schedule.get("requested_time_end")
        job.flexible_schedule = schedule.get("flexible_schedule", False)

    db.add(job)
    await db.flush()

    # 6. Emit events
    emit_job_created(
        job_id=job.id,
        customer_id=customer_id,
        task_id=task_id,
        reference_number=reference_number,
    )
    emit_sla_snapshot_captured(
        job_id=job.id,
        sla_profile_id=sla_profile_id,
        snapshot=sla_snapshot,
    )

    logger.info(
        "Job created: %s (ref=%s, task=%s, level=%s, emergency=%s)",
        job.id,
        reference_number,
        task.slug,
        task.level.value,
        is_emergency,
    )

    return job


async def update_job_status(
    db: AsyncSession,
    job_id: uuid.UUID,
    new_status: str,
    *,
    actor_id: uuid.UUID | None = None,
    actor_type: str = "system",
) -> Job:
    """Transition a job to a new status using the state machine.

    All transitions are validated through the jobStateManager. Invalid
    transitions raise an InvalidTransitionError.

    Args:
        db: Async database session.
        job_id: UUID of the job to update.
        new_status: Target status string.
        actor_id: UUID of the actor performing the transition.
        actor_type: Type of actor (customer, provider, system, admin).

    Returns:
        The updated Job ORM instance.

    Raises:
        JobNotFoundError: If the job does not exist.
        InvalidTransitionError: If the transition is not allowed.
    """
    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if job is None:
        raise JobNotFoundError(job_id)

    old_status = job.status
    target_status = JobStatus(new_status)
    actor = ActorType(actor_type)

    # Validate transition through state machine
    transition_result = validate_transition(old_status, target_status, actor)
    if not transition_result.allowed:
        raise InvalidTransitionError(transition_result.reason or "Transition not allowed.")

    # Apply the transition
    job.status = target_status
    now = datetime.now(timezone.utc)

    # Set lifecycle timestamps based on the new status
    if target_status == JobStatus.IN_PROGRESS:
        job.started_at = now
    elif target_status == JobStatus.COMPLETED:
        job.completed_at = now

    await db.flush()

    # Emit status change event
    emit_job_status_changed(
        job_id=job.id,
        old_status=old_status.value,
        new_status=target_status.value,
        actor_id=actor_id,
    )

    # Emit completion event if applicable
    if target_status == JobStatus.COMPLETED:
        emit_job_completed(job_id=job.id)

    logger.info(
        "Job %s transitioned: %s -> %s (actor=%s, type=%s)",
        job.id,
        old_status.value,
        target_status.value,
        actor_id,
        actor_type,
    )

    return job


async def cancel_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    cancelled_by: uuid.UUID,
    actor_type: str = "customer",
    reason: str | None = None,
) -> Job:
    """Cancel a job with the appropriate cancellation status.

    The cancellation status is determined by the actor_type:
      - customer -> cancelled_by_customer
      - provider -> cancelled_by_provider
      - system/admin -> cancelled_by_system

    Args:
        db: Async database session.
        job_id: UUID of the job to cancel.
        cancelled_by: UUID of the user cancelling the job.
        actor_type: Type of actor (customer, provider, system, admin).
        reason: Optional cancellation reason.

    Returns:
        The cancelled Job ORM instance.

    Raises:
        JobNotFoundError: If the job does not exist.
        InvalidTransitionError: If cancellation is not allowed.
    """
    # Determine target cancellation status
    cancel_status_map = {
        "customer": JobStatus.CANCELLED_BY_CUSTOMER,
        "provider": JobStatus.CANCELLED_BY_PROVIDER,
        "system": JobStatus.CANCELLED_BY_SYSTEM,
        "admin": JobStatus.CANCELLED_BY_SYSTEM,
    }
    target_status = cancel_status_map.get(actor_type, JobStatus.CANCELLED_BY_SYSTEM)

    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if job is None:
        raise JobNotFoundError(job_id)

    old_status = job.status
    actor = ActorType(actor_type)

    # Validate through state machine
    transition_result = validate_transition(old_status, target_status, actor)
    if not transition_result.allowed:
        raise InvalidTransitionError(transition_result.reason or "Cancellation not allowed.")

    # Apply cancellation
    job.status = target_status
    job.cancelled_at = datetime.now(timezone.utc)
    job.cancellation_reason = reason

    await db.flush()

    # Emit events
    emit_job_status_changed(
        job_id=job.id,
        old_status=old_status.value,
        new_status=target_status.value,
        actor_id=cancelled_by,
    )
    emit_job_cancelled(
        job_id=job.id,
        cancelled_by=cancelled_by,
        reason=reason,
    )

    logger.info(
        "Job %s cancelled: %s -> %s by %s (reason=%s)",
        job.id,
        old_status.value,
        target_status.value,
        cancelled_by,
        reason,
    )

    return job


async def get_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job | None:
    """Fetch a single job by primary key with assignments eagerly loaded.

    Returns None if the job is not found.
    """
    stmt = (
        select(Job)
        .options(selectinload(Job.assignments))
        .where(Job.id == job_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_jobs_by_customer(
    db: AsyncSession,
    customer_id: uuid.UUID,
    *,
    status_filter: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> PaginatedResult:
    """Return a paginated list of jobs for a specific customer.

    Optionally filtered by status.
    """
    filters = [Job.customer_id == customer_id]
    if status_filter:
        filters.append(Job.status == JobStatus(status_filter))

    # Count
    count_stmt = select(func.count(Job.id)).where(*filters)
    total_items: int = (await db.execute(count_stmt)).scalar_one()

    # Data
    data_stmt = (
        select(Job)
        .where(*filters)
        .order_by(Job.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    jobs = (await db.execute(data_stmt)).scalars().all()

    return PaginatedResult(
        items=jobs,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


    return PaginatedResult(
        items=jobs,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


async def queue_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job:
    """Transition a job to PENDING and broadcast it to nearby qualified providers.

    1. Update status to PENDING (if not already).
    2. Find active providers who are qualified for this task.
    3. Filter by distance (job location vs provider home + radius).
    4. Create JobAssignment (OFFERED) for each match.
    """
    from src.models.provider import (
        ProviderProfile,
        ProviderProfileStatus,
    )
    from src.models.taxonomy import ProviderTaskQualification
    from src.models.job import JobAssignment, AssignmentStatus
    from src.services.geoService import haversine_distance

    # 1. Fetch job
    job = await get_job(db, job_id)
    if not job:
        raise JobNotFoundError(job_id)

    # 1b. Update status to PENDING if currently DRAFT or PENDING_MATCH
    # If already PENDING, we just re-broadcast
    if job.status in [JobStatus.DRAFT, JobStatus.PENDING_MATCH]:
        job = await update_job_status(db, job.id, JobStatus.PENDING, actor_type="system")

    # 2. Find qualified providers
    # query: Active profiles + Qualified for task
    stmt = (
        select(ProviderProfile)
        .join(ProviderTaskQualification)
        .where(
            ProviderProfile.status == ProviderProfileStatus.ACTIVE,
            ProviderTaskQualification.task_id == job.task_id,
            ProviderTaskQualification.qualified.is_(True),
        )
    )
    result = await db.execute(stmt)
    candidates = result.scalars().all()

    # 3. Filter by location & Create Assignments
    assignments_created = 0
    
    # We might want to check if assignment already exists to avoid duplicates
    existing_assign_stmt = (
        select(JobAssignment.provider_id)
        .where(JobAssignment.job_id == job.id)
    )
    existing_provider_ids = (await db.execute(existing_assign_stmt)).scalars().all()
    existing_set = set(existing_provider_ids)

    for provider in candidates:
        if provider.id in existing_set:
            continue
            
        # Location check
        # If provider has no location, skip (or default to allow? skip for now)
        if provider.home_latitude is None or provider.home_longitude is None:
            continue

        dist_km = haversine_distance(
            float(job.service_latitude),
            float(job.service_longitude),
            float(provider.home_latitude),
            float(provider.home_longitude),
        )

        # check if job is within provider's radius
        if dist_km <= float(provider.service_radius_km):
            # Create assignment
            assignment = JobAssignment(
                job_id=job.id,
                provider_id=provider.id,
                status=AssignmentStatus.OFFERED,
                offered_at=datetime.now(timezone.utc),
                # Expires in 30 mins or custom time?
                offer_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30), 
            )
            db.add(assignment)
            assignments_created += 1

    await db.commit()
    logger.info(f"Queued job {job.id}: Broadcasted to {assignments_created} providers.")
    
    return job
