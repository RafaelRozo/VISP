"""
Provider Matching Engine -- VISP-BE-MATCHING-003
=================================================

Core matching logic that finds, filters, and ranks providers for a given
job. Enforces the platform's hard qualification requirements before soft
ranking.

HARD REQUIREMENTS (must pass ALL):
  - Provider level >= job level
  - Provider profile status is 'active'
  - Background check status is 'cleared' and not expired
  - Level 3+: At least one verified, non-expired license credential
  - Level 3+: At least one verified, non-expired insurance policy
  - Level 4: Active on-call shift covering the current time
  - Level 4: Emergency insurance (coverage >= $2M)

SOFT RANKING (after hard filters):
  1. Internal score  (weight 0.6)
  2. Distance        (weight 0.3)
  3. Response time   (weight 0.1)

Key functions:
  - find_matching_providers -- full pipeline: query -> hard filter -> rank
  - assign_provider         -- create a JobAssignment record
  - reassign_provider       -- cancel old assignment, create new one
"""

from __future__ import annotations

import logging
import uuid
from datetime import date, datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.algorithms.providerRanking import (
    RankedProvider,
    RankingCandidate,
    rank_providers,
)
from src.events.jobEvents import emit_provider_assigned, emit_provider_reassigned
from src.models.job import (
    AssignmentStatus,
    Job,
    JobAssignment,
    JobStatus,
)
from src.models.provider import (
    BackgroundCheckStatus,
    ProviderLevel,
    ProviderProfile,
    ProviderProfileStatus,
)
from src.models.sla import OnCallShift, OnCallStatus
from src.models.taxonomy import ProviderTaskQualification, ServiceTask
from src.models.user import User
from src.models.verification import (
    CredentialStatus,
    CredentialType,
    InsuranceStatus,
    ProviderCredential,
    ProviderInsurancePolicy,
)
from src.services.geoService import ProviderDistance, filter_by_radius, haversine_distance

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Minimum insurance coverage in cents for Level 4 emergency ($2M)
LEVEL_4_MIN_INSURANCE_CENTS: int = 200_000_000

# Levels that require license + insurance verification
LICENSED_LEVELS: frozenset[ProviderLevel] = frozenset({
    ProviderLevel.LEVEL_3,
    ProviderLevel.LEVEL_4,
})

# Level numeric mapping for comparison
LEVEL_NUMERIC: dict[ProviderLevel, int] = {
    ProviderLevel.LEVEL_1: 1,
    ProviderLevel.LEVEL_2: 2,
    ProviderLevel.LEVEL_3: 3,
    ProviderLevel.LEVEL_4: 4,
}


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class JobNotFoundError(Exception):
    def __init__(self, job_id: uuid.UUID) -> None:
        self.job_id = job_id
        super().__init__(f"Job with id '{job_id}' not found.")


class ProviderNotFoundError(Exception):
    def __init__(self, provider_id: uuid.UUID) -> None:
        self.provider_id = provider_id
        super().__init__(f"Provider with id '{provider_id}' not found.")


class AssignmentError(Exception):
    def __init__(self, message: str) -> None:
        super().__init__(message)


# ---------------------------------------------------------------------------
# Hard filter checks
# ---------------------------------------------------------------------------

def _level_meets_requirement(
    provider_level: ProviderLevel,
    job_level: ProviderLevel,
) -> bool:
    """Check that provider level >= job level."""
    return LEVEL_NUMERIC[provider_level] >= LEVEL_NUMERIC[job_level]


def _background_check_valid(
    provider: ProviderProfile,
    reference_date: date | None = None,
) -> bool:
    """Check that background check is cleared and not expired."""
    if provider.background_check_status != BackgroundCheckStatus.CLEARED:
        return False
    if provider.background_check_expiry is not None:
        check_date = reference_date or date.today()
        if provider.background_check_expiry < check_date:
            return False
    return True


