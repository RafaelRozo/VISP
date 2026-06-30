"""
Provider Scoring & Penalties Engine for VISP -- VISP-BE-SCORING-005.

Manages the internal reputation score for every provider.  The score directly
influences matching priority, visibility, and continued platform access.

Key business rules:
- Each level has a base, min, and max score range.
- Penalties are level-specific and cumulative.
- Level 4 no_show triggers IMMEDIATE EXPULSION (zero tolerance).
- Weekly normalization recovers +5 points per incident-free week, up to the
  level's base score.
- Score below the level minimum triggers automatic suspension.

All methods are async and accept an ``AsyncSession`` for transactional safety.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import and_, select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    ProviderLevel,
    ProviderProfile,
    ProviderProfileStatus,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Score configuration per level
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class LevelScoreConfig:
    """Immutable score parameters for a provider level."""
    base: Decimal
    max: Decimal
    min: Decimal


LEVEL_SCORE_CONFIG: dict[ProviderLevel, LevelScoreConfig] = {
    ProviderLevel.LEVEL_1: LevelScoreConfig(base=Decimal("70"), max=Decimal("90"), min=Decimal("40")),
    ProviderLevel.LEVEL_2: LevelScoreConfig(base=Decimal("75"), max=Decimal("95"), min=Decimal("50")),
    ProviderLevel.LEVEL_3: LevelScoreConfig(base=Decimal("80"), max=Decimal("98"), min=Decimal("60")),
    ProviderLevel.LEVEL_4: LevelScoreConfig(base=Decimal("85"), max=Decimal("100"), min=Decimal("70")),
}


# ---------------------------------------------------------------------------
# Penalty tables per level
# ---------------------------------------------------------------------------

PENALTY_TABLE: dict[ProviderLevel, dict[str, Decimal]] = {
    ProviderLevel.LEVEL_1: {
        "response_timeout": Decimal("-2"),
        "cancellation": Decimal("-3"),
        "no_show": Decimal("-10"),
        "bad_review": Decimal("-5"),
    },
    ProviderLevel.LEVEL_2: {
        "response_timeout": Decimal("-4"),
        "cancellation": Decimal("-6"),
        "no_show": Decimal("-15"),
        "bad_review": Decimal("-7"),
    },
    ProviderLevel.LEVEL_3: {
        "response_timeout": Decimal("-6"),
        "cancellation": Decimal("-10"),
        "no_show": Decimal("-30"),
        "bad_review": Decimal("-10"),
    },
    ProviderLevel.LEVEL_4: {
        "response_timeout": Decimal("-15"),
        "cancellation": Decimal("-25"),
        "no_show": Decimal("-50"),
        "sla_breach": Decimal("-30"),
    },
}

# Weekly recovery rate: +5 per incident-free week, capped at base score
WEEKLY_RECOVERY_POINTS = Decimal("5")


# ---------------------------------------------------------------------------
# Response DTOs
# ---------------------------------------------------------------------------

@dataclass
class PenaltyRecord:
    """A single penalty event stored in the provider's penalty history."""
    penalty_type: str
    points_deducted: Decimal
    job_id: Optional[uuid.UUID] = None
    reason: Optional[str] = None
    applied_at: datetime = field(default_factory=lambda: datetime.now(timezone.utc))


@dataclass
class ProviderScoreInfo:
    """Full scoring information for a provider."""
    provider_id: uuid.UUID
    current_level: str
    current_score: Decimal
    base_score: Decimal
    min_score: Decimal
    max_score: Decimal
    is_expelled: bool
    recent_penalties: list[PenaltyRecord]
    incident_free_weeks: int
    last_penalty_at: Optional[datetime]


@dataclass
class PenaltyAppliedResult:
    """Result returned after applying a penalty."""
    provider_id: uuid.UUID
    penalty_type: str
    points_deducted: Decimal
    previous_score: Decimal
    new_score: Decimal
    job_id: Optional[uuid.UUID]
    is_expelled: bool


@dataclass
class ScoreAdjustResult:
    """Result returned after an admin manual score adjustment."""
    provider_id: uuid.UUID
    previous_score: Decimal
    new_score: Decimal
    adjustment: Decimal
    adjusted_by: uuid.UUID
    adjusted_at: datetime
    reason: str


@dataclass
class NormalizationResult:
    """Result for a single provider's score normalization."""
    provider_id: uuid.UUID
    previous_score: Decimal
    new_score: Decimal
    points_recovered: Decimal
    incident_free_weeks: int


@dataclass
class NormalizationBatchResult:
    """Aggregate result of the weekly normalization job."""
    providers_processed: int
    providers_recovered: int
    total_points_recovered: Decimal
    results: list[NormalizationResult]


# ---------------------------------------------------------------------------
# In-memory penalty log (production: move to a dedicated DB table or Redis)
# ---------------------------------------------------------------------------
# NOTE: In a production system, penalties would be stored in a dedicated
# ``provider_penalties`` table.  For this module, we use the Job model's
# status transitions and an in-memory structure that can be swapped out.
# The penalty history is stored as JSONB on the provider profile in the
# ``internal_score`` field's companion metadata.  For now we use a module-
# level dict keyed by provider_id to track recent penalties.  This will be
# replaced with a proper table in a future migration.

