"""
Stripe Payment Service -- VISP-INT-PAYMENTS-002
=================================================

Handles all customer-facing payment operations through Stripe:
- Payment intent creation and lifecycle
- Customer management
- Payment method attachment and listing
- Refund processing

All monetary amounts are in cents (integers) to avoid floating-point issues.
Stripe keys are loaded from environment variables:
  STRIPE_SECRET_KEY, STRIPE_PUBLISHABLE_KEY, STRIPE_WEBHOOK_SECRET
"""

from __future__ import annotations

import logging
import os
import uuid
from dataclasses import dataclass
from typing import Optional

import stripe

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stripe SDK configuration
# ---------------------------------------------------------------------------

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")
stripe.api_version = "2024-06-20"

STRIPE_PUBLISHABLE_KEY = os.environ.get("STRIPE_PUBLISHABLE_KEY", "")
STRIPE_WEBHOOK_SECRET = os.environ.get("STRIPE_WEBHOOK_SECRET", "")


# ---------------------------------------------------------------------------
# Custom exception
# ---------------------------------------------------------------------------

class PaymentError(Exception):
    """Raised when a Stripe payment operation fails.

    Attributes:
        message: Human-readable error description.
        stripe_error_code: The Stripe error code, if available.
        stripe_error_type: The Stripe error type, if available.
        decline_code: The decline code from the card issuer, if available.
    """

    def __init__(
        self,
        message: str,
        stripe_error_code: str | None = None,
        stripe_error_type: str | None = None,
        decline_code: str | None = None,
    ) -> None:
        super().__init__(message)
        self.message = message
        self.stripe_error_code = stripe_error_code
        self.stripe_error_type = stripe_error_type
        self.decline_code = decline_code

    def __repr__(self) -> str:
        return (
            f"PaymentError(message={self.message!r}, "
            f"code={self.stripe_error_code!r}, "
            f"type={self.stripe_error_type!r})"
        )


# ---------------------------------------------------------------------------
# Response dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PaymentIntentResult:
    """Result of creating a Stripe PaymentIntent."""
    id: str
    client_secret: str
    status: str
    amount_cents: int
    currency: str


@dataclass(frozen=True)
class PaymentConfirmation:
    """Result of confirming a Stripe PaymentIntent."""
    id: str
    status: str
    amount_cents: int
    currency: str
    payment_method_id: str | None


@dataclass(frozen=True)
class RefundResult:
    """Result of a Stripe refund operation."""
    id: str
    status: str
    amount_cents: int


@dataclass(frozen=True)
class PaymentMethodInfo:
    """Summary of a saved payment method."""
    id: str
    type: str
    last4: str
    brand: str
    exp_month: int
    exp_year: int


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _handle_stripe_error(exc: stripe.StripeError) -> PaymentError:
    """Convert a Stripe SDK exception into a PaymentError."""
    error_body = getattr(exc, "error", None)

    code = getattr(error_body, "code", None) if error_body else None
    error_type = getattr(error_body, "type", None) if error_body else None
    decline_code = getattr(error_body, "decline_code", None) if error_body else None

    logger.error(
        "Stripe API error: %s (code=%s, type=%s, decline_code=%s)",
        str(exc),
        code,
        error_type,
        decline_code,
    )

    return PaymentError(
        message=str(exc),
        stripe_error_code=code,
        stripe_error_type=error_type,
        decline_code=decline_code,
    )


# ---------------------------------------------------------------------------
# Payment Intent operations
# ---------------------------------------------------------------------------

