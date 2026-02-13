"""
Provider Service -- VISP-BE-JOBS-002 / Provider Endpoints
==========================================================

Business logic for provider-facing operations: dashboard stats, job offers,
offer accept/reject, earnings summaries, schedule, and credentials.

All operations use async SQLAlchemy sessions.
"""

from __future__ import annotations

import logging
import math
import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional, Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models.job import (
    AssignmentStatus,
    Job,
    JobAssignment,
    JobStatus,
)
from src.models.provider import (
    ProviderAvailability,
    ProviderProfile,
    ProviderProfileStatus,
)
from src.models.review import Review, ReviewerRole, ReviewStatus
from src.models.sla import OnCallShift
from src.models.taxonomy import ServiceCategory, ServiceTask
from src.models.user import User
from src.models.verification import (
    ProviderCredential,
    ProviderInsurancePolicy,
)
from src.services.geoService import haversine_distance

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class ProviderNotFoundError(Exception):
    """Raised when a provider profile cannot be found."""

    def __init__(self, identifier: Any) -> None:
        super().__init__(f"Provider profile not found: {identifier}")


class OfferNotFoundError(Exception):
    """Raised when a job offer (assignment) cannot be found."""

    def __init__(self, job_id: uuid.UUID, provider_id: uuid.UUID) -> None:
        super().__init__(
            f"No pending offer found for job '{job_id}' and provider '{provider_id}'."
        )


class OfferAlreadyRespondedError(Exception):
    """Raised when the provider has already accepted or declined the offer."""

    def __init__(self, assignment_id: uuid.UUID) -> None:
        super().__init__(
            f"Offer '{assignment_id}' has already been responded to."
        )


# ---------------------------------------------------------------------------
# Provider profile lookup
# ---------------------------------------------------------------------------