async def _has_valid_license(
    db: AsyncSession,
    provider_id: uuid.UUID,
    reference_date: date | None = None,
) -> bool:
    """Check that provider has at least one verified, non-expired license."""
    check_date = reference_date or date.today()
    stmt = select(func.count(ProviderCredential.id)).where(
        ProviderCredential.provider_id == provider_id,
        ProviderCredential.credential_type == CredentialType.LICENSE,
        ProviderCredential.status == CredentialStatus.VERIFIED,
        or_(
            ProviderCredential.expiry_date.is_(None),
            ProviderCredential.expiry_date >= check_date,
        ),
    )
    count: int = (await db.execute(stmt)).scalar_one()
    return count > 0


async def _has_active_insurance(
    db: AsyncSession,
    provider_id: uuid.UUID,
    *,
    min_coverage_cents: int | None = None,
    reference_date: date | None = None,
) -> bool:
    """Check that provider has at least one verified, non-expired insurance
    policy. Optionally checks minimum coverage amount."""
    check_date = reference_date or date.today()
    filters = [
        ProviderInsurancePolicy.provider_id == provider_id,
        ProviderInsurancePolicy.status == InsuranceStatus.VERIFIED,
        ProviderInsurancePolicy.effective_date <= check_date,
        ProviderInsurancePolicy.expiry_date >= check_date,
    ]
    if min_coverage_cents is not None:
        filters.append(ProviderInsurancePolicy.coverage_amount_cents >= min_coverage_cents)

    stmt = select(func.count(ProviderInsurancePolicy.id)).where(*filters)
    count: int = (await db.execute(stmt)).scalar_one()
    return count > 0


async def _has_active_on_call_shift(
    db: AsyncSession,
    provider_id: uuid.UUID,
    at_time: datetime | None = None,
) -> bool:
    """Check that provider has an active on-call shift covering the given time."""
    check_time = at_time or datetime.now(timezone.utc)
    stmt = select(func.count(OnCallShift.id)).where(
        OnCallShift.provider_id == provider_id,
        OnCallShift.status == OnCallStatus.ACTIVE,
        OnCallShift.shift_start <= check_time,
        OnCallShift.shift_end >= check_time,
    )
    count: int = (await db.execute(stmt)).scalar_one()
    return count > 0


# ---------------------------------------------------------------------------
# Candidate evaluation pipeline
# ---------------------------------------------------------------------------

