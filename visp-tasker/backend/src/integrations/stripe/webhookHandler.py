"""
Stripe Webhook Handler -- VISP-INT-PAYMENTS-002
=================================================

Processes inbound Stripe webhook events with:
- Signature verification using STRIPE_WEBHOOK_SECRET
- Idempotent event processing (tracks processed event IDs in-memory with
  optional Redis extension)
- Structured handling for all payment-related event types
- Executes commission split and provider transfers on payment success
- Reverses transfers on refunds

Supported event types:
  - payment_intent.succeeded
  - payment_intent.payment_failed
  - charge.refunded
  - account.updated
  - transfer.created
  - payout.paid
  - payout.failed

Events not in the handled set are acknowledged but not processed.
"""

from __future__ import annotations

import logging
import os
import time
import uuid
from collections import OrderedDict
from dataclasses import dataclass
from datetime import datetime, timezone
from threading import Lock

import stripe
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

logger = logging.getLogger(__name__)

STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")

# ---------------------------------------------------------------------------
# Idempotency store
# ---------------------------------------------------------------------------
# In-memory LRU set of processed event IDs to prevent duplicate processing.
# In production, this should be backed by Redis or the database for
# multi-instance deployments. The LRU eviction prevents unbounded memory
# growth.

_MAX_PROCESSED_EVENTS = 10_000
_processed_events: OrderedDict[str, float] = OrderedDict()
_processed_lock = Lock()


def _mark_event_processed(event_id: str) -> None:
    """Record that an event has been processed."""
    with _processed_lock:
        _processed_events[event_id] = time.time()
        # Evict oldest entries if over capacity
        while len(_processed_events) > _MAX_PROCESSED_EVENTS:
            _processed_events.popitem(last=False)


def _is_event_processed(event_id: str) -> bool:
    """Check if an event has already been processed."""
    with _processed_lock:
        return event_id in _processed_events


def clear_processed_events() -> None:
    """Clear the processed events store. Useful for testing."""
    with _processed_lock:
        _processed_events.clear()


# ---------------------------------------------------------------------------
# Response dataclass
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class WebhookResult:
    """Result of processing a webhook event."""
    event_type: str
    processed: bool
    message: str


# ---------------------------------------------------------------------------
# Event handlers
# ---------------------------------------------------------------------------

