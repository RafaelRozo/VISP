"""
Tip Service -- VISP-BE-PRICING-006
===================================

Handles tip creation and confirmation for completed jobs.

Tips are added by customers after a job is marked COMPLETED.
After a Stripe payment succeeds, confirm_tip marks the tip as paid.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    Job,
    JobStatus,
    PricingEvent,
    PricingEventType,
    Tip,
)

logger = logging.getLogger(__name__)


async def add_tip(
    db: AsyncSession,
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    amount_cents: int,
) -> Tip:
    """Add a tip for a completed job.

    Verifies that the job exists, is COMPLETED, and belongs to the requesting
    customer. Creates a Tip record with status='pending' and logs a TIP_ADDED
    PricingEvent. Updates job.tip_cents.

    Args:
        db: Async database session.
        job_id: UUID of the completed job.
        customer_id: UUID of the customer adding the tip.
        amount_cents: Tip amount in cents.

    Returns:
        The newly-created Tip ORM instance.

    Raises:
        ValueError: If the job is not found, not completed, or belongs to
                    a different customer.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job {job_id} not found")
    if job.status != JobStatus.COMPLETED:
        raise ValueError(
            f"Tips can only be added to completed jobs "
            f"(job {job_id} status: {job.status})"
        )
    if job.customer_id != customer_id:
        raise ValueError("You are not the customer for this job")

    # Resolve provider_id from the accepted assignment
    from src.models import JobAssignment, AssignmentStatus

    assignment_result = await db.execute(
        select(JobAssignment)
        .where(
            JobAssignment.job_id == job_id,
            JobAssignment.status == AssignmentStatus.COMPLETED,
        )
        .limit(1)
    )
    assignment = assignment_result.scalar_one_or_none()
    if assignment is None:
        raise ValueError(
            f"No completed assignment found for job {job_id}; cannot add tip"
        )

    tip = Tip(
        job_id=job_id,
        customer_id=customer_id,
        provider_id=assignment.provider_id,
        amount_cents=amount_cents,
        status="pending",
    )
    db.add(tip)
    await db.flush()

    # Update the job's tip aggregate
    job.tip_cents = (job.tip_cents or 0) + amount_cents
    await db.flush()

    # Log pricing event
    event = PricingEvent(
        job_id=job_id,
        event_type=PricingEventType.TIP_ADDED,
        base_price_cents=amount_cents,
        multiplier_applied=1,
        adjustments_cents=0,
        final_price_cents=amount_cents,
        rules_applied_json=[],
        currency=job.currency,
        calculated_by=str(customer_id),
    )
    db.add(event)
    await db.flush()

    logger.info(
        "Tip created: job=%s, tip=%s, amount=%d cents",
        job_id,
        tip.id,
        amount_cents,
    )
    return tip


async def confirm_tip(db: AsyncSession, tip_id: uuid.UUID) -> Tip:
    """Mark a tip as paid after Stripe payment succeeds.

    Updates the tip status to 'paid', sets paid_at, and records
    job.tip_paid_at.

    Args:
        db: Async database session.
        tip_id: UUID of the tip to confirm.

    Returns:
        Updated Tip ORM instance.

    Raises:
        ValueError: If the tip is not found or is not in 'pending' status.
    """
    result = await db.execute(select(Tip).where(Tip.id == tip_id))
    tip = result.scalar_one_or_none()
    if tip is None:
        raise ValueError(f"Tip {tip_id} not found")
    if tip.status != "pending":
        raise ValueError(
            f"Tip {tip_id} is not pending (current: {tip.status})"
        )

    now = datetime.now(tz=timezone.utc)
    tip.status = "paid"
    tip.paid_at = now
    await db.flush()

    job_result = await db.execute(select(Job).where(Job.id == tip.job_id))
    job = job_result.scalar_one_or_none()
    if job is not None:
        job.tip_paid_at = now
        await db.flush()

    logger.info("Tip confirmed as paid: tip=%s, job=%s", tip_id, tip.job_id)
    return tip


async def get_tip_for_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Optional[Tip]:
    """Return the most recent tip for a job, or None if no tip exists.

    Args:
        db: Async database session.
        job_id: UUID of the job.

    Returns:
        Tip ORM instance or None.
    """
    result = await db.execute(
        select(Tip)
        .where(Tip.job_id == job_id)
        .order_by(Tip.created_at.desc())
        .limit(1)
    )
    return result.scalar_one_or_none()