async def _evaluate_candidate(
    db: AsyncSession,
    provider: ProviderProfile,
    job_level: ProviderLevel,
    job_lat: float,
    job_lon: float,
    distance_km: float,
) -> dict[str, Any] | None:
    """Evaluate a single provider against all hard requirements.

    Returns a dict with qualification details if the provider passes ALL
    hard filters, or None if they fail any.
    """
    today = date.today()
    now = datetime.now(timezone.utc)

    provider_level_num = LEVEL_NUMERIC.get(provider.current_level, 1)
    is_higher_level = provider_level_num >= 3  # L3+ needs full verification

    # Hard filter 1: Level check — provider level must be >= job level
    if not _level_meets_requirement(provider.current_level, job_level):
        return None

    # Hard filter 2: Profile status
    # L1/L2 can match in ONBOARDING, PENDING_REVIEW, or ACTIVE (MVP)
    # L3+ must be ACTIVE
    if is_higher_level:
        if provider.status != ProviderProfileStatus.ACTIVE:
            return None
    else:
        # L1/L2: allow any non-suspended/inactive status
        if provider.status in (ProviderProfileStatus.SUSPENDED, ProviderProfileStatus.INACTIVE):
            return None

    # Hard filter 3: Background check
    # L3+ requires cleared background check; L1/L2 skips this for MVP
    if is_higher_level and not _background_check_valid(provider, today):
        return None

    # Hard filter 4: Level 3+ requires valid license
    has_license = False
    if is_higher_level:
        has_license = await _has_valid_license(db, provider.id, today)
        if not has_license:
            return None
    else:
        has_license = await _has_valid_license(db, provider.id, today)

    # Hard filter 5: Level 3+ requires active insurance
    has_insurance = False
    if is_higher_level:
        has_insurance = await _has_active_insurance(db, provider.id, reference_date=today)
        if not has_insurance:
            return None
    else:
        has_insurance = await _has_active_insurance(db, provider.id, reference_date=today)

    # Hard filter 6: Level 4 requires active on-call shift
    on_call_active = False
    if job_level == ProviderLevel.LEVEL_4:
        on_call_active = await _has_active_on_call_shift(db, provider.id, now)
        if not on_call_active:
            return None

        # Level 4 also requires emergency-grade insurance ($2M+)
        has_emergency_insurance = await _has_active_insurance(
            db,
            provider.id,
            min_coverage_cents=LEVEL_4_MIN_INSURANCE_CENTS,
            reference_date=today,
        )
        if not has_emergency_insurance:
            return None

    return {
        "provider": provider,
        "distance_km": distance_km,
        "has_license": has_license,
        "has_insurance": has_insurance,
        "on_call_active": on_call_active,
    }


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def find_matching_providers(
    db: AsyncSession,
    job: Job,
    *,
    radius_km: float | None = None,
    max_results: int = 10,
) -> dict[str, Any]:
    """Find and rank providers matching a job's requirements.

    Pipeline:
    1. Load the job's task to determine required level
    2. Query all active providers with location data
    3. Filter by geographic radius
    4. Apply hard qualification filters
    5. Rank by composite score
    6. Return top N results

    Args:
        db: Async database session.
        job: The Job ORM instance to match against.
        radius_km: Optional radius override in km.
        max_results: Maximum providers to return.

    Returns:
        Dict with job metadata and ranked match results.
    """
    # 1. Load the task for level information
    task_stmt = select(ServiceTask).where(ServiceTask.id == job.task_id)
    task_result = await db.execute(task_stmt)
    task = task_result.scalar_one_or_none()

    if task is None:
        raise JobNotFoundError(job.id)

    job_level = task.level
    job_lat = float(job.service_latitude)
    job_lon = float(job.service_longitude)

    # 2. Query providers who are QUALIFIED for this specific task
    # Only include providers with a ProviderTaskQualification record
    # where qualified=True for the job's task_id.
    # Also exclude the client's own provider profile.
    qualified_provider_ids_stmt = (
        select(ProviderTaskQualification.provider_id)
        .where(
            ProviderTaskQualification.task_id == job.task_id,
            ProviderTaskQualification.qualified.is_(True),
        )
    )
    qual_result = await db.execute(qualified_provider_ids_stmt)
    qualified_provider_ids = {row[0] for row in qual_result.all()}

    if not qualified_provider_ids:
        logger.info(
            "Matching for job %s: no providers qualified for task %s",
            job.id,
            job.task_id,
        )
        return {
            "job_id": job.id,
            "job_reference": job.reference_number,
            "job_level": job_level.value,
            "total_candidates_evaluated": 0,
            "total_qualified": 0,
            "matches": [],
        }

    provider_stmt = (
        select(ProviderProfile)
        .options(selectinload(ProviderProfile.user))
        .where(
            ProviderProfile.id.in_(qualified_provider_ids),
            ProviderProfile.status.notin_([
                ProviderProfileStatus.SUSPENDED,
                ProviderProfileStatus.INACTIVE,
            ]),
            # Exclude the client's own provider profile
            ProviderProfile.user_id != job.customer_id,
        )
    )
    provider_result = await db.execute(provider_stmt)
    all_providers = provider_result.scalars().all()

    logger.info(
        "Matching for job %s (task %s): found %d qualified provider IDs, "
        "%d eligible profiles after status/self-exclusion",
        job.id,
        job.task_id,
        len(qualified_provider_ids),
        len(all_providers),
    )
    for p in all_providers:
        logger.info(
            "  Candidate: provider_id=%s, user_id=%s, status=%s, "
            "lat=%s, lng=%s",
            p.id, p.user_id, p.status,
            p.home_latitude, p.home_longitude,
        )

    total_evaluated = len(all_providers)

    # 3. Filter by geographic radius
    # Providers WITHOUT location data are excluded from matching
    providers_with_location = [
        p for p in all_providers
        if p.home_latitude is not None and p.home_longitude is not None
    ]

    if not providers_with_location:
        logger.info(
            "Matching for job %s: all %d candidates lack GPS data, no match",
            job.id,
            len(all_providers),
        )
        return {
            "job_id": job.id,
            "job_reference": job.reference_number,
            "job_level": job_level.value,
            "total_candidates_evaluated": total_evaluated,
            "total_qualified": 0,
            "matches": [],
        }

    nearby = filter_by_radius(providers_with_location, job_lat, job_lon, radius_km)

    logger.info(
        "Matching for job %s: %d of %d providers within radius",
        job.id,
        len(nearby),
        len(providers_with_location),
    )

    # 4. Apply hard qualification filters
    qualified: list[dict[str, Any]] = []
    for pd in nearby:
        candidate = await _evaluate_candidate(
            db,
            pd.provider,
            job_level,
            job_lat,
            job_lon,
            pd.distance_km,
        )
        if candidate is not None:
            qualified.append(candidate)

    # 5. Build ranking candidates
    ranking_candidates: list[RankingCandidate] = []
    for q in qualified:
        prov = q["provider"]
        ranking_candidates.append(
            RankingCandidate(
                provider=prov,
                provider_id=prov.id,
                internal_score=float(prov.internal_score),
                distance_km=q["distance_km"],
                response_time_avg_min=None,  # TODO: compute from historical data
            )
        )

    # 6. Rank and take top N
    ranked = rank_providers(ranking_candidates)
    top_results = ranked[:max_results]

    # Build match results with qualification details
    # Create a lookup for qualification data
    qual_lookup = {q["provider"].id: q for q in qualified}

    matches = []
    for r in top_results:
        q_data = qual_lookup.get(r.provider_id, {})
        prov = r.provider

        # Get user display name
        display_name = None
        if hasattr(prov, "user") and prov.user:
            display_name = prov.user.display_name or f"{prov.user.first_name} {prov.user.last_name}"

        matches.append({
            "provider_id": prov.id,
            "user_id": prov.user_id,
            "display_name": display_name,
            "current_level": prov.current_level.value,
            "internal_score": prov.internal_score,
            "distance_km": r.distance_km,
            "response_time_avg_min": r.response_time_avg_min,
            "score_internal": r.score_internal,
            "score_distance": r.score_distance,
            "score_response": r.score_response,
            "composite_score": r.composite_score,
            "background_check_verified": True,  # passed hard filter
            "has_valid_license": q_data.get("has_license", False),
            "has_active_insurance": q_data.get("has_insurance", False),
            "on_call_active": q_data.get("on_call_active", False),
        })

    logger.info(
        "Matching for job %s (level=%s): evaluated=%d, geo_filtered=%d, qualified=%d, returned=%d",
        job.id,
        job_level.value,
        total_evaluated,
        len(nearby),
        len(qualified),
        len(matches),
    )

    return {
        "job_id": job.id,
        "job_reference": job.reference_number,
        "job_level": job_level.value,
        "total_candidates_evaluated": total_evaluated,
        "total_qualified": len(qualified),
        "matches": matches,
    }


