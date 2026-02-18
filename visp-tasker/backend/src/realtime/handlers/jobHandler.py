"""
Job Event Handler -- VISP-INT-REALTIME-004
===========================================

WebSocket handler for job lifecycle events on the ``/jobs`` namespace.
Processes events received from clients (provider actions like accepting,
declining, marking en route, etc.) and emits events to job rooms when
state changes occur.

Architecture:
  - Incoming events from providers trigger state machine transitions
    via ``jobStateManager.validate_transition``
  - Database mutations are performed inside an async session scope
  - After a successful transition, events are broadcast to the job room
    so both customer and provider UIs update in real time
  - Permission checks ensure only the assigned provider or the job's
    customer can trigger transitions

Events emitted TO clients:
  job:new_offer, job:accepted, job:provider_en_route, job:provider_arrived,
  job:in_progress, job:completed, job:cancelled, job:sla_warning,
  job:status_changed

Events received FROM clients:
  job:accept_offer, job:decline_offer, job:mark_en_route,
  job:mark_arrived, job:mark_started, job:mark_completed
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

from sqlalchemy import select
from sqlalchemy.orm import selectinload

from src.api.deps import async_session_factory
from src.models.job import (
    AssignmentStatus,
    Job,
    JobAssignment,
    JobStatus,
)
from src.services.jobStateManager import ActorType, validate_transition
from src.services import notificationService

from ..socketServer import (
    broadcast_to_job,
    get_sid_meta,
    send_to_user,
    sio,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Permission helpers
# ---------------------------------------------------------------------------

def _extract_user_id(sid: str) -> str | None:
    """Extract user_id from the connection registry for the given sid."""
    meta = get_sid_meta(sid)
    return meta.get("user_id") if meta else None


def _extract_role(sid: str) -> str | None:
    """Extract role from the connection registry for the given sid."""
    meta = get_sid_meta(sid)
    return meta.get("role") if meta else None


async def _get_active_assignment(
    job: Job,
    provider_user_id: str,
) -> JobAssignment | None:
    """Find the active assignment for a provider on this job.

    Walks the eagerly-loaded assignments list (expected to be short).
    Returns the assignment with status OFFERED or ACCEPTED, or None.
    """
    for assignment in job.assignments:
        if (
            str(assignment.provider.user_id) == provider_user_id
            and assignment.status in (AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED)
        ):
            return assignment
    return None


async def _verify_provider_permission(
    job: Job,
    sid: str,
) -> tuple[bool, str | None, JobAssignment | None]:
    """Verify the caller is the assigned provider for this job.

    Returns (allowed, error_message, assignment).
    """
    user_id = _extract_user_id(sid)
    role = _extract_role(sid)

    if not user_id:
        return False, "Not authenticated", None
    if role != "provider":
        return False, "Only providers can perform this action", None

    assignment = await _get_active_assignment(job, user_id)
    if assignment is None:
        return False, "You are not assigned to this job", None

    return True, None, assignment


async def _verify_job_participant(
    job: Job,
    sid: str,
) -> tuple[bool, str | None]:
    """Verify the caller is either the customer or the assigned provider."""
    user_id = _extract_user_id(sid)
    if not user_id:
        return False, "Not authenticated"

    # Customer check
    if str(job.customer_id) == user_id:
        return True, None

    # Provider check
    for assignment in job.assignments:
        if (
            str(assignment.provider.user_id) == user_id
            and assignment.status in (AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED)
        ):
            return True, None

    return False, "You are not a participant in this job"


# ---------------------------------------------------------------------------
# Database helpers
# ---------------------------------------------------------------------------

async def _load_job_with_assignments(job_id: str) -> Job | None:
    """Load a job with its assignments and provider profiles eagerly loaded."""
    async with async_session_factory() as db:
        stmt = (
            select(Job)
            .options(
                selectinload(Job.assignments).selectinload(JobAssignment.provider),
            )
            .where(Job.id == uuid.UUID(job_id))
        )
        result = await db.execute(stmt)
        return result.scalar_one_or_none()


# ---------------------------------------------------------------------------
# Outbound event emitters (called by services or internal logic)
# ---------------------------------------------------------------------------

async def emit_new_offer(
    job_id: str,
    provider_user_id: str,
    *,
    task_name: str,
    customer_lat: float,
    customer_lng: float,
    sla_deadline: str | None,
    quoted_price_cents: int | None,
) -> None:
    """Emit a new job offer to a specific provider."""
    await send_to_user(
        user_id=provider_user_id,
        event="job:new_offer",
        data={
            "job_id": job_id,
            "task_name": task_name,
            "customer_location": {"lat": customer_lat, "lng": customer_lng},
            "sla_deadline": sla_deadline,
            "quoted_price_cents": quoted_price_cents,
            "offered_at": datetime.now(timezone.utc).isoformat(),
        },
        role="provider",
    )
    logger.info("Emitted job:new_offer for job=%s to provider=%s", job_id, provider_user_id)


async def emit_job_accepted(
    job_id: str,
    *,
    provider_name: str,
    provider_photo: str | None,
    eta_minutes: int | None,
) -> None:
    """Emit acceptance notification to the job room (customer sees this)."""
    await broadcast_to_job(
        job_id,
        "job:accepted",
        {
            "job_id": job_id,
            "provider_name": provider_name,
            "provider_photo": provider_photo,
            "eta_minutes": eta_minutes,
            "accepted_at": datetime.now(timezone.utc).isoformat(),
        },
    )


async def emit_provider_en_route(
    job_id: str,
    *,
    provider_lat: float,
    provider_lng: float,
    eta_minutes: int | None,
) -> None:
    """Emit provider en-route notification to the job room."""
    await broadcast_to_job(
        job_id,
        "job:provider_en_route",
        {
            "job_id": job_id,
            "provider_location": {"lat": provider_lat, "lng": provider_lng},
            "eta_minutes": eta_minutes,
            "en_route_at": datetime.now(timezone.utc).isoformat(),
        },
    )


async def emit_provider_arrived(job_id: str) -> None:
    """Emit provider arrival notification to the job room."""
    await broadcast_to_job(
        job_id,
        "job:provider_arrived",
        {
            "job_id": job_id,
            "arrived_at": datetime.now(timezone.utc).isoformat(),
        },
    )


async def emit_job_in_progress(job_id: str, started_at: str) -> None:
    """Emit in-progress notification to the job room."""
    await broadcast_to_job(
        job_id,
        "job:in_progress",
        {
            "job_id": job_id,
            "started_at": started_at,
        },
    )


async def emit_job_completed(
    job_id: str,
    *,
    final_price_cents: int | None,
    completion_time: str,
) -> None:
    """Emit completion notification to the job room."""
    await broadcast_to_job(
        job_id,
        "job:completed",
        {
            "job_id": job_id,
            "final_price_cents": final_price_cents,
            "completion_time": completion_time,
        },
    )


async def emit_job_cancelled(
    job_id: str,
    *,
    cancelled_by: str,
    reason: str | None,
) -> None:
    """Emit cancellation notification to the job room."""
    await broadcast_to_job(
        job_id,
        "job:cancelled",
        {
            "job_id": job_id,
            "cancelled_by": cancelled_by,
            "reason": reason,
            "cancelled_at": datetime.now(timezone.utc).isoformat(),
        },
    )


async def emit_sla_warning(
    job_id: str,
    *,
    sla_type: str,
    minutes_remaining: int,
) -> None:
    """Emit SLA countdown warning to the job room."""
    await broadcast_to_job(
        job_id,
        "job:sla_warning",
        {
            "job_id": job_id,
            "sla_type": sla_type,
            "minutes_remaining": minutes_remaining,
            "warning_at": datetime.now(timezone.utc).isoformat(),
        },
    )


async def emit_status_changed(
    job_id: str,
    *,
    old_status: str,
    new_status: str,
) -> None:
    """Emit generic status change notification to the job room."""
    await broadcast_to_job(
        job_id,
        "job:status_changed",
        {
            "job_id": job_id,
            "old_status": old_status,
            "new_status": new_status,
            "timestamp": datetime.now(timezone.utc).isoformat(),
        },
    )


# ---------------------------------------------------------------------------
# Inbound event handlers (events received from clients)
# ---------------------------------------------------------------------------

@sio.on("job:accept_offer", namespace="/jobs")
async def handle_accept_offer(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Provider accepts a job offer.

    Payload: { "job_id": "<uuid>" }

    Transitions: matched -> provider_accepted
    Updates: JobAssignment.status = ACCEPTED, responded_at, SLA deadlines
    """
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    job = await _load_job_with_assignments(job_id)
    if job is None:
        return {"ok": False, "error": "Job not found"}

    allowed, error, assignment = await _verify_provider_permission(job, sid)
    if not allowed or assignment is None:
        return {"ok": False, "error": error}

    # Validate state transition
    transition = validate_transition(
        job.status,
        JobStatus.PROVIDER_ACCEPTED,
        ActorType.PROVIDER,
    )
    if not transition.allowed:
        return {"ok": False, "error": transition.reason}

    now = datetime.now(timezone.utc)

    # Persist changes
    async with async_session_factory() as db:
        # Re-load inside this session to avoid detached instance issues
        job_stmt = select(Job).where(Job.id == uuid.UUID(job_id))
        job_result = await db.execute(job_stmt)
        db_job = job_result.scalar_one_or_none()
        if db_job is None:
            return {"ok": False, "error": "Job not found"}

        assign_stmt = select(JobAssignment).where(JobAssignment.id == assignment.id)
        assign_result = await db.execute(assign_stmt)
        db_assignment = assign_result.scalar_one_or_none()
        if db_assignment is None:
            return {"ok": False, "error": "Assignment not found"}

        old_status = db_job.status.value
        db_job.status = JobStatus.PROVIDER_ACCEPTED

        db_assignment.status = AssignmentStatus.ACCEPTED
        db_assignment.responded_at = now

        # Set SLA deadlines based on the job's snapshot
        if db_job.sla_arrival_time_min:
            from datetime import timedelta
            db_assignment.sla_arrival_deadline = now + timedelta(minutes=db_job.sla_arrival_time_min)
        if db_job.sla_completion_time_min:
            from datetime import timedelta
            db_assignment.sla_completion_deadline = now + timedelta(minutes=db_job.sla_completion_time_min)

        await db.commit()

    # Broadcast to job room (real-time WebSocket)
    provider_user_id = _extract_user_id(sid) or ""
    await emit_status_changed(job_id, old_status=old_status, new_status="provider_accepted")
    await emit_job_accepted(
        job_id,
        provider_name=provider_user_id,  # In production, fetch display_name
        provider_photo=None,
        eta_minutes=assignment.estimated_arrival_min,
    )

    # Push notification to customer
    try:
        async with async_session_factory() as notify_db:
            await notificationService.notify_job_accepted(
                job_id=uuid.UUID(job_id),
                customer_id=job.customer_id,
                provider_name=provider_user_id,
                eta_minutes=assignment.estimated_arrival_min or 15,
                db=notify_db,
            )
            await notify_db.commit()
    except Exception:
        logger.exception("Failed to send push for job acceptance: %s", job_id)

    logger.info("Job %s accepted by provider sid=%s", job_id, sid)
    return {"ok": True, "status": "provider_accepted"}


