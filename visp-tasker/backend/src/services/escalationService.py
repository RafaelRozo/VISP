"""
Auto-Escalation Service for VISP/Tasker -- VISP-BE-ESCALATION-008.

Automatically detects when a job should be escalated to a higher service level
based on trigger keywords found in text (customer notes, chat messages, task
descriptions from predefined options).

Escalation keyword hierarchy (checked highest level first):
- Level 4: "emergency", "flood", "fire", "burst", "no heat", "no power"
- Level 3: "gas", "permit", "structural", "hvac", "plumbing main"
- Level 2: "electrical", "wiring"

Business rules:
- Only escalate if target_level > current job.level
- Keywords are matched case-insensitively
- The highest matching level wins (check L4 first, then L3, then L2)
- Escalations require admin approval before the job level is changed
- A single job can have multiple escalation records over its lifetime

All methods are async and accept an ``AsyncSession`` for transactional safety.
"""

from __future__ import annotations

import logging
import re
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timezone
from typing import Optional, Sequence

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    EscalationType,
    Job,
    JobEscalation,
    ProviderLevel,
    ServiceTask,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Keyword configuration (ordered highest level first)
# ---------------------------------------------------------------------------

ESCALATION_KEYWORDS: list[tuple[ProviderLevel, list[str]]] = [
    (ProviderLevel.LEVEL_4, [
        "emergency",
        "flood",
        "fire",
        "burst",
        "no heat",
        "no power",
    ]),
    (ProviderLevel.LEVEL_3, [
        "gas",
        "permit",
        "structural",
        "hvac",
        "plumbing main",
    ]),
    (ProviderLevel.LEVEL_2, [
        "electrical",
        "wiring",
    ]),
]

# Pre-compile regex patterns for each keyword (word boundary matching)
_KEYWORD_PATTERNS: list[tuple[ProviderLevel, str, re.Pattern[str]]] = []
for _level, _keywords in ESCALATION_KEYWORDS:
    for _kw in _keywords:
        # Use word boundaries for single words, looser matching for phrases
        if " " in _kw:
            _pattern = re.compile(re.escape(_kw), re.IGNORECASE)
        else:
            _pattern = re.compile(rf"\b{re.escape(_kw)}\b", re.IGNORECASE)
        _KEYWORD_PATTERNS.append((_level, _kw, _pattern))


# ---------------------------------------------------------------------------
# Provider level ordering helper
# ---------------------------------------------------------------------------

_LEVEL_ORDER: dict[ProviderLevel, int] = {
    ProviderLevel.LEVEL_1: 1,
    ProviderLevel.LEVEL_2: 2,
    ProviderLevel.LEVEL_3: 3,
    ProviderLevel.LEVEL_4: 4,
}


def _level_value(level: ProviderLevel) -> int:
    """Return the numeric ordering for a provider level."""
    return _LEVEL_ORDER.get(level, 0)


def _level_from_str(level_str: str) -> ProviderLevel:
    """Convert a level string to ProviderLevel enum."""
    mapping = {
        "1": ProviderLevel.LEVEL_1,
        "2": ProviderLevel.LEVEL_2,
        "3": ProviderLevel.LEVEL_3,
        "4": ProviderLevel.LEVEL_4,
    }
    result = mapping.get(level_str)
    if result is None:
        raise ValueError(f"Invalid level string: {level_str}")
    return result


# ---------------------------------------------------------------------------
# Response DTOs
# ---------------------------------------------------------------------------

@dataclass
class MatchedKeyword:
    """A keyword that was matched during escalation check."""
    keyword: str
    target_level: str
    found_in_text: str


@dataclass
class EscalationResult:
    """Result of checking text for escalation triggers."""
    job_id: uuid.UUID
    should_escalate: bool
    current_level: str
    target_level: Optional[str]
    matched_keywords: list[MatchedKeyword]
    escalation_id: Optional[uuid.UUID]
    escalation_type: Optional[str]


@dataclass
class EscalationDetail:
    """Detailed view of a single escalation."""
    id: uuid.UUID
    job_id: uuid.UUID
    escalation_type: str
    from_level: Optional[str]
    to_level: Optional[str]
    trigger_keyword: Optional[str]
    trigger_description: Optional[str]
    resolved: bool
    resolved_at: Optional[datetime]
    resolved_by: Optional[uuid.UUID]
    resolution_notes: Optional[str]
    created_at: datetime


@dataclass
class EscalationActionResult:
    """Result of an admin approve/reject action on an escalation."""
    escalation_id: uuid.UUID
    action: str
    job_id: uuid.UUID
    from_level: Optional[str]
    to_level: Optional[str]
    performed_by: uuid.UUID
    performed_at: datetime


# ---------------------------------------------------------------------------
# Core service methods
# ---------------------------------------------------------------------------

