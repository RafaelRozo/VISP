"""
Job Event Emission Stubs -- VISP-BE-JOBS-002
=============================================

Event system for job lifecycle state changes. Each function emits an event
that downstream consumers (notifications, analytics, SLA tracking, etc.)
can subscribe to.

These are intentionally stubs: the transport layer (Redis pub/sub, Celery
signals, or an event bus) will be wired in VISP-INT-REALTIME-004. For now
each emitter logs the event and returns the event payload dict so callers
can integrate with it immediately.

Events emitted:
  - job.created
  - job.status_changed
  - job.cancelled
  - job.completed
  - job.provider_assigned
  - job.provider_reassigned
  - job.sla_snapshot_captured
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Any

logger = logging.getLogger(__name__)


def _build_event(
    event_type: str,
    job_id: uuid.UUID,
    *,
    data: dict[str, Any] | None = None,
    actor_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Construct a standardised event payload."""
    return {
        "event_type": event_type,
        "job_id": str(job_id),
        "actor_id": str(actor_id) if actor_id else None,
        "timestamp": datetime.now(timezone.utc).isoformat(),
        "data": data or {},
    }


def emit_job_created(
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    task_id: uuid.UUID,
    reference_number: str,
) -> dict[str, Any]:
    """Emit event when a new job is created."""
    event = _build_event(
        "job.created",
        job_id,
        actor_id=customer_id,
        data={
            "task_id": str(task_id),
            "reference_number": reference_number,
        },
    )
    logger.info("Event emitted: %s for job %s", event["event_type"], job_id)
    return event


def emit_job_status_changed(
    job_id: uuid.UUID,
    old_status: str,
    new_status: str,
    actor_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Emit event when a job transitions between states."""
    event = _build_event(
        "job.status_changed",
        job_id,
        actor_id=actor_id,
        data={
            "old_status": old_status,
            "new_status": new_status,
        },
    )
    logger.info(
        "Event emitted: %s for job %s (%s -> %s)",
        event["event_type"],
        job_id,
        old_status,
        new_status,
    )
    return event


def emit_job_cancelled(
    job_id: uuid.UUID,
    cancelled_by: uuid.UUID,
    reason: str | None = None,
) -> dict[str, Any]:
    """Emit event when a job is cancelled."""
    event = _build_event(
        "job.cancelled",
        job_id,
        actor_id=cancelled_by,
        data={"reason": reason},
    )
    logger.info("Event emitted: %s for job %s", event["event_type"], job_id)
    return event


def emit_job_completed(
    job_id: uuid.UUID,
    provider_id: uuid.UUID | None = None,
) -> dict[str, Any]:
    """Emit event when a job reaches the completed state."""
    event = _build_event(
        "job.completed",
        job_id,
        actor_id=provider_id,
        data={"provider_id": str(provider_id) if provider_id else None},
    )
    logger.info("Event emitted: %s for job %s", event["event_type"], job_id)
    return event


def emit_provider_assigned(
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
    assignment_id: uuid.UUID,
    match_score: float | None = None,
) -> dict[str, Any]:
    """Emit event when a provider is assigned to a job."""
    event = _build_event(
        "job.provider_assigned",
        job_id,
        data={
            "provider_id": str(provider_id),
            "assignment_id": str(assignment_id),
            "match_score": match_score,
        },
    )
    logger.info(
        "Event emitted: %s for job %s -> provider %s",
        event["event_type"],
        job_id,
        provider_id,
    )
    return event


def emit_provider_reassigned(
    job_id: uuid.UUID,
    old_provider_id: uuid.UUID,
    new_provider_id: uuid.UUID,
    reason: str | None = None,
) -> dict[str, Any]:
    """Emit event when a job is reassigned to a different provider."""
    event = _build_event(
        "job.provider_reassigned",
        job_id,
        data={
            "old_provider_id": str(old_provider_id),
            "new_provider_id": str(new_provider_id),
            "reason": reason,
        },
    )
    logger.info(
        "Event emitted: %s for job %s (%s -> %s)",
        event["event_type"],
        job_id,
        old_provider_id,
        new_provider_id,
    )
    return event


def emit_sla_snapshot_captured(
    job_id: uuid.UUID,
    sla_profile_id: uuid.UUID | None,
    snapshot: dict[str, Any],
) -> dict[str, Any]:
    """Emit event when an SLA snapshot is captured at job creation time."""
    event = _build_event(
        "job.sla_snapshot_captured",
        job_id,
        data={
            "sla_profile_id": str(sla_profile_id) if sla_profile_id else None,
            "snapshot": snapshot,
        },
    )
    logger.info("Event emitted: %s for job %s", event["event_type"], job_id)
    return event