async def _handle_payment_intent_succeeded(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a successful payment.

    When a PaymentIntent succeeds, the platform should:
    1. Update the job's paid_at timestamp
    2. Initiate the provider transfer (commission split)
    3. Send confirmation notifications to customer and provider
    """
    payment_intent = event.data.object
    job_id_str = payment_intent.metadata.get("job_id", "")
    amount = payment_intent.amount
    currency = payment_intent.currency

    logger.info(
        "Payment succeeded: intent=%s, job_id=%s, amount=%d %s",
        payment_intent.id,
        job_id_str,
        amount,
        currency,
    )

    if not db or not job_id_str:
        return (
            f"Payment intent {payment_intent.id} succeeded for job {job_id_str}: "
            f"{amount} {currency} (no DB session or job_id — skipping transfer)"
        )

    # Lazy imports to avoid circular dependencies
    from src.models.job import Job, JobAssignment, AssignmentStatus
    from src.models.provider import ProviderProfile

    try:
        job_uuid = uuid.UUID(job_id_str)
    except ValueError:
        return f"Invalid job_id in metadata: {job_id_str}"

    # 1. Fetch the job
    job = await db.get(Job, job_uuid)
    if not job:
        logger.warning("Job %s not found for payment_intent %s", job_id_str, payment_intent.id)
        return f"Job {job_id_str} not found"

    # 2. Update job payment fields
    job.stripe_payment_intent_id = payment_intent.id
    job.paid_at = datetime.now(timezone.utc)
    job.final_price_cents = amount

    # 2b. PP4b — destination charges (manual-capture) already routed funds to the
    # connected account via transfer_data and took the application_fee at capture.
    # Do NOT create a second legacy Transfer (that would double-pay the provider).
    if str(payment_intent.metadata.get("destination_charge", "")) == "1":
        await db.flush()
        logger.info(
            "Destination-charge payment %s captured for job %s — funds routed via "
            "transfer_data, skipping legacy transfer.",
            payment_intent.id, job_id_str,
        )
        return (
            f"Destination-charge payment {payment_intent.id} captured for job "
            f"{job_id_str}: {amount} {currency}. Funds routed via transfer_data; "
            f"no separate transfer created."
        )

    # 3. Find the assigned provider
    assignment_result = await db.execute(
        select(JobAssignment)
        .where(JobAssignment.job_id == job_uuid)
        .where(JobAssignment.status == AssignmentStatus.ACCEPTED)
        .limit(1)
    )
    assignment = assignment_result.scalar_one_or_none()

    if not assignment:
        logger.info("No accepted assignment for job %s — transfer deferred", job_id_str)
        await db.flush()
        return (
            f"Payment recorded for job {job_id_str}: {amount} {currency}. "
            f"No provider assigned yet — transfer will be created when provider is assigned."
        )

    # 4. Get provider's Stripe Connect account
    provider = await db.get(ProviderProfile, assignment.provider_id)
    if not provider or not provider.stripe_account_id:
        logger.warning(
            "Provider %s has no Stripe account for job %s",
            assignment.provider_id,
            job_id_str,
        )
        await db.flush()
        return (
            f"Payment recorded for job {job_id_str}. "
            f"Provider has no Stripe Connect account — transfer pending onboarding."
        )

    # 5. Calculate commission split
    commission_rate = float(job.commission_rate) if job.commission_rate else 0.20
    commission_cents = int(amount * commission_rate)
    provider_amount_cents = amount - commission_cents

    job.commission_amount_cents = commission_cents
    job.provider_payout_cents = provider_amount_cents

    # 5b. VISP for Business (SP4): if this job was claimed by a company, the
    # payout goes to the COMPANY's connected account instead of the individual
    # provider's. This is an additive branch — when the job is NOT a company
    # assignment, resolve_payout_account returns None and the destination stays
    # exactly as the provider path computed it (behavior unchanged).
    transfer_destination = provider.stripe_account_id
    try:
        from src.services import company_assignment_service

        company_account = await company_assignment_service.resolve_payout_account(
            db, job_uuid
        )
        if company_account:
            transfer_destination = company_account
            logger.info(
                "Job %s is a company assignment — routing payout to company account %s",
                job_id_str,
                company_account,
            )
    except Exception:  # noqa: BLE001 — never let the company branch break provider payouts
        logger.exception(
            "Company payout resolution failed for job %s — falling back to provider account",
            job_id_str,
        )

    # 6. Create transfer to the resolved connected account
    if provider_amount_cents > 0:
        try:
            transfer = stripe.Transfer.create(
                amount=provider_amount_cents,
                currency=currency,
                destination=transfer_destination,
                transfer_group=f"job_{job_id_str}",
                metadata={
                    "job_id": job_id_str,
                    "commission_cents": str(commission_cents),
                    "commission_rate": str(commission_rate),
                    "provider_id": str(assignment.provider_id),
                },
            )
            logger.info(
                "Transfer created: id=%s, job=%s, provider_amount=%d, commission=%d",
                transfer.id,
                job_id_str,
                provider_amount_cents,
                commission_cents,
            )
        except stripe.StripeError as exc:
            logger.error(
                "Failed to create transfer for job %s: %s",
                job_id_str,
                str(exc),
            )
            await db.flush()
            return (
                f"Payment recorded for job {job_id_str} but transfer failed: {str(exc)}"
            )

    await db.flush()

    return (
        f"Payment {payment_intent.id} succeeded for job {job_id_str}: "
        f"{amount} {currency}. Transfer: {provider_amount_cents} to provider, "
        f"{commission_cents} commission ({commission_rate*100:.0f}%)"
    )


async def _handle_payment_intent_failed(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a failed payment attempt."""
    payment_intent = event.data.object
    job_id = payment_intent.metadata.get("job_id", "unknown")

    last_error = payment_intent.last_payment_error
    error_message = "Unknown error"
    if last_error:
        error_message = getattr(last_error, "message", str(last_error))

    logger.warning(
        "Payment failed: intent=%s, job_id=%s, error=%s",
        payment_intent.id,
        job_id,
        error_message,
    )

    return (
        f"Payment intent {payment_intent.id} failed for job {job_id}: "
        f"{error_message}"
    )


async def _handle_payment_intent_amount_capturable_updated(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """PP4b — a manual-capture authorization succeeded (the customer confirmed
    the hold). Funds are HELD, not captured. Record the held PaymentIntent on the
    job so completion can capture it. No transfer happens until capture."""
    payment_intent = event.data.object
    job_id_str = payment_intent.metadata.get("job_id", "")
    capturable = getattr(payment_intent, "amount_capturable", 0)

    logger.info(
        "Authorization held: intent=%s, job_id=%s, capturable=%d %s",
        payment_intent.id, job_id_str, capturable, payment_intent.currency,
    )

    if db and job_id_str:
        from src.models.job import Job

        try:
            job = await db.get(Job, uuid.UUID(job_id_str))
        except ValueError:
            job = None
        if job is not None:
            job.stripe_payment_intent_id = payment_intent.id
            await db.flush()

    return (
        f"Authorization held for job {job_id_str}: {capturable} "
        f"{payment_intent.currency} capturable on intent {payment_intent.id}."
    )


async def _handle_charge_refunded(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a charge refund event.

    When a charge is refunded, the platform should:
    1. Update the job status to 'refunded' if full refund
    2. Reverse or adjust the provider transfer if applicable
    """
    charge = event.data.object
    amount_refunded = charge.amount_refunded
    payment_intent_id = charge.payment_intent

    logger.info(
        "Charge refunded: charge=%s, payment_intent=%s, refunded=%d",
        charge.id,
        payment_intent_id,
        amount_refunded,
    )

    if not db or not payment_intent_id:
        return (
            f"Charge {charge.id} refunded: {amount_refunded} cents "
            f"(payment_intent={payment_intent_id}) — no DB, skipping reversal"
        )

    from src.models.job import Job, JobStatus

    # Find job by payment intent
    result = await db.execute(
        select(Job).where(Job.stripe_payment_intent_id == payment_intent_id).limit(1)
    )
    job = result.scalar_one_or_none()

    if not job:
        logger.warning("No job found for payment_intent %s during refund", payment_intent_id)
        return f"Charge {charge.id} refunded but no matching job found"

    # Determine if full refund
    is_full_refund = charge.refunded  # True if fully refunded

    # Reverse the provider transfer if one was made
    if job.provider_payout_cents and job.provider_payout_cents > 0:
        try:
            # Find transfers for this job
            transfers = stripe.Transfer.list(
                transfer_group=f"job_{job.id}",
                limit=1,
            )
            if transfers.data:
                original_transfer = transfers.data[0]
                # Calculate reversal amount proportional to refund
                if is_full_refund:
                    reversal_amount = original_transfer.amount
                else:
                    # Proportional reversal
                    refund_ratio = amount_refunded / charge.amount if charge.amount else 0
                    reversal_amount = int(original_transfer.amount * refund_ratio)

                if reversal_amount > 0:
                    stripe.Transfer.create_reversal(
                        original_transfer.id,
                        amount=reversal_amount,
                        metadata={
                            "job_id": str(job.id),
                            "reason": "customer_refund",
                            "charge_id": charge.id,
                        },
                    )
                    logger.info(
                        "Transfer reversal created: transfer=%s, amount=%d, job=%s",
                        original_transfer.id,
                        reversal_amount,
                        job.id,
                    )
        except stripe.StripeError as exc:
            logger.error(
                "Failed to reverse transfer for job %s: %s",
                job.id,
                str(exc),
            )

    if is_full_refund:
        job.status = JobStatus.REFUNDED

    await db.flush()

    return (
        f"Charge {charge.id} refunded: {amount_refunded} cents "
        f"(job={job.id}, full={'yes' if is_full_refund else 'no'})"
    )


async def _handle_account_updated(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a connected account update.

    Persist the refreshed requirements / capabilities / onboarding step on
    the matching ``provider_profiles`` row so the mobile app's polling of
    ``/v2/status`` reflects the new state immediately. Also fires when an
    admin manually approves a Stripe Identity verification session in test
    mode — the connected account's ``payouts_enabled`` will flip to True
    once Stripe propagates the verification.
    """
    account = event.data.object
    charges_enabled = bool(getattr(account, "charges_enabled", False))
    payouts_enabled = bool(getattr(account, "payouts_enabled", False))
    details_submitted = bool(getattr(account, "details_submitted", False))

    if db is None:
        logger.warning("account.updated received without DB session — skipping persist")
        return f"Account {account.id} updated (no db)"

    # Lazy imports to avoid circular dependency with connectV2Service.
    from sqlalchemy import select
    from src.models.provider import ProviderProfile
    from src.integrations.stripe.connectV2Service import (
        _next_step,
        _extract_requirements_due,
        _extract_capabilities,
    )

    stmt = select(ProviderProfile).where(ProviderProfile.stripe_account_id == account.id)
    profile = (await db.execute(stmt)).scalar_one_or_none()
    if profile is None:
        logger.warning("account.updated for %s but no ProviderProfile matched", account.id)
        return f"Account {account.id} updated (no profile)"

    requirements_due = _extract_requirements_due(account)
    capabilities = _extract_capabilities(account)
    onboarding_step = _next_step(requirements_due)

    profile.stripe_requirements_due = requirements_due
    profile.stripe_capabilities = capabilities
    profile.stripe_onboarding_step = onboarding_step
    await db.commit()

    logger.info(
        "Account updated and persisted: account=%s provider=%s step=%s "
        "payouts_enabled=%s details_submitted=%s requirements_due=%d",
        account.id, profile.id, onboarding_step,
        payouts_enabled, details_submitted, len(requirements_due),
    )

    return (
        f"Account {account.id} → step={onboarding_step} "
        f"payouts={payouts_enabled} requirements={len(requirements_due)}"
    )


async def _handle_identity_verification_verified(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Identity Verification Session reached the ``verified`` state.

    Stripe propagates the verification to the linked connected account
    asynchronously, so the matching ``account.updated`` event (handled
    above) is what actually flips ``payouts_enabled``. This handler is
    informational + a safety net: it re-fetches the connected account from
    Stripe and forces a status refresh in case the ``account.updated``
    event is delayed or missed.
    """
    session = event.data.object
    session_id = getattr(session, "id", "?")
    metadata = getattr(session, "metadata", None) or {}
    account_id = (metadata.get("stripe_account_id") if hasattr(metadata, "get") else None) or ""

    logger.info(
        "identity.verification_session.verified: session=%s account=%s",
        session_id, account_id,
    )

    if not account_id or db is None:
        return f"verification verified session={session_id} account={account_id or 'unknown'}"

    # Attach the verified Identity document onto the connected account so Stripe
    # clears individual.verification.{document,proof_of_liveness}. Without this
    # the requirement stays past_due and the wizard loops on "Continue setup".
    from src.integrations.stripe.connectV2Service import (
        attach_verified_identity_document,
    )

    try:
        await attach_verified_identity_document(account_id, session_id)
    except Exception:  # noqa: BLE001 — never let the webhook fail on the attach
        logger.exception("attach verified document failed for account %s", account_id)

    # Refresh the connected account so any unprocessed account.updated
    # webhook does not leave the profile stale.
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        logger.warning("Could not retrieve %s after verification: %s", account_id, exc)
        return f"verification verified session={session_id} (retrieve failed)"

    from sqlalchemy import select
    from src.models.provider import ProviderProfile
    from src.integrations.stripe.connectV2Service import (
        _next_step,
        _extract_requirements_due,
        _extract_capabilities,
    )

    stmt = select(ProviderProfile).where(ProviderProfile.stripe_account_id == account_id)
    profile = (await db.execute(stmt)).scalar_one_or_none()
    if profile is None:
        return f"verification verified session={session_id} (no profile)"

    requirements_due = _extract_requirements_due(account)
    profile.stripe_requirements_due = requirements_due
    profile.stripe_capabilities = _extract_capabilities(account)
    profile.stripe_onboarding_step = _next_step(requirements_due)
    await db.commit()

    return f"verification verified session={session_id} step={profile.stripe_onboarding_step}"


async def _handle_transfer_created(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a transfer creation event."""
    transfer = event.data.object
    job_id = transfer.metadata.get("job_id", "unknown")

    logger.info(
        "Transfer created: id=%s, job_id=%s, amount=%d %s, destination=%s",
        transfer.id,
        job_id,
        transfer.amount,
        transfer.currency,
        transfer.destination,
    )

    return (
        f"Transfer {transfer.id} created for job {job_id}: "
        f"{transfer.amount} {transfer.currency}"
    )


async def _handle_payout_paid(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a successful payout to a provider's bank account."""
    payout = event.data.object

    logger.info(
        "Payout paid: id=%s, amount=%d %s, status=%s",
        payout.id,
        payout.amount,
        payout.currency,
        payout.status,
    )

    return f"Payout {payout.id} paid: {payout.amount} {payout.currency}"


async def _handle_payout_failed(
    event: stripe.Event,
    db: AsyncSession | None = None,
) -> str:
    """Handle a failed payout."""
    payout = event.data.object
    failure_code = payout.failure_code
    failure_message = payout.failure_message

    logger.error(
        "Payout failed: id=%s, amount=%d %s, code=%s, message=%s",
        payout.id,
        payout.amount,
        payout.currency,
        failure_code,
        failure_message,
    )

    return (
        f"Payout {payout.id} failed: {failure_code} - {failure_message}"
    )


# ---------------------------------------------------------------------------
# Handler dispatch table
# ---------------------------------------------------------------------------

_EVENT_HANDLERS: dict[str, callable] = {
    "payment_intent.succeeded": _handle_payment_intent_succeeded,
    "payment_intent.payment_failed": _handle_payment_intent_failed,
    "payment_intent.amount_capturable_updated": _handle_payment_intent_amount_capturable_updated,
    "charge.refunded": _handle_charge_refunded,
    "account.updated": _handle_account_updated,
    "identity.verification_session.verified": _handle_identity_verification_verified,
    "transfer.created": _handle_transfer_created,
    "payout.paid": _handle_payout_paid,
    "payout.failed": _handle_payout_failed,
}


# ---------------------------------------------------------------------------
# Public API
# ---------------------------------------------------------------------------

async def handle_webhook(
    payload: bytes,
    sig_header: str,
    db: AsyncSession | None = None,
) -> WebhookResult:
    """Verify and process an inbound Stripe webhook event.

    Steps:
    1. Verify the webhook signature against STRIPE_WEBHOOK_SECRET
    2. Check idempotency (skip if event already processed)
    3. Dispatch to the appropriate handler based on event type
    4. Mark the event as processed

    Args:
        payload: The raw request body bytes from the webhook POST.
        sig_header: The ``Stripe-Signature`` header value.
        db: Optional async database session for handlers that need DB access.

    Returns:
        WebhookResult indicating what happened.

    Raises:
        ValueError: If the webhook signature verification fails.
    """
    # 1. Verify signature
    try:
        event = stripe.Webhook.construct_event(
            payload=payload,
            sig_header=sig_header,
            secret=STRIPE_WEBHOOK_SECRET,
        )
    except stripe.SignatureVerificationError as exc:
        logger.warning("Webhook signature verification failed: %s", str(exc))
        raise ValueError(f"Invalid webhook signature: {str(exc)}") from exc
    except ValueError as exc:
        logger.warning("Webhook payload parsing failed: %s", str(exc))
        raise ValueError(f"Invalid webhook payload: {str(exc)}") from exc

    event_id: str = event.id
    event_type: str = event.type

    # 2. Idempotency check
    if _is_event_processed(event_id):
        logger.info(
            "Webhook event already processed, skipping: id=%s, type=%s",
            event_id,
            event_type,
        )
        return WebhookResult(
            event_type=event_type,
            processed=False,
            message=f"Event {event_id} already processed (idempotent skip)",
        )

    # 3. Dispatch to handler
    handler = _EVENT_HANDLERS.get(event_type)
    if handler is None:
        logger.info(
            "Webhook event type not handled: id=%s, type=%s",
            event_id,
            event_type,
        )
        _mark_event_processed(event_id)
        return WebhookResult(
            event_type=event_type,
            processed=False,
            message=f"Event type '{event_type}' acknowledged but not handled",
        )

    try:
        message = await handler(event, db=db)
    except Exception:
        logger.exception(
            "Error processing webhook event: id=%s, type=%s",
            event_id,
            event_type,
        )
        # Do NOT mark as processed so it can be retried
        return WebhookResult(
            event_type=event_type,
            processed=False,
            message=f"Error processing event {event_id}",
        )

    # 4. Mark processed
    _mark_event_processed(event_id)

    logger.info(
        "Webhook event processed: id=%s, type=%s",
        event_id,
        event_type,
    )

    return WebhookResult(
        event_type=event_type,
        processed=True,
        message=message,
    )