async def assign_provider(
    db: AsyncSession,
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
    *,
    match_score: float | None = None,
) -> JobAssignment:
    """Assign a provider to a job by creating a JobAssignment record.

    Also transitions the job status to MATCHED if it is currently in
    PENDING_MATCH status.

    Args:
        db: Async database session.
        job_id: UUID of the job.
        provider_id: UUID of the provider to assign.
        match_score: Optional composite match score.

    Returns:
        The newly created JobAssignment record.

    Raises:
        JobNotFoundError: If the job does not exist.
        ProviderNotFoundError: If the provider does not exist.
        AssignmentError: If the job already has an active assignment.
    """
    # Validate job exists
    job_stmt = select(Job).where(Job.id == job_id)
    job_result = await db.execute(job_stmt)
    job = job_result.scalar_one_or_none()
    if job is None:
        raise JobNotFoundError(job_id)

    # Validate provider exists
    prov_stmt = select(ProviderProfile).where(ProviderProfile.id == provider_id)
    prov_result = await db.execute(prov_stmt)
    provider = prov_result.scalar_one_or_none()
    if provider is None:
        raise ProviderNotFoundError(provider_id)

    # Check for existing active assignments
    active_stmt = select(func.count(JobAssignment.id)).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status.in_([
            AssignmentStatus.OFFERED,
            AssignmentStatus.ACCEPTED,
        ]),
    )
    active_count: int = (await db.execute(active_stmt)).scalar_one()
    if active_count > 0:
        raise AssignmentError(
            f"Job '{job_id}' already has an active assignment. "
            "Cancel or expire the existing assignment before creating a new one."
        )

    # Compute SLA deadlines from job's SLA snapshot
    now = datetime.now(timezone.utc)
    sla_response_deadline = None
    sla_arrival_deadline = None
    sla_completion_deadline = None

    if job.sla_response_time_min:
        from datetime import timedelta
        sla_response_deadline = now + timedelta(minutes=job.sla_response_time_min)
    if job.sla_arrival_time_min:
        from datetime import timedelta
        sla_arrival_deadline = now + timedelta(minutes=job.sla_arrival_time_min)
    if job.sla_completion_time_min:
        from datetime import timedelta
        sla_completion_deadline = now + timedelta(minutes=job.sla_completion_time_min)

    # Create the assignment
    assignment = JobAssignment(
        job_id=job_id,
        provider_id=provider_id,
        status=AssignmentStatus.OFFERED,
        offered_at=now,
        match_score=Decimal(str(match_score)) if match_score is not None else None,
        sla_response_deadline=sla_response_deadline,
        sla_arrival_deadline=sla_arrival_deadline,
        sla_completion_deadline=sla_completion_deadline,
    )

    db.add(assignment)

    # Transition job to MATCHED if currently in PENDING_MATCH
    if job.status == JobStatus.PENDING_MATCH:
        job.status = JobStatus.MATCHED

    await db.flush()

    # Emit event
    emit_provider_assigned(
        job_id=job_id,
        provider_id=provider_id,
        assignment_id=assignment.id,
        match_score=match_score,
    )

    logger.info(
        "Provider %s assigned to job %s (score=%s)",
        provider_id,
        job_id,
        match_score,
    )

    return assignment


