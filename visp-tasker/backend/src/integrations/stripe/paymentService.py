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

from src.core.config import settings

stripe.api_key = settings.stripe_secret_key
stripe.api_version = "2024-06-20"

STRIPE_PUBLISHABLE_KEY = settings.stripe_publishable_key
STRIPE_WEBHOOK_SECRET = settings.stripe_webhook_secret


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
class AuthorizationResult:
    """Result of authorizing (manual-capture destination charge) a job payment."""
    id: str
    client_secret: str | None
    status: str
    amount_cents: int                 # the authorized (held) amount
    amount_capturable_cents: int      # how much can still be captured
    application_fee_cents: int        # platform commission kept on capture
    destination_account: str | None   # connected account funds route to
    currency: str


@dataclass(frozen=True)
class CaptureResult:
    """Result of capturing a previously authorized job payment."""
    id: str
    status: str
    amount_captured_cents: int
    application_fee_cents: int
    currency: str


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


async def create_job_authorization(
    job_id: uuid.UUID,
    amount_to_authorize_cents: int,
    destination_account: str,
    *,
    application_fee_cents: int = 0,
    currency: str = "cad",
    customer_stripe_id: str | None = None,
    payment_method: str | None = None,
    confirm: bool = False,
) -> AuthorizationResult:
    """Authorize a job payment as a manual-capture **destination charge** (PP4b).

    The connected account (``destination_account``) is the merchant of record
    (``on_behalf_of``) — so tax is theirs to remit (D3) — and funds settle to it
    via ``transfer_data.destination``. VISP keeps ``application_fee_cents`` (the
    level commission). Funds are only HELD (``capture_method='manual'``); the
    actual amount is taken later with :func:`capture_job_payment`.

    Authorize the estimate × buffer ceiling; capture the real amount at
    completion. The customer typically confirms client-side with the returned
    ``client_secret``; pass ``payment_method`` + ``confirm=True`` only for
    server-side tests.

    Args:
        job_id: VISP job UUID (stored in metadata).
        amount_to_authorize_cents: ceiling to hold (estimate × (1+buffer)).
        destination_account: provider/company Stripe Connect account id.
        application_fee_cents: platform commission to retain on capture.
        currency: ISO currency (default cad).
        customer_stripe_id: Stripe customer to charge.
        payment_method: test-only — a PaymentMethod id to confirm immediately.
        confirm: test-only — confirm server-side now.

    Raises:
        PaymentError: if the Stripe call fails.
        ValueError: if the amount is non-positive or the fee exceeds it.
    """
    if amount_to_authorize_cents <= 0:
        raise ValueError(f"Authorization amount must be positive, got {amount_to_authorize_cents}")
    if application_fee_cents < 0 or application_fee_cents > amount_to_authorize_cents:
        raise ValueError("application_fee_cents must be between 0 and the authorized amount")

    params: dict = {
        "amount": amount_to_authorize_cents,
        "currency": currency.lower(),
        "capture_method": "manual",
        "on_behalf_of": destination_account,
        "transfer_data": {"destination": destination_account},
        "metadata": {
            "job_id": str(job_id),
            "platform": "visp_tasker",
            # Marks a destination charge so the succeeded webhook does NOT also
            # create a legacy Transfer (funds already routed). See webhookHandler.
            "destination_charge": "1",
        },
    }
    if application_fee_cents > 0:
        params["application_fee_amount"] = application_fee_cents
    if customer_stripe_id:
        params["customer"] = customer_stripe_id
    if payment_method:
        params["payment_method"] = payment_method
    if confirm:
        # Server-side confirm (tests): never redirect for a held card auth.
        params["confirm"] = True
        params["automatic_payment_methods"] = {"enabled": True, "allow_redirects": "never"}
    else:
        params["automatic_payment_methods"] = {"enabled": True}

    try:
        intent = stripe.PaymentIntent.create(**params)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Job authorization created: id=%s, job_id=%s, hold=%d %s, fee=%d, dest=%s, status=%s",
        intent.id, job_id, amount_to_authorize_cents, currency,
        application_fee_cents, destination_account, intent.status,
    )

    return AuthorizationResult(
        id=intent.id,
        client_secret=intent.client_secret,
        status=intent.status,
        amount_cents=intent.amount,
        amount_capturable_cents=getattr(intent, "amount_capturable", 0) or 0,
        application_fee_cents=application_fee_cents,
        destination_account=destination_account,
        currency=intent.currency,
    )


async def capture_job_payment(
    payment_intent_id: str,
    amount_to_capture_cents: int | None = None,
    application_fee_cents: int | None = None,
) -> CaptureResult:
    """Capture a previously authorized job payment (PP4b).

    Capture the actual amount (≤ the authorized hold); the unused hold is
    released. On a destination charge the connected account receives
    ``amount_captured − application_fee``, so the fee must be re-supplied when
    capturing less than authorized.

    Args:
        payment_intent_id: the held PaymentIntent (``pi_...``).
        amount_to_capture_cents: actual amount to take (defaults to full hold).
        application_fee_cents: recomputed commission for the captured amount.

    Raises:
        PaymentError: if the capture fails (e.g. already captured/expired).
    """
    params: dict = {}
    if amount_to_capture_cents is not None:
        if amount_to_capture_cents <= 0:
            raise ValueError(f"Capture amount must be positive, got {amount_to_capture_cents}")
        params["amount_to_capture"] = amount_to_capture_cents
    if application_fee_cents is not None:
        if application_fee_cents < 0:
            raise ValueError("application_fee_cents cannot be negative")
        params["application_fee_amount"] = application_fee_cents

    try:
        intent = stripe.PaymentIntent.capture(payment_intent_id, **params)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    captured = getattr(intent, "amount_received", None) or intent.amount
    fee = application_fee_cents if application_fee_cents is not None else 0

    logger.info(
        "Job payment captured: id=%s, captured=%d %s, fee=%d, status=%s",
        intent.id, captured, intent.currency, fee, intent.status,
    )

    return CaptureResult(
        id=intent.id,
        status=intent.status,
        amount_captured_cents=captured,
        application_fee_cents=fee,
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

def account_can_accept_charges(account_id: str) -> tuple[bool, str | None]:
    """Return whether ``account_id`` can settle a destination charge as MoR.

    Our job authorization is a destination charge with ``on_behalf_of`` set, which
    makes the connected account the settlement merchant — Stripe therefore requires
    the ``card_payments`` capability *active* on that account (plus ``transfers`` to
    receive the payout). A provider who hasn't finished onboarding has these
    ``inactive``/absent, so the charge would fail with a cryptic Stripe error.
    This lets the caller raise a clean 4xx instead.

    Returns ``(ready, reason)`` where ``reason`` is the first missing requirement
    (``"card_payments"`` / ``"transfers"`` / ``"charges_disabled"``) or ``None``
    when ready. On a Stripe API error we fail OPEN (``True``) so a transient outage
    never blocks a legitimate booking — the charge itself remains the backstop.
    """
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        logger.warning("account_can_accept_charges: retrieve failed for %s: %s", account_id, exc)
        return True, None

    caps = getattr(account, "capabilities", None) or {}

    def _cap(key: str) -> str | None:
        try:
            return caps[key]
        except Exception:  # noqa: BLE001 — StripeObject/absent key
            return None

    if _cap("card_payments") != "active":
        return False, "card_payments"
    if _cap("transfers") != "active":
        return False, "transfers"
    if not bool(getattr(account, "charges_enabled", False)):
        return False, "charges_disabled"
    return True, None


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