async def check_escalation(
    db: AsyncSession,
    job_id: uuid.UUID,
    text_to_check: str,
) -> EscalationResult:
    """Check text for escalation trigger keywords and create an escalation if needed.

    Scans the provided text against the keyword hierarchy (Level 4 first, then
    Level 3, then Level 2).  If any keywords match a level higher than the
    job's current level, an escalation record is created.

    The highest matching level wins.

    Args:
        db: Async database session.
        job_id: The job UUID to check.
        text_to_check: Text to scan for keywords.

    Returns:
        EscalationResult with match details and created escalation (if any).

    Raises:
        ValueError: If job not found.
    """
    job = await _get_job_with_task(db, job_id)
    current_level = job.task.level
    current_level_value = _level_value(current_level)

    # Find all matching keywords
    all_matches: list[MatchedKeyword] = []
    highest_target_level: Optional[ProviderLevel] = None
    highest_target_value: int = current_level_value

    for level, keyword, pattern in _KEYWORD_PATTERNS:
        match = pattern.search(text_to_check)
        if match:
            # Extract a context window around the match
            start = max(0, match.start() - 30)
            end = min(len(text_to_check), match.end() + 30)
            context = text_to_check[start:end].strip()

            all_matches.append(MatchedKeyword(
                keyword=keyword,
                target_level=level.value,
                found_in_text=context,
            ))

            level_val = _level_value(level)
            if level_val > highest_target_value:
                highest_target_value = level_val
                highest_target_level = level

    # Only escalate if target > current
    should_escalate = highest_target_level is not None
    escalation_id: Optional[uuid.UUID] = None
    escalation_type: Optional[str] = None

    if should_escalate and highest_target_level is not None:
        # Collect the keywords that triggered the highest level
        trigger_keywords = [
            m.keyword for m in all_matches
            if m.target_level == highest_target_level.value
        ]

        escalation = await create_escalation(
            db=db,
            job_id=job_id,
            from_level=current_level,
            to_level=highest_target_level,
            keywords=trigger_keywords,
            escalation_type_enum=EscalationType.KEYWORD_DETECTED,
        )
        escalation_id = escalation.id
        escalation_type = escalation.escalation_type

    return EscalationResult(
        job_id=job_id,
        should_escalate=should_escalate,
        current_level=current_level.value,
        target_level=highest_target_level.value if highest_target_level else None,
        matched_keywords=all_matches,
        escalation_id=escalation_id,
        escalation_type=escalation_type,
    )


async def create_escalation(
    db: AsyncSession,
    job_id: uuid.UUID,
    from_level: ProviderLevel,
    to_level: ProviderLevel,
    keywords: list[str],
    escalation_type_enum: EscalationType = EscalationType.KEYWORD_DETECTED,
    description: Optional[str] = None,
) -> EscalationDetail:
    """Create an escalation record for a job.

    The escalation is created in an unresolved state and must be approved
    or rejected by an admin before the job level is changed.

    Args:
        db: Async database session.
        job_id: The job UUID.
        from_level: Current job level.
        to_level: Target escalation level.
        keywords: List of trigger keywords that caused the escalation.
        escalation_type_enum: Type of escalation trigger.
        description: Optional human-readable description.

    Returns:
        EscalationDetail with the created record.
    """
    trigger_keyword_str = ", ".join(keywords) if keywords else None
    trigger_desc = description or (
        f"Keywords detected: [{trigger_keyword_str}]. "
        f"Escalation from Level {from_level.value} to Level {to_level.value}."
    )

    escalation = JobEscalation(
        job_id=job_id,
        escalation_type=escalation_type_enum,
        from_level=from_level,
        to_level=to_level,
        trigger_keyword=trigger_keyword_str,
        trigger_description=trigger_desc,
        resolved=False,
    )
    db.add(escalation)
    await db.flush()

    logger.info(
        "Escalation created: id=%s, job=%s, type=%s, from_level=%s, to_level=%s, keywords=%s",
        escalation.id,
        job_id,
        escalation_type_enum.value,
        from_level.value,
        to_level.value,
        trigger_keyword_str,
    )

    return _escalation_to_detail(escalation)


async def approve_escalation(
    db: AsyncSession,
    escalation_id: uuid.UUID,
    admin_user_id: uuid.UUID,
) -> EscalationActionResult:
    """Admin approves an escalation, updating the job to the escalated level.

    When approved:
    1. The escalation record is marked as resolved.
    2. The job's task is NOT changed (task is from the closed catalog), but
       the job's priority and is_emergency flags may be updated.
    3. For Level 4 escalations, the job is marked as emergency.

    Args:
        db: Async database session.
        escalation_id: The escalation UUID to approve.
        admin_user_id: The admin user performing the action.

    Returns:
        EscalationActionResult.

    Raises:
        ValueError: If escalation not found or already resolved.
    """
    escalation = await _get_escalation(db, escalation_id)

    if escalation.resolved:
        raise ValueError(
            f"Escalation {escalation_id} is already resolved "
            f"(resolved_at={escalation.resolved_at})."
        )

    now = datetime.now(timezone.utc)
    escalation.resolved = True
    escalation.resolved_at = now
    escalation.resolved_by = admin_user_id
    escalation.resolution_notes = "Approved by admin"

    # Update the job if escalating to Level 4 -- mark as emergency
    if escalation.to_level == ProviderLevel.LEVEL_4:
        job = await _get_job(db, escalation.job_id)
        job.is_emergency = True
        job.priority = "emergency"
        logger.info(
            "Job %s marked as emergency after Level 4 escalation approval",
            escalation.job_id,
        )

    await db.flush()

    logger.info(
        "Escalation approved: id=%s, job=%s, from=%s, to=%s, by=%s",
        escalation_id,
        escalation.job_id,
        escalation.from_level.value if escalation.from_level else None,
        escalation.to_level.value if escalation.to_level else None,
        admin_user_id,
    )

    return EscalationActionResult(
        escalation_id=escalation_id,
        action="approved",
        job_id=escalation.job_id,
        from_level=escalation.from_level.value if escalation.from_level else None,
        to_level=escalation.to_level.value if escalation.to_level else None,
        performed_by=admin_user_id,
        performed_at=now,
    )


