"""
Tip Service -- VISP-BE-PRICING-006
===================================

Handles tip creation and confirmation for completed jobs.

Tips are added by customers after a job is marked COMPLETED.

Hasta el 2026-10-23 la propina solo se APUNTABA (status 'pending', sin cobro en
Stripe): el cliente creía que la había dado y el proveedor nunca la recibía.
Ahora `add_tip` la cobra en el acto a la tarjeta guardada del cliente, entera al
proveedor, y solo la registra como pagada si Stripe la confirma.
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

# Mínimo de propina. Stripe no cobra menos de $0.50 CAD, y una propina de céntimos
# le cuesta a VISP más en comisión de Stripe de lo que vale.
MIN_TIP_CENTS = 100


async def add_tip(
    db: AsyncSession,
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    amount_cents: int,
    *,
    customer_stripe_id: Optional[str] = None,
    payment_method: Optional[str] = None,
) -> Tip:
    """Add a tip for a completed job and charge it.

    Verifies that the job exists, is COMPLETED, and belongs to the requesting
    customer; charges the tip to the customer's saved card (all of it to the
    provider); and only then records it as 'paid', updates job.tip_cents /
    tip_paid_at and logs a TIP_ADDED PricingEvent. Any failure raises before
    anything is committed.

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
    if amount_cents < MIN_TIP_CENTS:
        raise ValueError(f"The minimum tip is ${MIN_TIP_CENTS / 100:.2f}.")
    if not customer_stripe_id or not payment_method:
        raise ValueError("Add a payment card in your profile to leave a tip.")

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

    from src.integrations.stripe import PaymentError, charge_tip
    from src.services import job_payment_service

    destination = await job_payment_service._resolve_destination_account(db, job)
    if not destination:
        raise ValueError("This provider can't receive tips yet.")

    # Una propina por trabajo (idx_tips_job_unique). Si ya hay una COBRADA, no se
    # repite. Si hay una 'pending' es de antes del 2026-10-23, cuando solo se
    # apuntaban y nunca se cobraban: se reutiliza esa fila y ahora sí se cobra.
    tip = (
        await db.execute(select(Tip).where(Tip.job_id == job_id))
    ).scalar_one_or_none()
    if tip is not None and tip.status == "paid":
        raise ValueError("You already left a tip for this job.")
    if tip is None:
        tip = Tip(
            job_id=job_id,
            customer_id=customer_id,
            provider_id=assignment.provider_id,
            amount_cents=amount_cents,
            status="pending",
        )
        db.add(tip)
    else:
        tip.amount_cents = amount_cents
        tip.provider_id = assignment.provider_id
    await db.flush()

    # El cobro va ANTES de dar la propina por buena. Si Stripe la rechaza se
    # lanza el error y la transacción de la petición se deshace: no queda una
    # propina "pendiente" que el proveedor vería y nunca cobraría.
    try:
        intent_id = await charge_tip(
            tip.id,
            job_id,
            amount_cents,
            destination,
            customer_stripe_id=customer_stripe_id,
            payment_method=payment_method,
            currency=(job.currency or "cad"),
        )
    except PaymentError as exc:
        raise ValueError(f"Your tip couldn't be charged: {exc.message}") from exc

    now = datetime.now(timezone.utc)
    tip.status = "paid"
    tip.paid_at = now
    tip.stripe_payment_intent_id = intent_id

    # Una propina por trabajo: el total es ESTA, no se suma a la 'pending' vieja
    # (que nunca se cobró).
    job.tip_cents = amount_cents
    job.tip_paid_at = now
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
