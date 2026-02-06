"""
Penalty Event Handlers -- VISP-BE-SCORING-005.

Event-driven handlers that listen for domain events and apply the appropriate
scoring penalties.  These handlers bridge the gap between job lifecycle events
(e.g., no-show, cancellation, SLA breach) and the scoring engine.

In production, these handlers would be connected to an event bus (e.g., Redis
Pub/Sub, AWS EventBridge, or an in-process event dispatcher).  For now they
are implemented as async callables that can be invoked directly or registered
with any event system.

Supported events:
- provider_no_show       -- Provider did not show up for a job
- provider_cancellation  -- Provider cancelled an accepted job
- response_timeout       -- Provider did not respond within SLA window
- sla_breach             -- Provider breached an SLA requirement (Level 4)
- bad_review_received    -- Provider received a low review score
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy.ext.asyncio import AsyncSession

from src.models import ProviderLevel, ProviderProfile
from src.services.scoringEngine import (
    PenaltyAppliedResult,
    apply_penalty,
    check_expulsion,
    get_provider_score,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Event data classes
# ---------------------------------------------------------------------------

@dataclass
class PenaltyEvent:
    """Base event payload for penalty triggers."""
    provider_id: uuid.UUID
    job_id: Optional[uuid.UUID] = None
    reason: Optional[str] = None
    metadata: Optional[dict[str, Any]] = None
    timestamp: datetime = None  # type: ignore[assignment]

    def __post_init__(self) -> None:
        if self.timestamp is None:
            self.timestamp = datetime.now(timezone.utc)


@dataclass
class ReviewPenaltyEvent(PenaltyEvent):
    """Event payload for a bad review penalty."""
    review_score: Optional[Decimal] = None
    review_id: Optional[uuid.UUID] = None


# ---------------------------------------------------------------------------
# Bad review threshold
# ---------------------------------------------------------------------------

BAD_REVIEW_THRESHOLD = Decimal("2.5")  # Reviews at or below this trigger a penalty


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

async def handle_provider_no_show(
    db: AsyncSession,
    event: PenaltyEvent,
) -> PenaltyAppliedResult:
    """Handle a provider no-show event.

    For Level 4 providers, this triggers IMMEDIATE EXPULSION (zero tolerance).
    For all other levels, it applies the standard no_show penalty.

    Args:
        db: Async database session.
        event: The penalty event payload.

    Returns:
        PenaltyAppliedResult from the scoring engine.
    """
    logger.warning(
        "No-show event received: provider=%s, job=%s",
        event.provider_id,
        event.job_id,
    )

    result = await apply_penalty(
        db=db,
        provider_id=event.provider_id,
        penalty_type="no_show",
        job_id=event.job_id,
        reason=event.reason or "Provider did not show up for scheduled job",
    )

    if result.is_expelled:
        logger.critical(
            "Provider EXPELLED after no-show: provider=%s, job=%s, score=%s",
            event.provider_id,
            event.job_id,
            result.new_score,
        )
        # In production: trigger notification, update job for re-matching, etc.

    return result


async def handle_provider_cancellation(
    db: AsyncSession,
    event: PenaltyEvent,
) -> PenaltyAppliedResult:
    """Handle a provider cancellation event.

    Applied when a provider cancels an already-accepted job.

    Args:
        db: Async database session.
        event: The penalty event payload.

    Returns:
        PenaltyAppliedResult from the scoring engine.
    """
    logger.info(
        "Cancellation event received: provider=%s, job=%s",
        event.provider_id,
        event.job_id,
    )

    return await apply_penalty(
        db=db,
        provider_id=event.provider_id,
        penalty_type="cancellation",
        job_id=event.job_id,
        reason=event.reason or "Provider cancelled an accepted job",
    )


async def handle_response_timeout(
    db: AsyncSession,
    event: PenaltyEvent,
) -> PenaltyAppliedResult:
    """Handle a response timeout event.

    Applied when a provider does not respond to a job offer within the SLA
    response window.

    Args:
        db: Async database session.
        event: The penalty event payload.

    Returns:
        PenaltyAppliedResult from the scoring engine.
    """
    logger.info(
        "Response timeout event received: provider=%s, job=%s",
        event.provider_id,
        event.job_id,
    )

    return await apply_penalty(
        db=db,
        provider_id=event.provider_id,
        penalty_type="response_timeout",
        job_id=event.job_id,
        reason=event.reason or "Provider did not respond within SLA window",
    )


async def handle_sla_breach(
    db: AsyncSession,
    event: PenaltyEvent,
) -> PenaltyAppliedResult:
    """Handle an SLA breach event (Level 4 only).

    Applied when a Level 4 provider breaches an SLA requirement (arrival
    time, completion time, etc.).

    Args:
        db: Async database session.
        event: The penalty event payload.

    Returns:
        PenaltyAppliedResult from the scoring engine.

    Raises:
        ValueError: If the provider is not Level 4 (sla_breach is L4-only).
    """
    logger.warning(
        "SLA breach event received: provider=%s, job=%s",
        event.provider_id,
        event.job_id,
    )

    return await apply_penalty(
        db=db,
        provider_id=event.provider_id,
        penalty_type="sla_breach",
        job_id=event.job_id,
        reason=event.reason or "Provider breached SLA requirement",
    )


async def handle_bad_review(
    db: AsyncSession,
    event: ReviewPenaltyEvent,
) -> Optional[PenaltyAppliedResult]:
    """Handle a bad review event.

    Only triggers a penalty if the review score is at or below the
    BAD_REVIEW_THRESHOLD (2.5 out of 5).

    Args:
        db: Async database session.
        event: The review penalty event payload.

    Returns:
        PenaltyAppliedResult if penalty was applied, None if review score
        was above the threshold.
    """
    if event.review_score is None:
        logger.warning(
            "Bad review event received without score: provider=%s, review=%s",
            event.provider_id,
            event.review_id,
        )
        return None

    if event.review_score > BAD_REVIEW_THRESHOLD:
        logger.debug(
            "Review score %s is above threshold %s, no penalty: provider=%s",
            event.review_score,
            BAD_REVIEW_THRESHOLD,
            event.provider_id,
        )
        return None

    logger.info(
        "Bad review penalty triggered: provider=%s, score=%s, review=%s",
        event.provider_id,
        event.review_score,
        event.review_id,
    )

    return await apply_penalty(
        db=db,
        provider_id=event.provider_id,
        penalty_type="bad_review",
        job_id=event.job_id,
        reason=(
            event.reason
            or f"Received review score {event.review_score} "
            f"(threshold: {BAD_REVIEW_THRESHOLD})"
        ),
    )


# ---------------------------------------------------------------------------
# Event dispatcher (simple registry for wiring)
# ---------------------------------------------------------------------------

EVENT_HANDLERS: dict[str, Any] = {
    "provider_no_show": handle_provider_no_show,
    "provider_cancellation": handle_provider_cancellation,
    "response_timeout": handle_response_timeout,
    "sla_breach": handle_sla_breach,
    "bad_review_received": handle_bad_review,
}


async def dispatch_penalty_event(
    db: AsyncSession,
    event_type: str,
    event: PenaltyEvent,
) -> Optional[PenaltyAppliedResult]:
    """Dispatch a penalty event to the appropriate handler.

    Args:
        db: Async database session.
        event_type: The event type string (e.g., "provider_no_show").
        event: The event payload.

    Returns:
        PenaltyAppliedResult if a penalty was applied, None otherwise.

    Raises:
        ValueError: If the event_type is not recognized.
    """
    handler = EVENT_HANDLERS.get(event_type)
    if handler is None:
        valid_types = ", ".join(sorted(EVENT_HANDLERS.keys()))
        raise ValueError(
            f"Unknown penalty event type '{event_type}'. "
            f"Valid types: {valid_types}"
        )

    return await handler(db, event)