_penalty_history: dict[uuid.UUID, list[PenaltyRecord]] = {}


def _get_penalty_history(provider_id: uuid.UUID) -> list[PenaltyRecord]:
    """Return the penalty history for a provider (most recent first)."""
    return sorted(
        _penalty_history.get(provider_id, []),
        key=lambda p: p.applied_at,
        reverse=True,
    )


def _append_penalty(provider_id: uuid.UUID, record: PenaltyRecord) -> None:
    """Append a penalty record to the provider's history."""
    if provider_id not in _penalty_history:
        _penalty_history[provider_id] = []
    _penalty_history[provider_id].append(record)


def _count_incident_free_weeks(provider_id: uuid.UUID) -> int:
    """Count how many consecutive weeks the provider has been incident-free.

    Returns 0 if there is a penalty in the most recent 7-day window, otherwise
    counts backwards in 7-day increments.
    """
    history = _penalty_history.get(provider_id, [])
    if not history:
        return 52  # Cap at 1 year if no penalties ever recorded

    sorted_history = sorted(history, key=lambda p: p.applied_at, reverse=True)
    most_recent = sorted_history[0].applied_at
    now = datetime.now(timezone.utc)
    days_since = (now - most_recent).days

    if days_since < 7:
        return 0

    return min(days_since // 7, 52)  # Cap at 52 weeks


# ---------------------------------------------------------------------------
# Core service methods
# ---------------------------------------------------------------------------

async def apply_penalty(
    db: AsyncSession,
    provider_id: uuid.UUID,
    penalty_type: str,
    job_id: Optional[uuid.UUID] = None,
    reason: Optional[str] = None,
) -> PenaltyAppliedResult:
    """Apply a penalty to a provider's internal score.

    Business rules:
    - Level 4 ``no_show`` results in IMMEDIATE EXPULSION (status -> suspended,
      score -> 0).
    - All other penalties deduct points per the level penalty table.
    - Score is clamped to the level's [min, max] range.
    - If score drops below the level minimum, the provider is suspended.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        penalty_type: One of the penalty types defined in the level's penalty table.
        job_id: Optional job UUID that triggered the penalty.
        reason: Optional human-readable reason.

    Returns:
        PenaltyAppliedResult with before/after score and expulsion status.

    Raises:
        ValueError: If provider not found or penalty_type is invalid for the level.
    """
    profile = await _get_provider_profile(db, provider_id)
    level = profile.current_level
    config = LEVEL_SCORE_CONFIG[level]
    penalties = PENALTY_TABLE[level]

    if penalty_type not in penalties:
        valid_types = ", ".join(sorted(penalties.keys()))
        raise ValueError(
            f"Invalid penalty type '{penalty_type}' for level {level.value}. "
            f"Valid types: {valid_types}"
        )

    previous_score = Decimal(str(profile.internal_score))
    is_expelled = False

    # Level 4 no_show = IMMEDIATE EXPULSION
    if level == ProviderLevel.LEVEL_4 and penalty_type == "no_show":
        new_score = Decimal("0")
        is_expelled = True
        profile.internal_score = new_score
        profile.status = ProviderProfileStatus.SUSPENDED
        points_deducted = previous_score  # All points removed

        logger.critical(
            "IMMEDIATE EXPULSION: Level 4 provider %s no-show on job %s. "
            "Score %s -> 0. Provider SUSPENDED.",
            provider_id,
            job_id,
            previous_score,
        )
    else:
        deduction = penalties[penalty_type]
        raw_new_score = previous_score + deduction  # deduction is negative
        new_score = max(config.min, min(config.max, raw_new_score))
        points_deducted = previous_score - new_score
        profile.internal_score = new_score

        # Check if score dropped below minimum threshold
        if new_score <= config.min:
            profile.status = ProviderProfileStatus.SUSPENDED
            is_expelled = True
            logger.warning(
                "Provider %s suspended: score %s dropped to minimum %s for level %s",
                provider_id,
                new_score,
                config.min,
                level.value,
            )

    # Record the penalty
    record = PenaltyRecord(
        penalty_type=penalty_type,
        points_deducted=abs(points_deducted),
        job_id=job_id,
        reason=reason,
        applied_at=datetime.now(timezone.utc),
    )
    _append_penalty(provider_id, record)

    await db.flush()

    logger.info(
        "Penalty applied: provider=%s, type=%s, deducted=%s, score=%s->%s, expelled=%s",
        provider_id,
        penalty_type,
        abs(points_deducted),
        previous_score,
        new_score,
        is_expelled,
    )

    return PenaltyAppliedResult(
        provider_id=provider_id,
        penalty_type=penalty_type,
        points_deducted=abs(points_deducted),
        previous_score=previous_score,
        new_score=new_score,
        job_id=job_id,
        is_expelled=is_expelled,
    )


async def get_provider_score(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> ProviderScoreInfo:
    """Retrieve the full scoring information for a provider.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.

    Returns:
        ProviderScoreInfo with current score, level config, and penalty history.

    Raises:
        ValueError: If provider profile not found.
    """
    profile = await _get_provider_profile(db, provider_id)
    level = profile.current_level
    config = LEVEL_SCORE_CONFIG[level]
    is_expelled = await check_expulsion(db, provider_id)
    history = _get_penalty_history(provider_id)
    incident_free_weeks = _count_incident_free_weeks(provider_id)
    last_penalty_at = history[0].applied_at if history else None

    return ProviderScoreInfo(
        provider_id=provider_id,
        current_level=level.value,
        current_score=Decimal(str(profile.internal_score)),
        base_score=config.base,
        min_score=config.min,
        max_score=config.max,
        is_expelled=is_expelled,
        recent_penalties=history[:20],  # Last 20 penalties
        incident_free_weeks=incident_free_weeks,
        last_penalty_at=last_penalty_at,
    )


async def check_expulsion(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> bool:
    """Check whether a provider is expelled (suspended due to score).

    For Level 4 providers, a single no_show triggers immediate expulsion.
    For all levels, score at or below the minimum triggers expulsion.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.

    Returns:
        True if the provider is expelled/suspended, False otherwise.

    Raises:
        ValueError: If provider profile not found.
    """
    profile = await _get_provider_profile(db, provider_id)

    if profile.status == ProviderProfileStatus.SUSPENDED:
        return True

    level = profile.current_level
    config = LEVEL_SCORE_CONFIG[level]
    current_score = Decimal(str(profile.internal_score))

    if current_score <= config.min:
        return True

    # Check Level 4 no_show in penalty history
    if level == ProviderLevel.LEVEL_4:
        history = _penalty_history.get(provider_id, [])
        if any(p.penalty_type == "no_show" for p in history):
            return True

    return False


async def normalize_score(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> NormalizationResult:
    """Normalize (recover) a single provider's score.

    Adds +5 points per incident-free week, capped at the level's base score.
    Only applies to active providers whose score is below their base.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.

    Returns:
        NormalizationResult with recovery details.

    Raises:
        ValueError: If provider profile not found.
    """
    profile = await _get_provider_profile(db, provider_id)
    level = profile.current_level
    config = LEVEL_SCORE_CONFIG[level]
    current_score = Decimal(str(profile.internal_score))
    incident_free_weeks = _count_incident_free_weeks(provider_id)

    # Only recover if below base and has incident-free weeks
    if current_score >= config.base or incident_free_weeks == 0:
        return NormalizationResult(
            provider_id=provider_id,
            previous_score=current_score,
            new_score=current_score,
            points_recovered=Decimal("0"),
            incident_free_weeks=incident_free_weeks,
        )

    # Only recover for the most recent incident-free week (called weekly)
    recovery = min(WEEKLY_RECOVERY_POINTS, config.base - current_score)
    new_score = current_score + recovery

    profile.internal_score = new_score
    await db.flush()

    logger.info(
        "Score normalized: provider=%s, score=%s->%s, recovered=%s, incident_free_weeks=%d",
        provider_id,
        current_score,
        new_score,
        recovery,
        incident_free_weeks,
    )

    return NormalizationResult(
        provider_id=provider_id,
        previous_score=current_score,
        new_score=new_score,
        points_recovered=recovery,
        incident_free_weeks=incident_free_weeks,
    )


async def admin_adjust_score(
    db: AsyncSession,
    provider_id: uuid.UUID,
    adjustment: Decimal,
    admin_user_id: uuid.UUID,
    reason: str,
) -> ScoreAdjustResult:
    """Admin manually adjusts a provider's internal score.

    The resulting score is clamped to the level's [min, max] range.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        adjustment: Points to add (positive) or subtract (negative).
        admin_user_id: The admin user performing the adjustment.
        reason: Mandatory reason for the adjustment.

    Returns:
        ScoreAdjustResult with before/after score.

    Raises:
        ValueError: If provider not found or reason is empty.
    """
    if not reason or not reason.strip():
        raise ValueError("A reason is required for manual score adjustments.")

    profile = await _get_provider_profile(db, provider_id)
    level = profile.current_level
    config = LEVEL_SCORE_CONFIG[level]
    previous_score = Decimal(str(profile.internal_score))

    raw_new_score = previous_score + adjustment
    new_score = max(config.min, min(config.max, raw_new_score))

    profile.internal_score = new_score
    now = datetime.now(timezone.utc)

    await db.flush()

    logger.info(
        "Admin score adjustment: provider=%s, adjustment=%s, score=%s->%s, by=%s, reason=%s",
        provider_id,
        adjustment,
        previous_score,
        new_score,
        admin_user_id,
        reason[:100],
    )

    return ScoreAdjustResult(
        provider_id=provider_id,
        previous_score=previous_score,
        new_score=new_score,
        adjustment=adjustment,
        adjusted_by=admin_user_id,
        adjusted_at=now,
        reason=reason.strip(),
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_provider_profile(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> ProviderProfile:
    """Fetch a provider profile by ID or raise ValueError."""
    stmt = select(ProviderProfile).where(ProviderProfile.id == provider_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    if profile is None:
        raise ValueError(f"Provider profile not found: {provider_id}")
    return profile
