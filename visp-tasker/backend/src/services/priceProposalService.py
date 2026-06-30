"""
Price Proposal Service -- VISP-BE-PRICING-006
=============================================

Handles the price negotiation lifecycle for L3/L4 jobs:
- Creating initial price proposals (provider or platform)
- Customer accept / reject responses
- On-site scope-change adjustments that supersede previous proposals
- Listing all proposals for a job

All price negotiation activity is logged via PricingEvent for auditing.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from typing import Optional

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    Job,
    JobStatus,
    PriceProposal,
    PricingEvent,
    PricingEventType,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _log_pricing_event(
    db: AsyncSession,
    *,
    job: Job,
    event_type: PricingEventType,
    price_cents: int,
    calculated_by: str,
) -> None:
    """Insert an immutable pricing event audit record."""
    event = PricingEvent(
        job_id=job.id,
        event_type=event_type,
        base_price_cents=price_cents,
        multiplier_applied=1,
        adjustments_cents=0,
        final_price_cents=price_cents,
        rules_applied_json=[],
        currency=job.currency,
        calculated_by=calculated_by,
    )
    db.add(event)
    # flush so the record gets a PK but we stay within the caller's transaction
    await db.flush()


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------

async def create_price_proposal(
    db: AsyncSession,
    job_id: uuid.UUID,
    proposer_id: uuid.UUID,
    proposed_by_role: str,
    proposed_price_cents: int,
    description: Optional[str] = None,
) -> PriceProposal:
    """Provider or platform proposes a price for an L3/L4 job.

    The job must exist and be in PENDING_PRICE_AGREEMENT status before a
    proposal can be created.

    Args:
        db: Async database session.
        job_id: UUID of the target job.
        proposer_id: UUID of the user submitting the proposal.
        proposed_by_role: Role of the proposer ('provider' or 'platform').
        proposed_price_cents: Proposed price in cents.
        description: Optional human-readable explanation.

    Returns:
        The newly-created PriceProposal ORM instance.

    Raises:
        ValueError: If the job does not exist or is not negotiable.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job {job_id} not found")
    if job.status != JobStatus.PENDING_PRICE_AGREEMENT:
        raise ValueError(
            f"Job {job_id} is not in PENDING_PRICE_AGREEMENT status "
            f"(current: {job.status})"
        )

    proposal = PriceProposal(
        job_id=job_id,
        proposed_by_id=proposer_id,
        proposed_by_role=proposed_by_role,
        proposed_price_cents=proposed_price_cents,
        description=description,
        status="pending",
    )
    db.add(proposal)
    await db.flush()

    await _log_pricing_event(
        db,
        job=job,
        event_type=PricingEventType.PRICE_PROPOSED,
        price_cents=proposed_price_cents,
        calculated_by=str(proposer_id),
    )

    logger.info(
        "Price proposal created: job=%s, proposal=%s, price=%d, role=%s",
        job_id,
        proposal.id,
        proposed_price_cents,
        proposed_by_role,
    )
    return proposal


