"""
Stripe Webhook Handler -- VISP-INT-PAYMENTS-002
=================================================

Processes inbound Stripe webhook events with:
- Signature verification using STRIPE_WEBHOOK_SECRET
- Idempotent event processing (tracks processed event IDs in-memory with
  optional Redis extension)
- Structured handling for all payment-related event types

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
from collections import OrderedDict
from dataclasses import dataclass
from threading import Lock

import stripe

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

def _handle_payment_intent_succeeded(event: stripe.Event) -> str:
    """Handle a successful payment.

    When a PaymentIntent succeeds, the platform should:
    1. Update the job's paid_at timestamp
    2. Initiate the provider transfer (commission split)
    3. Send confirmation notifications to customer and provider
    """
    payment_intent = event.data.object
    job_id = payment_intent.metadata.get("job_id", "unknown")
    amount = payment_intent.amount
    currency = payment_intent.currency

    logger.info(
        "Payment succeeded: intent=%s, job_id=%s, amount=%d %s",
        payment_intent.id,
        job_id,
        amount,
        currency,
    )

    return (
        f"Payment intent {payment_intent.id} succeeded for job {job_id}: "
        f"{amount} {currency}"
    )


def _handle_payment_intent_failed(event: stripe.Event) -> str:
    """Handle a failed payment attempt.

    When a PaymentIntent fails, the platform should:
    1. Log the failure reason for support debugging
    2. Notify the customer to retry or update payment method
    3. Keep the job in a pending-payment state
    """
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


def _handle_charge_refunded(event: stripe.Event) -> str:
    """Handle a charge refund event.

    When a charge is refunded, the platform should:
    1. Update the job status to 'refunded' if full refund
    2. Record the refund in the pricing events audit trail
    3. Reverse or adjust the provider transfer if applicable
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

    return (
        f"Charge {charge.id} refunded: {amount_refunded} cents "
        f"(payment_intent={payment_intent_id})"
    )


def _handle_account_updated(event: stripe.Event) -> str:
    """Handle a connected account update.

    When a connected account is updated, check if onboarding is complete
    and update the provider's status in the platform.
    """
    account = event.data.object
    charges_enabled = account.charges_enabled
    payouts_enabled = account.payouts_enabled
    provider_id = account.metadata.get("visp_provider_id", "unknown")

    logger.info(
        "Account updated: account=%s, provider_id=%s, "
        "charges_enabled=%s, payouts_enabled=%s",
        account.id,
        provider_id,
        charges_enabled,
        payouts_enabled,
    )

    return (
        f"Account {account.id} updated for provider {provider_id}: "
        f"charges={charges_enabled}, payouts={payouts_enabled}"
    )


def _handle_transfer_created(event: stripe.Event) -> str:
    """Handle a transfer creation event.

    Confirms that a transfer to a provider's connected account was initiated.
    """
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


def _handle_payout_paid(event: stripe.Event) -> str:
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


def _handle_payout_failed(event: stripe.Event) -> str:
    """Handle a failed payout.

    When a payout fails, the platform should:
    1. Notify the provider to update their bank account details
    2. Log the failure for support follow-up
    3. Schedule a retry if appropriate
    """
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
    "charge.refunded": _handle_charge_refunded,
    "account.updated": _handle_account_updated,
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
        message = handler(event)
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