async def reject_escalation(
    db: AsyncSession,
    escalation_id: uuid.UUID,
    admin_user_id: uuid.UUID,
    reason: str,
) -> EscalationActionResult:
    """Admin rejects an escalation with a reason.

    The escalation is marked as resolved with the rejection reason recorded.
    The job is not modified.

    Args:
        db: Async database session.
        escalation_id: The escalation UUID to reject.
        admin_user_id: The admin user performing the action.
        reason: Mandatory rejection reason.

    Returns:
        EscalationActionResult.

    Raises:
        ValueError: If escalation not found, already resolved, or reason is empty.
    """
    if not reason or not reason.strip():
        raise ValueError("A rejection reason is required.")

    escalation = await _get_escalation(db, escalation_id)

    if escalation.resolved:
        raise ValueError(
            f"Escalation {escalation_id} is already resolved "
            f"(resolved_at={escalation.resolved_at})."
        )

    now = datetime.now(timezone.utc)
    escalation.resolved = True
    escalation.resolved_at = now
    escalation.resolved_by = admin_user_id
    escalation.resolution_notes = f"Rejected: {reason.strip()}"

    await db.flush()

    logger.info(
        "Escalation rejected: id=%s, job=%s, by=%s, reason=%s",
        escalation_id,
        escalation.job_id,
        admin_user_id,
        reason[:100],
    )

    return EscalationActionResult(
        escalation_id=escalation_id,
        action="rejected",
        job_id=escalation.job_id,
        from_level=escalation.from_level.value if escalation.from_level else None,
        to_level=escalation.to_level.value if escalation.to_level else None,
        performed_by=admin_user_id,
        performed_at=now,
    )


async def get_pending_escalations(
    db: AsyncSession,
    limit: int = 50,
    offset: int = 0,
) -> tuple[list[EscalationDetail], int]:
    """Get all pending (unresolved) escalations.

    Args:
        db: Async database session.
        limit: Maximum number of results.
        offset: Number of results to skip.

    Returns:
        Tuple of (list of EscalationDetail, total count).
    """
    # Count total
    from sqlalchemy import func
    count_stmt = select(func.count()).select_from(JobEscalation).where(
        JobEscalation.resolved == False,  # noqa: E712
    )
    count_result = await db.execute(count_stmt)
    total_count = count_result.scalar_one()

    # Fetch records
    stmt = (
        select(JobEscalation)
        .where(JobEscalation.resolved == False)  # noqa: E712
        .order_by(JobEscalation.created_at.desc())
        .limit(limit)
        .offset(offset)
    )
    result = await db.execute(stmt)
    escalations = result.scalars().all()

    return [_escalation_to_detail(e) for e in escalations], total_count


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job:
    """Fetch a job by ID or raise ValueError."""
    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return job


async def _get_job_with_task(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job:
    """Fetch a job with its task eagerly loaded, or raise ValueError."""
    from sqlalchemy.orm import selectinload

    stmt = (
        select(Job)
        .options(selectinload(Job.task))
        .where(Job.id == job_id)
    )
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job not found: {job_id}")
    return job


async def _get_escalation(
    db: AsyncSession,
    escalation_id: uuid.UUID,
) -> JobEscalation:
    """Fetch an escalation by ID or raise ValueError."""
    stmt = select(JobEscalation).where(JobEscalation.id == escalation_id)
    result = await db.execute(stmt)
    escalation = result.scalar_one_or_none()
    if escalation is None:
        raise ValueError(f"Escalation not found: {escalation_id}")
    return escalation


def _escalation_to_detail(escalation: JobEscalation) -> EscalationDetail:
    """Map a JobEscalation ORM object to an EscalationDetail DTO."""
    return EscalationDetail(
        id=escalation.id,
        job_id=escalation.job_id,
        escalation_type=escalation.escalation_type.value,
        from_level=escalation.from_level.value if escalation.from_level else None,
        to_level=escalation.to_level.value if escalation.to_level else None,
        trigger_keyword=escalation.trigger_keyword,
        trigger_description=escalation.trigger_description,
        resolved=escalation.resolved,
        resolved_at=escalation.resolved_at,
        resolved_by=escalation.resolved_by,
        resolution_notes=escalation.resolution_notes,
        created_at=escalation.created_at,
    )
