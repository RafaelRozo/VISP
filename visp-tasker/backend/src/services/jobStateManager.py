"""
Job State Manager -- VISP-BE-JOBS-002
======================================

Finite state machine governing all valid job status transitions. Every
status change MUST go through ``validate_transition`` before being persisted.

State machine overview::

    draft --> pending_match --> matched --> provider_accepted
        --> provider_en_route --> in_progress --> completed

    completed --> disputed

    (any state) --> cancelled_by_customer   (guard: only before match)
    (any state) --> cancelled_by_provider   (guard: only after acceptance)
    (any state) --> cancelled_by_system     (no guard -- system override)

Guards enforce that only the correct actor type can trigger certain
transitions.
"""

from __future__ import annotations

import enum
from dataclasses import dataclass
from typing import Optional

from src.models.job import JobStatus


# ---------------------------------------------------------------------------
# Actor types for guard enforcement
# ---------------------------------------------------------------------------

class ActorType(str, enum.Enum):
    CUSTOMER = "customer"
    PROVIDER = "provider"
    SYSTEM = "system"
    ADMIN = "admin"


# ---------------------------------------------------------------------------
# Transition guard result
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class TransitionResult:
    """Result of a transition validation attempt."""
    allowed: bool
    reason: str | None = None


# ---------------------------------------------------------------------------
# Transition definitions
# ---------------------------------------------------------------------------