async def get_provider_profile(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> ProviderProfile:
    """Fetch the provider profile for a user, raising if not found."""
    stmt = (
        select(ProviderProfile)
        .options(selectinload(ProviderProfile.user))
        .where(ProviderProfile.user_id == user_id)
    )
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    if profile is None:
        raise ProviderNotFoundError(user_id)
    return profile


# ---------------------------------------------------------------------------
# Dashboard
# ---------------------------------------------------------------------------

async def get_dashboard(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> dict[str, Any]:
    """Build the provider dashboard summary.

    Returns:
        Dict with todayJobs, weekEarnings, rating, totalCompletedJobs,
        activeJob, recentJobs, and availabilityStatus.
    """
    now = datetime.now(timezone.utc)
    today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    week_start = today_start - timedelta(days=today_start.weekday())

    # Subquery: job IDs assigned to this provider (accepted/completed)
    provider_job_ids = (
        select(JobAssignment.job_id)
        .where(
            JobAssignment.provider_id == provider_id,
            JobAssignment.status.in_([
                AssignmentStatus.ACCEPTED,
                AssignmentStatus.COMPLETED,
            ]),
        )
        .scalar_subquery()
    )

    # Today's jobs count
    today_count_stmt = select(func.count(Job.id)).where(
        Job.id.in_(provider_job_ids),
        Job.created_at >= today_start,
    )
    today_jobs: int = (await db.execute(today_count_stmt)).scalar_one()

    # Week earnings (sum of provider_payout_cents for completed jobs this week)
    week_earnings_stmt = select(
        func.coalesce(func.sum(Job.provider_payout_cents), 0)
    ).where(
        Job.id.in_(provider_job_ids),
        Job.status == JobStatus.COMPLETED,
        Job.completed_at >= week_start,
    )
    week_earnings: int = (await db.execute(week_earnings_stmt)).scalar_one()

    # Total completed jobs
    total_completed_stmt = select(func.count(Job.id)).where(
        Job.id.in_(provider_job_ids),
        Job.status == JobStatus.COMPLETED,
    )
    total_completed: int = (await db.execute(total_completed_stmt)).scalar_one()

    # Average rating (from reviews where this provider is the reviewee)
    profile_stmt = select(ProviderProfile).where(ProviderProfile.id == provider_id)
    profile_result = await db.execute(profile_stmt)
    profile = profile_result.scalar_one_or_none()

    rating = None
    if profile is not None:
        rating_stmt = select(func.avg(Review.overall_rating)).where(
            Review.reviewee_id == profile.user_id,
            Review.status == ReviewStatus.PUBLISHED,
        )
        avg_rating = (await db.execute(rating_stmt)).scalar_one()
        if avg_rating is not None:
            rating = round(Decimal(str(avg_rating)), 2)

    # Active job (currently in progress or en route)
    active_job_stmt = (
        select(Job)
        .where(
            Job.id.in_(provider_job_ids),
            Job.status.in_([
                JobStatus.PROVIDER_ACCEPTED,
                JobStatus.PROVIDER_EN_ROUTE,
                JobStatus.IN_PROGRESS,
            ]),
        )
        .order_by(Job.created_at.desc())
        .limit(1)
    )
    active_result = await db.execute(active_job_stmt)
    active_job_row = active_result.scalar_one_or_none()
    active_job = None
    if active_job_row is not None:
        # Fetch customer name
        customer_stmt = select(User).where(User.id == active_job_row.customer_id)
        customer = (await db.execute(customer_stmt)).scalar_one_or_none()
        customer_name = None
        if customer:
            customer_name = (
                customer.display_name
                or f"{customer.first_name} {customer.last_name}"
            )

        active_job = {
            "id": active_job_row.id,
            "reference_number": active_job_row.reference_number,
            "status": active_job_row.status.value,
            "service_address": active_job_row.service_address,
            "service_city": active_job_row.service_city,
            "customer_name": customer_name,
            "started_at": active_job_row.started_at,
        }

    # Recent jobs (last 10 completed/cancelled)
    recent_stmt = (
        select(Job)
        .where(
            Job.id.in_(provider_job_ids),
            Job.status.in_([
                JobStatus.COMPLETED,
                JobStatus.CANCELLED_BY_CUSTOMER,
                JobStatus.CANCELLED_BY_PROVIDER,
                JobStatus.CANCELLED_BY_SYSTEM,
            ]),
        )
        .order_by(Job.updated_at.desc())
        .limit(10)
    )
    recent_result = await db.execute(recent_stmt)
    recent_rows = recent_result.scalars().all()
    recent_jobs = [
        {
            "id": j.id,
            "reference_number": j.reference_number,
            "status": j.status.value,
            "service_city": j.service_city,
            "final_price_cents": j.final_price_cents,
            "completed_at": j.completed_at,
            "created_at": j.created_at,
        }
        for j in recent_rows
    ]

    # Availability status (simplified -- check if provider is in an active job)
    availability = "ONLINE"
    if active_job is not None:
        availability = "BUSY"
    elif profile and profile.status != ProviderProfileStatus.ACTIVE:
        availability = "OFFLINE"

    return {
        "today_jobs": today_jobs,
        "week_earnings_cents": week_earnings,
        "rating": rating,
        "total_completed_jobs": total_completed,
        "active_job": active_job,
        "recent_jobs": recent_jobs,
        "availability_status": availability,
    }


# ---------------------------------------------------------------------------
# Offers
# ---------------------------------------------------------------------------

async def get_pending_offers(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> list[dict[str, Any]]:
    """Get all pending job offers for a provider.

    Returns a list of enriched offer dicts with job, task, customer,
    pricing, SLA, and distance information.
    """
    # Fetch assignments with status OFFERED for this provider,
    # but ONLY for jobs that are still in MATCHED status (not yet accepted
    # by anyone).
    stmt = (
        select(JobAssignment)
        .join(Job, Job.id == JobAssignment.job_id)
        .where(
            JobAssignment.provider_id == provider_id,
            JobAssignment.status == AssignmentStatus.OFFERED,
            Job.status.in_([JobStatus.MATCHED, JobStatus.PENDING_MATCH]),
        )
        .order_by(JobAssignment.offered_at.desc())
    )
    result = await db.execute(stmt)
    assignments = result.scalars().all()

    if not assignments:
        return []

    # Get provider location for distance calculation
    provider_stmt = select(ProviderProfile).where(ProviderProfile.id == provider_id)
    provider = (await db.execute(provider_stmt)).scalar_one_or_none()

    offers: list[dict[str, Any]] = []
    for assignment in assignments:
        # Load job
        job_stmt = select(Job).where(Job.id == assignment.job_id)
        job = (await db.execute(job_stmt)).scalar_one_or_none()
        if job is None:
            continue

        # Load task with category
        task_stmt = (
            select(ServiceTask)
            .options(selectinload(ServiceTask.category))
            .where(ServiceTask.id == job.task_id)
        )
        task = (await db.execute(task_stmt)).scalar_one_or_none()

        # Load customer
        customer_stmt = select(User).where(User.id == job.customer_id)
        customer = (await db.execute(customer_stmt)).scalar_one_or_none()

        # Customer rating
        customer_rating = None
        if customer:
            rating_stmt = select(func.avg(Review.overall_rating)).where(
                Review.reviewee_id == customer.id,
                Review.status == ReviewStatus.PUBLISHED,
            )
            avg = (await db.execute(rating_stmt)).scalar_one()
            if avg is not None:
                customer_rating = round(Decimal(str(avg)), 2)

        # Distance
        distance_km = None
        if (
            provider
            and provider.home_latitude is not None
            and provider.home_longitude is not None
        ):
            distance_km = round(
                haversine_distance(
                    float(provider.home_latitude),
                    float(provider.home_longitude),
                    float(job.service_latitude),
                    float(job.service_longitude),
                ),
                1,
            )

        # Estimated payout
        estimated_payout = None
        if job.quoted_price_cents and job.commission_rate:
            estimated_payout = int(
                job.quoted_price_cents * (1 - float(job.commission_rate))
            )

        offers.append({
            "assignment_id": assignment.id,
            "job_id": job.id,
            "reference_number": job.reference_number,
            "status": assignment.status.value,
            "is_emergency": job.is_emergency,
            "service_address": job.service_address,
            "service_city": job.service_city,
            "service_latitude": job.service_latitude,
            "service_longitude": job.service_longitude,
            "requested_date": job.requested_date,
            "requested_time_start": job.requested_time_start,
            "task": {
                "id": task.id if task else None,
                "name": task.name if task else "Unknown",
                "level": task.level.value if task else "1",
                "category_name": (
                    task.category.name if task and task.category else None
                ),
            },
            "customer": {
                "id": customer.id if customer else None,
                "display_name": (
                    customer.display_name
                    or f"{customer.first_name} {customer.last_name}"
                    if customer
                    else None
                ),
                "rating": customer_rating,
            },
            "pricing": {
                "quoted_price_cents": job.quoted_price_cents,
                "commission_rate": job.commission_rate,
                "estimated_payout_cents": estimated_payout,
                "currency": job.currency,
            },
            "sla": {
                "response_time_min": job.sla_response_time_min,
                "arrival_time_min": job.sla_arrival_time_min,
                "completion_time_min": job.sla_completion_time_min,
            },
            "distance_km": distance_km,
            "offered_at": assignment.offered_at,
            "offer_expires_at": assignment.offer_expires_at,
        })

    return offers


# ---------------------------------------------------------------------------
# Accept / reject offer
# ---------------------------------------------------------------------------

async def accept_offer(
    db: AsyncSession,
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
) -> JobAssignment:
    """Accept a pending job offer.

    Transitions the assignment to ACCEPTED and the job to PENDING_APPROVAL
    so the customer can review the provider before confirming.

    Raises:
        OfferNotFoundError: If no pending offer exists.
        OfferAlreadyRespondedError: If the offer was already handled.
    """
    stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.provider_id == provider_id,
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()

    if assignment is None:
        raise OfferNotFoundError(job_id, provider_id)

    if assignment.status != AssignmentStatus.OFFERED:
        raise OfferAlreadyRespondedError(assignment.id)

    now = datetime.now(timezone.utc)
    assignment.status = AssignmentStatus.ACCEPTED
    assignment.responded_at = now
    assignment.sla_response_met = True  # They responded

    # Update job status to PENDING_APPROVAL (customer must approve)
    job_stmt = select(Job).where(Job.id == job_id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job and job.status in (JobStatus.MATCHED, JobStatus.PENDING_MATCH):
        job.status = JobStatus.PENDING_APPROVAL

    # Cancel all other OFFERED assignments for this job so other providers
    # no longer see it in their offers list.
    cancel_stmt = (
        select(JobAssignment)
        .where(
            JobAssignment.job_id == job_id,
            JobAssignment.provider_id != provider_id,
            JobAssignment.status == AssignmentStatus.OFFERED,
        )
    )
    other_offers = (await db.execute(cancel_stmt)).scalars().all()
    for other in other_offers:
        other.status = AssignmentStatus.REJECTED
        other.responded_at = now

    await db.flush()

    logger.info(
        "Provider %s accepted offer for job %s → PENDING_APPROVAL",
        provider_id,
        job_id,
        assignment.id,
    )

    return assignment


async def reject_offer(
    db: AsyncSession,
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
    reason: Optional[str] = None,
) -> None:
    """Reject a pending job offer.

    Transitions the assignment to DECLINED.  The job remains in its
    current state (matching engine can reassign).

    Raises:
        OfferNotFoundError: If no pending offer exists.
        OfferAlreadyRespondedError: If the offer was already handled.
    """
    stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.provider_id == provider_id,
    )
    result = await db.execute(stmt)
    assignment = result.scalar_one_or_none()

    if assignment is None:
        raise OfferNotFoundError(job_id, provider_id)

    if assignment.status != AssignmentStatus.OFFERED:
        raise OfferAlreadyRespondedError(assignment.id)

    assignment.status = AssignmentStatus.DECLINED
    assignment.responded_at = datetime.now(timezone.utc)
    assignment.decline_reason = reason

    await db.flush()

    logger.info(
        "Provider %s rejected offer for job %s (reason=%s)",
        provider_id,
        job_id,
        reason,
    )


# ---------------------------------------------------------------------------
# Earnings
# ---------------------------------------------------------------------------

async def get_earnings(
    db: AsyncSession,
    provider_id: uuid.UUID,
    period: str = "week",
) -> dict[str, Any]:
    """Calculate provider earnings for a given period.

    Args:
        period: One of 'today', 'week', 'month', 'all'.

    Returns:
        Dict with total, commission, net, jobCount, and jobs list.
    """
    now = datetime.now(timezone.utc)
    period_start = None

    if period == "today":
        period_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
    elif period == "week":
        today_start = now.replace(hour=0, minute=0, second=0, microsecond=0)
        period_start = today_start - timedelta(days=today_start.weekday())
    elif period == "month":
        period_start = now.replace(day=1, hour=0, minute=0, second=0, microsecond=0)
    # 'all' means no date filter

    # Jobs assigned to this provider and completed
    provider_job_ids = (
        select(JobAssignment.job_id)
        .where(
            JobAssignment.provider_id == provider_id,
            JobAssignment.status == AssignmentStatus.COMPLETED,
        )
        .scalar_subquery()
    )

    filters = [
        Job.id.in_(provider_job_ids),
        Job.status == JobStatus.COMPLETED,
    ]
    if period_start is not None:
        filters.append(Job.completed_at >= period_start)

    # Aggregate
    agg_stmt = select(
        func.coalesce(func.sum(Job.final_price_cents), 0).label("total"),
        func.coalesce(func.sum(Job.commission_amount_cents), 0).label("commission"),
        func.coalesce(func.sum(Job.provider_payout_cents), 0).label("net"),
        func.count(Job.id).label("count"),
    ).where(*filters)
    agg = (await db.execute(agg_stmt)).one()

    # Detailed jobs
    jobs_stmt = (
        select(Job)
        .where(*filters)
        .order_by(Job.completed_at.desc())
        .limit(50)
    )
    jobs = (await db.execute(jobs_stmt)).scalars().all()

    return {
        "period": period,
        "total_cents": int(agg.total),
        "commission_cents": int(agg.commission),
        "net_cents": int(agg.net),
        "job_count": int(agg.count),
        "currency": "CAD",
        "jobs": [
            {
                "job_id": j.id,
                "reference_number": j.reference_number,
                "service_city": j.service_city,
                "final_price_cents": j.final_price_cents,
                "commission_cents": j.commission_amount_cents,
                "payout_cents": j.provider_payout_cents,
                "completed_at": j.completed_at,
            }
            for j in jobs
        ],
    }


# ---------------------------------------------------------------------------
# Schedule
# ---------------------------------------------------------------------------

async def get_schedule(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> dict[str, Any]:
    """Get provider's upcoming jobs and on-call shifts.

    Returns:
        Dict with upcoming jobs and shifts lists.
    """
    now = datetime.now(timezone.utc)

    # Upcoming jobs (accepted or en route, not yet completed)
    provider_job_ids = (
        select(JobAssignment.job_id)
        .where(
            JobAssignment.provider_id == provider_id,
            JobAssignment.status == AssignmentStatus.ACCEPTED,
        )
        .scalar_subquery()
    )

    upcoming_stmt = (
        select(Job)
        .options(selectinload(Job.task))
        .where(
            Job.id.in_(provider_job_ids),
            Job.status.in_([
                JobStatus.SCHEDULED,
                JobStatus.PENDING_APPROVAL,
                JobStatus.PROVIDER_ACCEPTED,
                JobStatus.PROVIDER_EN_ROUTE,
                JobStatus.IN_PROGRESS,
            ]),
        )
        .order_by(Job.requested_date.asc().nullslast(), Job.created_at.asc())
        .limit(20)
    )
    upcoming_result = await db.execute(upcoming_stmt)
    upcoming_jobs = upcoming_result.scalars().all()

    upcoming = [
        {
            "job_id": j.id,
            "reference_number": j.reference_number,
            "status": j.status.value,
            "service_address": j.service_address,
            "service_city": j.service_city,
            "requested_date": j.requested_date,
            "requested_time_start": j.requested_time_start,
            "requested_time_end": j.requested_time_end,
            "task_name": j.task.name if j.task else None,
            "is_emergency": j.is_emergency,
        }
        for j in upcoming_jobs
    ]

    # On-call shifts (scheduled or active, not yet ended)
    shifts_stmt = (
        select(OnCallShift)
        .where(
            OnCallShift.provider_id == provider_id,
            OnCallShift.shift_end >= now,
            OnCallShift.status.in_(["scheduled", "active"]),
        )
        .order_by(OnCallShift.shift_start.asc())
        .limit(20)
    )
    shifts_result = await db.execute(shifts_stmt)
    shifts = shifts_result.scalars().all()

    return {
        "upcoming": upcoming,
        "shifts": [
            {
                "id": s.id,
                "shift_start": s.shift_start,
                "shift_end": s.shift_end,
                "region_value": s.region_value,
                "status": s.status.value,
                "shift_rate_cents": s.shift_rate_cents,
            }
            for s in shifts
        ],
    }


# ---------------------------------------------------------------------------
# Credentials
# ---------------------------------------------------------------------------

async def get_credentials(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> dict[str, Any]:
    """Get provider's credentials, insurance policies, and background check status.

    Returns:
        Dict with credentials, insurances, and backgroundCheck.
    """
    # Provider profile (for background check)
    profile_stmt = select(ProviderProfile).where(ProviderProfile.id == provider_id)
    profile = (await db.execute(profile_stmt)).scalar_one_or_none()
    if profile is None:
        raise ProviderNotFoundError(provider_id)

    # Credentials
    creds_stmt = (
        select(ProviderCredential)
        .where(ProviderCredential.provider_id == provider_id)
        .order_by(ProviderCredential.created_at.desc())
    )
    creds = (await db.execute(creds_stmt)).scalars().all()

    # Insurance policies
    insurance_stmt = (
        select(ProviderInsurancePolicy)
        .where(ProviderInsurancePolicy.provider_id == provider_id)
        .order_by(ProviderInsurancePolicy.effective_date.desc())
    )
    insurances = (await db.execute(insurance_stmt)).scalars().all()

    return {
        "credentials": [
            {
                "id": c.id,
                "credential_type": c.credential_type.value,
                "name": c.name,
                "issuing_authority": c.issuing_authority,
                "credential_number": c.credential_number,
                "status": c.status.value,
                "issued_date": c.issued_date,
                "expiry_date": c.expiry_date,
                "verified_at": c.verified_at,
            }
            for c in creds
        ],
        "insurances": [
            {
                "id": i.id,
                "policy_number": i.policy_number,
                "insurer_name": i.insurer_name,
                "policy_type": i.policy_type,
                "coverage_amount_cents": i.coverage_amount_cents,
                "effective_date": i.effective_date,
                "expiry_date": i.expiry_date,
                "status": i.status.value,
                "verified_at": i.verified_at,
            }
            for i in insurances
        ],
        "background_check": {
            "status": profile.background_check_status.value,
            "check_date": profile.background_check_date,
            "expiry_date": profile.background_check_expiry,
            "reference": profile.background_check_ref,
        },
    }


# ---------------------------------------------------------------------------
# Job tracking
# ---------------------------------------------------------------------------

async def get_job_tracking(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    """Get real-time tracking info for a job.

    Returns provider location, ETA, and current status.  In production this
    would read from Redis / a location stream.  For MVP, returns the
    provider's last known location from the user record.
    """
    # Load job
    job_stmt = select(Job).where(Job.id == job_id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        return {
            "provider_lat": None,
            "provider_lng": None,
            "eta_minutes": None,
            "status": "unknown",
            "provider_name": None,
            "updated_at": None,
        }

    # Find active assignment
    assignment_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status.in_([
            AssignmentStatus.ACCEPTED,
            AssignmentStatus.COMPLETED,
        ]),
    )
    assignment = (await db.execute(assignment_stmt)).scalar_one_or_none()

    # Fallback: if no ACCEPTED/COMPLETED, try OFFERED (provider not yet accepted
    # but was offered the job)
    if assignment is None:
        offered_stmt = (
            select(JobAssignment)
            .where(
                JobAssignment.job_id == job_id,
                JobAssignment.status == AssignmentStatus.OFFERED,
            )
            .order_by(JobAssignment.match_score.desc().nullslast())
            .limit(1)
        )
        assignment = (await db.execute(offered_stmt)).scalar_one_or_none()

    provider_lat = None
    provider_lng = None
    eta_minutes = None
    provider_name = None
    provider_phone = None
    provider_level = None

    if assignment is not None:
        # Load provider + user
        provider_stmt = (
            select(ProviderProfile)
            .options(selectinload(ProviderProfile.user))
            .where(ProviderProfile.id == assignment.provider_id)
        )
        provider = (await db.execute(provider_stmt)).scalar_one_or_none()

        if provider and provider.user:
            provider_name = (
                provider.user.display_name
                or f"{provider.user.first_name} {provider.user.last_name}"
            )
            provider_phone = provider.user.phone
            provider_level = provider.current_level.value if hasattr(provider.current_level, 'value') else str(provider.current_level)

            # Use user's last known location (in production: Redis location stream)
            if provider.user.last_latitude is not None:
                provider_lat = provider.user.last_latitude
                provider_lng = provider.user.last_longitude

                # Rough ETA based on distance
                distance = haversine_distance(
                    float(provider_lat),
                    float(provider_lng),
                    float(job.service_latitude),
                    float(job.service_longitude),
                )
                # Assume average 40 km/h in urban areas
                eta_minutes = max(1, int(distance / 40 * 60))
            elif assignment.estimated_arrival_min:
                eta_minutes = assignment.estimated_arrival_min

    return {
        "provider_lat": provider_lat,
        "provider_lng": provider_lng,
        "eta_minutes": eta_minutes,
        "status": job.status.value,
        "provider_name": provider_name,
        "provider_phone": provider_phone,
        "provider_level": provider_level,
        "updated_at": datetime.now(timezone.utc),
    }


async def update_provider_location(
    db: AsyncSession,
    user_id: uuid.UUID,
    latitude: float,
    longitude: float,
) -> None:
    """Store provider's current GPS position on their User record.

    In production this would write to Redis. For MVP we store on the
    User model so that ``get_job_tracking`` can read it back.
    """
    stmt = select(User).where(User.id == user_id)
    user = (await db.execute(stmt)).scalar_one_or_none()
    if user is None:
        return
    user.last_latitude = latitude
    user.last_longitude = longitude
    await db.flush()