@sio.on("job:decline_offer", namespace="/jobs")
async def handle_decline_offer(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Provider declines a job offer.

    Payload: { "job_id": "<uuid>", "reason": "<optional string>" }

    Updates: JobAssignment.status = DECLINED
    The job may be re-entered into matching (matched -> pending_match).
    """
    job_id = data.get("job_id")
    reason = data.get("reason")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    job = await _load_job_with_assignments(job_id)
    if job is None:
        return {"ok": False, "error": "Job not found"}

    allowed, error, assignment = await _verify_provider_permission(job, sid)
    if not allowed or assignment is None:
        return {"ok": False, "error": error}

    now = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        assign_stmt = select(JobAssignment).where(JobAssignment.id == assignment.id)
        assign_result = await db.execute(assign_stmt)
        db_assignment = assign_result.scalar_one_or_none()
        if db_assignment is None:
            return {"ok": False, "error": "Assignment not found"}

        db_assignment.status = AssignmentStatus.DECLINED
        db_assignment.responded_at = now
        db_assignment.decline_reason = reason

        # Transition job back to pending_match for re-matching
        job_stmt = select(Job).where(Job.id == uuid.UUID(job_id))
        job_result = await db.execute(job_stmt)
        db_job = job_result.scalar_one_or_none()

        old_status = ""
        if db_job and db_job.status == JobStatus.MATCHED:
            old_status = db_job.status.value
            transition = validate_transition(
                db_job.status,
                JobStatus.PENDING_MATCH,
                ActorType.SYSTEM,
            )
            if transition.allowed:
                db_job.status = JobStatus.PENDING_MATCH

        await db.commit()

    if old_status:
        await emit_status_changed(job_id, old_status=old_status, new_status="pending_match")

    logger.info("Job %s declined by provider sid=%s reason=%s", job_id, sid, reason)
    return {"ok": True, "status": "declined"}


@sio.on("job:mark_en_route", namespace="/jobs")
async def handle_mark_en_route(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Provider marks themselves as en route to the job location.

    Payload: { "job_id": "<uuid>", "lat": <float>, "lng": <float> }

    Transitions: provider_accepted -> provider_en_route
    """
    job_id = data.get("job_id")
    lat = data.get("lat")
    lng = data.get("lng")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    job = await _load_job_with_assignments(job_id)
    if job is None:
        return {"ok": False, "error": "Job not found"}

    allowed, error, assignment = await _verify_provider_permission(job, sid)
    if not allowed or assignment is None:
        return {"ok": False, "error": error}

    transition = validate_transition(
        job.status,
        JobStatus.PROVIDER_EN_ROUTE,
        ActorType.PROVIDER,
    )
    if not transition.allowed:
        return {"ok": False, "error": transition.reason}

    now = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        job_stmt = select(Job).where(Job.id == uuid.UUID(job_id))
        job_result = await db.execute(job_stmt)
        db_job = job_result.scalar_one_or_none()
        if db_job is None:
            return {"ok": False, "error": "Job not found"}

        assign_stmt = select(JobAssignment).where(JobAssignment.id == assignment.id)
        assign_result = await db.execute(assign_stmt)
        db_assignment = assign_result.scalar_one_or_none()

        old_status = db_job.status.value
        db_job.status = JobStatus.PROVIDER_EN_ROUTE

        if db_assignment:
            db_assignment.en_route_at = now

        await db.commit()

    await emit_status_changed(job_id, old_status=old_status, new_status="provider_en_route")
    await emit_provider_en_route(
        job_id,
        provider_lat=lat or 0.0,
        provider_lng=lng or 0.0,
        eta_minutes=assignment.estimated_arrival_min,
    )

    # Push notification to customer
    try:
        async with async_session_factory() as notify_db:
            await notificationService.notify_provider_en_route(
                job_id=uuid.UUID(job_id),
                customer_id=job.customer_id,
                eta_minutes=assignment.estimated_arrival_min or 15,
                db=notify_db,
            )
            await notify_db.commit()
    except Exception:
        logger.exception("Failed to send push for en route: %s", job_id)

    logger.info("Job %s provider en route sid=%s", job_id, sid)
    return {"ok": True, "status": "provider_en_route"}


@sio.on("job:mark_arrived", namespace="/jobs")
async def handle_mark_arrived(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Provider marks arrival at the job location.

    Payload: { "job_id": "<uuid>" }

    Note: This does NOT transition the job status automatically.
    The provider must separately mark_started to begin work.
    Arrival is recorded on the assignment for SLA tracking.
    """
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    job = await _load_job_with_assignments(job_id)
    if job is None:
        return {"ok": False, "error": "Job not found"}

    allowed, error, assignment = await _verify_provider_permission(job, sid)
    if not allowed or assignment is None:
        return {"ok": False, "error": error}

    if job.status != JobStatus.PROVIDER_EN_ROUTE:
        return {"ok": False, "error": "Provider must be en route to mark arrived"}

    now = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        assign_stmt = select(JobAssignment).where(JobAssignment.id == assignment.id)
        assign_result = await db.execute(assign_stmt)
        db_assignment = assign_result.scalar_one_or_none()

        if db_assignment:
            db_assignment.arrived_at = now
            # Check SLA arrival compliance
            if db_assignment.sla_arrival_deadline:
                db_assignment.sla_arrival_met = now <= db_assignment.sla_arrival_deadline

        await db.commit()

    await emit_provider_arrived(job_id)

    # Push notification to customer
    try:
        async with async_session_factory() as notify_db:
            await notificationService.notify_provider_arrived(
                job_id=uuid.UUID(job_id),
                customer_id=job.customer_id,
                db=notify_db,
            )
            await notify_db.commit()
    except Exception:
        logger.exception("Failed to send push for provider arrived: %s", job_id)

    logger.info("Job %s provider arrived sid=%s", job_id, sid)
    return {"ok": True, "arrived_at": now.isoformat()}


@sio.on("job:mark_started", namespace="/jobs")
async def handle_mark_started(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Provider starts work on the job.

    Payload: { "job_id": "<uuid>" }

    Transitions: provider_en_route -> in_progress
    """
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    job = await _load_job_with_assignments(job_id)
    if job is None:
        return {"ok": False, "error": "Job not found"}

    allowed, error, assignment = await _verify_provider_permission(job, sid)
    if not allowed or assignment is None:
        return {"ok": False, "error": error}

    transition = validate_transition(
        job.status,
        JobStatus.IN_PROGRESS,
        ActorType.PROVIDER,
    )
    if not transition.allowed:
        return {"ok": False, "error": transition.reason}

    now = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        job_stmt = select(Job).where(Job.id == uuid.UUID(job_id))
        job_result = await db.execute(job_stmt)
        db_job = job_result.scalar_one_or_none()
        if db_job is None:
            return {"ok": False, "error": "Job not found"}

        assign_stmt = select(JobAssignment).where(JobAssignment.id == assignment.id)
        assign_result = await db.execute(assign_stmt)
        db_assignment = assign_result.scalar_one_or_none()

        old_status = db_job.status.value
        db_job.status = JobStatus.IN_PROGRESS
        db_job.started_at = now

        if db_assignment:
            db_assignment.started_work_at = now

        await db.commit()

    started_at_iso = now.isoformat()
    await emit_status_changed(job_id, old_status=old_status, new_status="in_progress")
    await emit_job_in_progress(job_id, started_at=started_at_iso)

    # Push notification to customer
    try:
        async with async_session_factory() as notify_db:
            await notificationService.notify_job_started(
                job_id=uuid.UUID(job_id),
                customer_id=job.customer_id,
                db=notify_db,
            )
            await notify_db.commit()
    except Exception:
        logger.exception("Failed to send push for job started: %s", job_id)

    logger.info("Job %s work started sid=%s", job_id, sid)
    return {"ok": True, "status": "in_progress", "started_at": started_at_iso}


@sio.on("job:mark_completed", namespace="/jobs")
async def handle_mark_completed(sid: str, data: dict[str, Any]) -> dict[str, Any]:
    """Provider marks the job as completed.

    Payload: { "job_id": "<uuid>" }

    Transitions: in_progress -> completed
    """
    job_id = data.get("job_id")
    if not job_id:
        return {"ok": False, "error": "job_id is required"}

    job = await _load_job_with_assignments(job_id)
    if job is None:
        return {"ok": False, "error": "Job not found"}

    allowed, error, assignment = await _verify_provider_permission(job, sid)
    if not allowed or assignment is None:
        return {"ok": False, "error": error}

    transition = validate_transition(
        job.status,
        JobStatus.COMPLETED,
        ActorType.PROVIDER,
    )
    if not transition.allowed:
        return {"ok": False, "error": transition.reason}

    now = datetime.now(timezone.utc)

    async with async_session_factory() as db:
        job_stmt = select(Job).where(Job.id == uuid.UUID(job_id))
        job_result = await db.execute(job_stmt)
        db_job = job_result.scalar_one_or_none()
        if db_job is None:
            return {"ok": False, "error": "Job not found"}

        assign_stmt = select(JobAssignment).where(JobAssignment.id == assignment.id)
        assign_result = await db.execute(assign_stmt)
        db_assignment = assign_result.scalar_one_or_none()

        old_status = db_job.status.value
        db_job.status = JobStatus.COMPLETED
        db_job.completed_at = now

        if db_assignment:
            db_assignment.status = AssignmentStatus.COMPLETED
            db_assignment.completed_at = now
            # Check SLA completion compliance
            if db_assignment.sla_completion_deadline:
                db_assignment.sla_completion_met = now <= db_assignment.sla_completion_deadline

        await db.commit()

    completion_time = now.isoformat()
    await emit_status_changed(job_id, old_status=old_status, new_status="completed")
    await emit_job_completed(
        job_id,
        final_price_cents=job.final_price_cents or job.quoted_price_cents,
        completion_time=completion_time,
    )

    # Push notification to customer
    try:
        async with async_session_factory() as notify_db:
            await notificationService.notify_job_completed(
                job_id=uuid.UUID(job_id),
                customer_id=job.customer_id,
                final_price_cents=job.final_price_cents or job.quoted_price_cents or 0,
                db=notify_db,
            )
            await notify_db.commit()
    except Exception:
        logger.exception("Failed to send push for job completed: %s", job_id)

    logger.info("Job %s completed sid=%s", job_id, sid)
    return {"ok": True, "status": "completed", "completed_at": completion_time}