async def create_payment_intent(
    job_id: uuid.UUID,
    amount_cents: int,
    currency: str = "cad",
    customer_stripe_id: str | None = None,
) -> PaymentIntentResult:
    """Create a Stripe PaymentIntent for a job.

    Args:
        job_id: The VISP job UUID. Stored in PaymentIntent metadata.
        amount_cents: Amount to charge in the smallest currency unit (cents).
        currency: Three-letter ISO currency code (default ``cad``).
        customer_stripe_id: Optional Stripe customer ID to associate the payment.

    Returns:
        PaymentIntentResult with the PaymentIntent details.

    Raises:
        PaymentError: If the Stripe API call fails.
        ValueError: If amount_cents is non-positive.
    """
    if amount_cents <= 0:
        raise ValueError(f"Payment amount must be positive, got {amount_cents}")

    params: dict = {
        "amount": amount_cents,
        "currency": currency.lower(),
        "metadata": {
            "job_id": str(job_id),
            "platform": "visp_tasker",
        },
        "automatic_payment_methods": {"enabled": True},
        "capture_method": "automatic",
    }

    if customer_stripe_id:
        params["customer"] = customer_stripe_id

    try:
        intent = stripe.PaymentIntent.create(**params)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "PaymentIntent created: id=%s, job_id=%s, amount=%d %s",
        intent.id,
        job_id,
        amount_cents,
        currency,
    )

    return PaymentIntentResult(
        id=intent.id,
        client_secret=intent.client_secret,
        status=intent.status,
        amount_cents=intent.amount,
        currency=intent.currency,
    )


async def confirm_payment(payment_intent_id: str) -> PaymentConfirmation:
    """Confirm a PaymentIntent server-side.

    This is typically called when the client-side confirmation has already been
    initiated, or for server-driven payment flows. Most mobile flows confirm
    client-side using the client_secret.

    Args:
        payment_intent_id: The Stripe PaymentIntent ID (e.g., ``pi_...``).

    Returns:
        PaymentConfirmation with the confirmed intent details.

    Raises:
        PaymentError: If the confirmation fails.
    """
    try:
        intent = stripe.PaymentIntent.confirm(payment_intent_id)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    payment_method_id: str | None = None
    if intent.payment_method and isinstance(intent.payment_method, str):
        payment_method_id = intent.payment_method
    elif intent.payment_method:
        payment_method_id = intent.payment_method.id

    logger.info(
        "PaymentIntent confirmed: id=%s, status=%s",
        intent.id,
        intent.status,
    )

    return PaymentConfirmation(
        id=intent.id,
        status=intent.status,
        amount_cents=intent.amount,
        currency=intent.currency,
        payment_method_id=payment_method_id,
    )


async def cancel_payment(
    payment_intent_id: str,
    reason: str = "requested_by_customer",
) -> bool:
    """Cancel a PaymentIntent before it has been captured.

    Args:
        payment_intent_id: The Stripe PaymentIntent ID.
        reason: Cancellation reason. One of ``duplicate``,
                ``fraudulent``, ``requested_by_customer``,
                ``abandoned``.

    Returns:
        True if the cancellation succeeded.

    Raises:
        PaymentError: If the cancellation fails (e.g., already captured).
    """
    valid_reasons = {"duplicate", "fraudulent", "requested_by_customer", "abandoned"}
    if reason not in valid_reasons:
        reason = "requested_by_customer"

    try:
        intent = stripe.PaymentIntent.cancel(
            payment_intent_id,
            cancellation_reason=reason,
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "PaymentIntent cancelled: id=%s, reason=%s",
        intent.id,
        reason,
    )

    return intent.status == "canceled"


async def refund_payment(
    payment_intent_id: str,
    amount_cents: int | None = None,
    reason: str = "",
) -> RefundResult:
    """Refund a PaymentIntent (full or partial).

    Args:
        payment_intent_id: The Stripe PaymentIntent ID to refund.
        amount_cents: Amount to refund in cents. If None, full refund.
        reason: Human-readable reason for the refund (stored in metadata).

    Returns:
        RefundResult with the refund details.

    Raises:
        PaymentError: If the refund fails.
        ValueError: If amount_cents is negative.
    """
    if amount_cents is not None and amount_cents < 0:
        raise ValueError(f"Refund amount cannot be negative, got {amount_cents}")

    params: dict = {
        "payment_intent": payment_intent_id,
        "metadata": {
            "reason": reason[:500] if reason else "",
            "platform": "visp_tasker",
        },
    }

    if amount_cents is not None and amount_cents > 0:
        params["amount"] = amount_cents

    try:
        refund = stripe.Refund.create(**params)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Refund created: id=%s, payment_intent=%s, amount=%d, status=%s",
        refund.id,
        payment_intent_id,
        refund.amount,
        refund.status,
    )

    return RefundResult(
        id=refund.id,
        status=refund.status,
        amount_cents=refund.amount,
    )