async def respond_to_proposal(
    db: AsyncSession,
    proposal_id: uuid.UUID,
    responder_id: uuid.UUID,
    accept: bool,
) -> PriceProposal:
    """Customer accepts or rejects a pending price proposal.

    If accepted:
      - Proposal status → 'accepted'
      - Job.proposed_price_cents is updated
      - Job.price_agreed_at is set
      - Job status transitions from PENDING_PRICE_AGREEMENT → SCHEDULED
      - PRICE_ACCEPTED PricingEvent is logged

    If rejected:
      - Proposal status → 'rejected'

    Args:
        db: Async database session.
        proposal_id: UUID of the proposal to respond to.
        responder_id: UUID of the responding user (must be the customer).
        accept: True to accept, False to reject.

    Returns:
        Updated PriceProposal ORM instance.

    Raises:
        ValueError: If proposal not found or not in 'pending' status.
    """
    result = await db.execute(
        select(PriceProposal).where(PriceProposal.id == proposal_id)
    )
    proposal = result.scalar_one_or_none()
    if proposal is None:
        raise ValueError(f"Proposal {proposal_id} not found")
    if proposal.status != "pending":
        raise ValueError(
            f"Proposal {proposal_id} is not pending (current: {proposal.status})"
        )

    now = datetime.now(tz=timezone.utc)
    new_status = "accepted" if accept else "rejected"
    proposal.status = new_status
    proposal.responded_at = now
    proposal.response_by_id = responder_id
    await db.flush()

    if accept:
        job_result = await db.execute(select(Job).where(Job.id == proposal.job_id))
        job = job_result.scalar_one_or_none()
        if job is None:
            raise ValueError(f"Job {proposal.job_id} not found")

        job.proposed_price_cents = proposal.proposed_price_cents
        job.price_agreed_at = now
        job.status = JobStatus.SCHEDULED
        await db.flush()

        await _log_pricing_event(
            db,
            job=job,
            event_type=PricingEventType.PRICE_ACCEPTED,
            price_cents=proposal.proposed_price_cents,
            calculated_by=str(responder_id),
        )

        logger.info(
            "Proposal accepted: proposal=%s, job=%s, price=%d",
            proposal_id,
            proposal.job_id,
            proposal.proposed_price_cents,
        )
    else:
        logger.info(
            "Proposal rejected: proposal=%s, job=%s",
            proposal_id,
            proposal.job_id,
        )

    return proposal


async def create_price_adjustment(
    db: AsyncSession,
    job_id: uuid.UUID,
    proposer_id: uuid.UUID,
    new_price_cents: int,
    reason: str,
) -> PriceProposal:
    """On-site scope change for L3/L4 — creates a new proposal superseding previous.

    Any existing accepted proposals for the job are marked 'superseded'.
    The job status is reset to PENDING_PRICE_AGREEMENT so the customer must
    re-approve the new price.

    Args:
        db: Async database session.
        job_id: UUID of the in-progress job.
        proposer_id: UUID of the provider requesting the adjustment.
        new_price_cents: New proposed price in cents.
        reason: Human-readable reason for the adjustment.

    Returns:
        The newly-created PriceProposal ORM instance.

    Raises:
        ValueError: If the job does not exist.
    """
    result = await db.execute(select(Job).where(Job.id == job_id))
    job = result.scalar_one_or_none()
    if job is None:
        raise ValueError(f"Job {job_id} not found")

    # Mark existing accepted/pending proposals as superseded
    await db.execute(
        update(PriceProposal)
        .where(
            PriceProposal.job_id == job_id,
            PriceProposal.status.in_(["accepted", "pending"]),
        )
        .values(status="superseded")
    )

    # Reset job status so customer must approve the new price
    job.status = JobStatus.PENDING_PRICE_AGREEMENT
    await db.flush()

    proposal = PriceProposal(
        job_id=job_id,
        proposed_by_id=proposer_id,
        proposed_by_role="provider",
        proposed_price_cents=new_price_cents,
        description=reason,
        status="pending",
    )
    db.add(proposal)
    await db.flush()

    await _log_pricing_event(
        db,
        job=job,
        event_type=PricingEventType.PRICE_PROPOSED,
        price_cents=new_price_cents,
        calculated_by=str(proposer_id),
    )

    logger.info(
        "Price adjustment created: job=%s, proposal=%s, new_price=%d",
        job_id,
        proposal.id,
        new_price_cents,
    )
    return proposal


async def get_proposals_for_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> list[PriceProposal]:
    """List all proposals for a job, ordered newest first.

    Args:
        db: Async database session.
        job_id: UUID of the job.

    Returns:
        List of PriceProposal ORM instances (may be empty).
    """
    result = await db.execute(
        select(PriceProposal)
        .where(PriceProposal.job_id == job_id)
        .order_by(PriceProposal.created_at.desc())
    )
    return list(result.scalars().all())