# Each key is the current status, and the value is a set of statuses it can
# transition to. Guards are checked separately.
VALID_TRANSITIONS: dict[JobStatus, set[JobStatus]] = {
    JobStatus.DRAFT: {
        JobStatus.PENDING_MATCH,
        JobStatus.CANCELLED_BY_CUSTOMER,
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.PENDING_MATCH: {
        JobStatus.MATCHED,
        JobStatus.CANCELLED_BY_CUSTOMER,
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.MATCHED: {
        JobStatus.PROVIDER_ACCEPTED,
        JobStatus.PENDING_MATCH,  # provider declined, re-enter matching
        JobStatus.CANCELLED_BY_CUSTOMER,
        JobStatus.CANCELLED_BY_PROVIDER,
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.PROVIDER_ACCEPTED: {
        JobStatus.PROVIDER_EN_ROUTE,
        JobStatus.CANCELLED_BY_PROVIDER,
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.PROVIDER_EN_ROUTE: {
        JobStatus.IN_PROGRESS,
        JobStatus.CANCELLED_BY_PROVIDER,
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.IN_PROGRESS: {
        JobStatus.COMPLETED,
        JobStatus.CANCELLED_BY_PROVIDER,
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.COMPLETED: {
        JobStatus.DISPUTED,
    },
    # Terminal states -- no further transitions except system override
    JobStatus.CANCELLED_BY_CUSTOMER: {
        JobStatus.CANCELLED_BY_SYSTEM,  # system can always override
    },
    JobStatus.CANCELLED_BY_PROVIDER: {
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.CANCELLED_BY_SYSTEM: set(),  # truly terminal
    JobStatus.DISPUTED: {
        JobStatus.REFUNDED,
        JobStatus.COMPLETED,  # dispute resolved in favour of provider
        JobStatus.CANCELLED_BY_SYSTEM,
    },
    JobStatus.REFUNDED: {
        JobStatus.CANCELLED_BY_SYSTEM,
    },
}

# Statuses in which the customer can still cancel
_CUSTOMER_CANCELLABLE: frozenset[JobStatus] = frozenset({
    JobStatus.DRAFT,
    JobStatus.PENDING_MATCH,
    JobStatus.MATCHED,
})

# Statuses in which the provider can cancel (after they have been involved)
_PROVIDER_CANCELLABLE: frozenset[JobStatus] = frozenset({
    JobStatus.MATCHED,
    JobStatus.PROVIDER_ACCEPTED,
    JobStatus.PROVIDER_EN_ROUTE,
    JobStatus.IN_PROGRESS,
})


# ---------------------------------------------------------------------------
# Guard functions
# ---------------------------------------------------------------------------

def _guard_customer_cancel(current: JobStatus) -> TransitionResult:
    """Customer may only cancel before a provider is en route."""
    if current in _CUSTOMER_CANCELLABLE:
        return TransitionResult(allowed=True)
    return TransitionResult(
        allowed=False,
        reason=(
            f"Customer cannot cancel a job in '{current.value}' status. "
            f"Cancellation by customer is only allowed in: "
            f"{', '.join(s.value for s in sorted(_CUSTOMER_CANCELLABLE, key=lambda s: s.value))}."
        ),
    )


def _guard_provider_cancel(current: JobStatus) -> TransitionResult:
    """Provider may only cancel after they have been matched/accepted."""
    if current in _PROVIDER_CANCELLABLE:
        return TransitionResult(allowed=True)
    return TransitionResult(
        allowed=False,
        reason=(
            f"Provider cannot cancel a job in '{current.value}' status. "
            f"Cancellation by provider is only allowed in: "
            f"{', '.join(s.value for s in sorted(_PROVIDER_CANCELLABLE, key=lambda s: s.value))}."
        ),
    )


def _guard_provider_accept(
    current: JobStatus,
    actor_type: ActorType,
) -> TransitionResult:
    """Only a provider (or system on behalf of provider) can accept."""
    if actor_type not in (ActorType.PROVIDER, ActorType.SYSTEM, ActorType.ADMIN):
        return TransitionResult(
            allowed=False,
            reason="Only a provider can accept a job assignment.",
        )
    return TransitionResult(allowed=True)


def _guard_provider_en_route(
    current: JobStatus,
    actor_type: ActorType,
) -> TransitionResult:
    """Only a provider can mark themselves as en route."""
    if actor_type not in (ActorType.PROVIDER, ActorType.SYSTEM, ActorType.ADMIN):
        return TransitionResult(
            allowed=False,
            reason="Only a provider can mark a job as en route.",
        )
    return TransitionResult(allowed=True)


def _guard_start_work(
    current: JobStatus,
    actor_type: ActorType,
) -> TransitionResult:
    """Only a provider can start work."""
    if actor_type not in (ActorType.PROVIDER, ActorType.SYSTEM, ActorType.ADMIN):
        return TransitionResult(
            allowed=False,
            reason="Only a provider can start work on a job.",
        )
    return TransitionResult(allowed=True)


def _guard_complete(
    current: JobStatus,
    actor_type: ActorType,
) -> TransitionResult:
    """Only a provider or system can mark a job as completed."""
    if actor_type not in (ActorType.PROVIDER, ActorType.SYSTEM, ActorType.ADMIN):
        return TransitionResult(
            allowed=False,
            reason="Only a provider or system can complete a job.",
        )
    return TransitionResult(allowed=True)


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

def validate_transition(
    current_status: JobStatus,
    new_status: JobStatus,
    actor_type: ActorType = ActorType.SYSTEM,
) -> TransitionResult:
    """Validate whether a job status transition is allowed.

    Checks two layers:
    1. Is the transition structurally valid per the state machine?
    2. Does the actor have permission for this specific transition (guards)?

    Returns a ``TransitionResult`` with ``allowed=True`` if the transition
    is permitted, or ``allowed=False`` with a human-readable ``reason``.
    """
    # 1. Structural check
    allowed_targets = VALID_TRANSITIONS.get(current_status, set())
    if new_status not in allowed_targets:
        return TransitionResult(
            allowed=False,
            reason=(
                f"Invalid transition: '{current_status.value}' -> '{new_status.value}'. "
                f"Allowed transitions from '{current_status.value}': "
                f"{', '.join(s.value for s in sorted(allowed_targets, key=lambda s: s.value)) or 'none'}."
            ),
        )

    # 2. Guard checks for specific transitions
    if new_status == JobStatus.CANCELLED_BY_CUSTOMER:
        return _guard_customer_cancel(current_status)

    if new_status == JobStatus.CANCELLED_BY_PROVIDER:
        return _guard_provider_cancel(current_status)

    if new_status == JobStatus.PROVIDER_ACCEPTED:
        return _guard_provider_accept(current_status, actor_type)

    if new_status == JobStatus.PROVIDER_EN_ROUTE:
        return _guard_provider_en_route(current_status, actor_type)

    if new_status == JobStatus.IN_PROGRESS:
        return _guard_start_work(current_status, actor_type)

    if new_status == JobStatus.COMPLETED:
        return _guard_complete(current_status, actor_type)

    # All other transitions are structurally valid and have no actor guard
    return TransitionResult(allowed=True)


def get_valid_transitions(
    current_status: JobStatus,
    actor_type: ActorType = ActorType.SYSTEM,
) -> list[JobStatus]:
    """Return the list of statuses that the given actor can transition to
    from the current status.

    Useful for UI hints (e.g. showing available actions to the user).
    """
    candidates = VALID_TRANSITIONS.get(current_status, set())
    valid: list[JobStatus] = []
    for target in candidates:
        result = validate_transition(current_status, target, actor_type)
        if result.allowed:
            valid.append(target)
    return sorted(valid, key=lambda s: s.value)