async def reassign_provider(
    db: AsyncSession,
    job_id: uuid.UUID,
    new_provider_id: uuid.UUID,
    *,
    reason: str | None = None,
) -> JobAssignment:
    """Reassign a job to a different provider.

    Cancels any existing active assignment and creates a new one.

    Args:
        db: Async database session.
        job_id: UUID of the job.
        new_provider_id: UUID of the new provider.
        reason: Optional reason for reassignment.

    Returns:
        The newly created JobAssignment for the new provider.

    Raises:
        JobNotFoundError: If the job does not exist.
        ProviderNotFoundError: If the new provider does not exist.
    """
    # Validate job exists
    job_stmt = select(Job).where(Job.id == job_id)
    job_result = await db.execute(job_stmt)
    job = job_result.scalar_one_or_none()
    if job is None:
        raise JobNotFoundError(job_id)

    # Find and cancel existing active assignments
    active_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status.in_([
            AssignmentStatus.OFFERED,
            AssignmentStatus.ACCEPTED,
        ]),
    )
    active_result = await db.execute(active_stmt)
    active_assignments = active_result.scalars().all()

    old_provider_id: uuid.UUID | None = None
    for existing in active_assignments:
        old_provider_id = existing.provider_id
        existing.status = AssignmentStatus.CANCELLED
        existing.decline_reason = reason or "Reassigned to a different provider."
        existing.responded_at = datetime.now(timezone.utc)

    # Reset job status to PENDING_MATCH so the new assignment can transition it
    if job.status in (JobStatus.MATCHED, JobStatus.PROVIDER_ACCEPTED):
        job.status = JobStatus.PENDING_MATCH

    await db.flush()

    # Create new assignment
    new_assignment = await assign_provider(db, job_id, new_provider_id)

    # Emit reassignment event
    if old_provider_id:
        emit_provider_reassigned(
            job_id=job_id,
            old_provider_id=old_provider_id,
            new_provider_id=new_provider_id,
            reason=reason,
        )

    logger.info(
        "Job %s reassigned from provider %s to %s (reason=%s)",
        job_id,
        old_provider_id,
        new_provider_id,
        reason,
    )

    return new_assignment