# ---------------------------------------------------------------------------
# Customer operations
# ---------------------------------------------------------------------------

async def create_customer(
    user_id: uuid.UUID,
    email: str,
    name: str,
) -> str:
    """Create a Stripe Customer for a VISP user.

    Args:
        user_id: The VISP user UUID.
        email: Customer email address.
        name: Customer full name.

    Returns:
        The Stripe customer ID (``cus_...``).

    Raises:
        PaymentError: If the Stripe API call fails.
    """
    try:
        customer = stripe.Customer.create(
            email=email,
            name=name,
            metadata={
                "visp_user_id": str(user_id),
                "platform": "visp_tasker",
            },
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Stripe customer created: stripe_id=%s, user_id=%s",
        customer.id,
        user_id,
    )

    return customer.id


async def attach_payment_method(
    customer_id: str,
    payment_method_id: str,
) -> bool:
    """Attach a payment method to a Stripe customer.

    Args:
        customer_id: The Stripe customer ID.
        payment_method_id: The Stripe payment method ID (``pm_...``).

    Returns:
        True if the attachment succeeded.

    Raises:
        PaymentError: If the API call fails.
    """
    try:
        stripe.PaymentMethod.attach(
            payment_method_id,
            customer=customer_id,
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    # Set as default payment method for the customer
    try:
        stripe.Customer.modify(
            customer_id,
            invoice_settings={"default_payment_method": payment_method_id},
        )
    except stripe.StripeError as exc:
        # Non-fatal: the method is attached, just not set as default
        logger.warning(
            "Payment method attached but failed to set as default: %s",
            str(exc),
        )

    logger.info(
        "Payment method attached: method=%s, customer=%s",
        payment_method_id,
        customer_id,
    )

    return True


async def list_payment_methods(
    customer_id: str,
) -> list[PaymentMethodInfo]:
    """List all payment methods for a Stripe customer.

    Currently returns card-type payment methods. Additional types (e.g.,
    bank accounts) can be added as needed.

    Args:
        customer_id: The Stripe customer ID.

    Returns:
        List of PaymentMethodInfo for each saved payment method.

    Raises:
        PaymentError: If the API call fails.
    """
    try:
        methods = stripe.PaymentMethod.list(
            customer=customer_id,
            type="card",
            limit=20,
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    results: list[PaymentMethodInfo] = []
    for pm in methods.data:
        card = pm.card
        if card:
            results.append(
                PaymentMethodInfo(
                    id=pm.id,
                    type="card",
                    last4=card.last4,
                    brand=card.brand,
                    exp_month=card.exp_month,
                    exp_year=card.exp_year,
                )
            )

    logger.info(
        "Listed %d payment methods for customer %s",
        len(results),
        customer_id,
    )

    return results


# ---------------------------------------------------------------------------
# Payment status
# ---------------------------------------------------------------------------

async def get_payment_status(payment_intent_id: str) -> str:
    """Retrieve the current status of a PaymentIntent.

    Args:
        payment_intent_id: The Stripe PaymentIntent ID.

    Returns:
        The PaymentIntent status string (e.g., ``requires_payment_method``,
        ``requires_confirmation``, ``requires_action``, ``processing``,
        ``requires_capture``, ``canceled``, ``succeeded``).

    Raises:
        PaymentError: If the retrieval fails.
    """
    try:
        intent = stripe.PaymentIntent.retrieve(payment_intent_id)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    return intent.status
