"""
Payments API Routes -- VISP-INT-PAYMENTS-002
==============================================

FastAPI route handlers for all payment operations:

Customer Payment Lifecycle:
  POST /payments/create-intent           -- Create payment intent for a job
  POST /payments/confirm/{id}            -- Confirm payment intent
  POST /payments/cancel/{id}             -- Cancel payment intent
  POST /payments/refund/{id}             -- Refund (full or partial)

Payment Methods:
  GET  /payments/methods/{customer_id}   -- List payment methods
  POST /payments/methods/attach          -- Attach payment method

Stripe Connect (Provider):
  POST /payments/connect/create          -- Create connected account
  POST /payments/connect/onboard-link    -- Generate onboarding link
  GET  /payments/connect/status/{id}     -- Check account status

Provider Balance & Payouts:
  GET  /payments/balance/{account_id}    -- Get provider balance
  GET  /payments/payouts/{account_id}    -- List provider payouts

Webhook:
  POST /payments/webhook                 -- Stripe webhook endpoint
"""

from __future__ import annotations

import logging

from fastapi import APIRouter, HTTPException, Query, Request, status

from src.api.schemas.payment import (
    AccountLinkOut,
    AccountStatusOut,
    AttachPaymentMethodRequest,
    BalanceOut,
    CancelPaymentOut,
    CancelPaymentRequest,
    ConnectedAccountOut,
    CreateAccountLinkRequest,
    CreateConnectedAccountRequest,
    CreatePaymentIntentRequest,
    PaymentConfirmationOut,
    PaymentIntentOut,
    PaymentMethodListOut,
    PaymentMethodOut,
    PayoutInfoOut,
    PayoutListOut,
    RefundOut,
    RefundRequest,
    WebhookResultOut,
)
from src.integrations.stripe.paymentService import (
    PaymentError,
    attach_payment_method,
    cancel_payment,
    confirm_payment,
    create_customer,
    create_payment_intent,
    get_payment_status,
    list_payment_methods,
    refund_payment,
)
from src.integrations.stripe.payoutService import (
    check_account_status,
    create_account_link,
    create_connected_account,
    get_balance,
    list_payouts,
)
from src.integrations.stripe.webhookHandler import handle_webhook

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/payments", tags=["Payments"])


# ---------------------------------------------------------------------------
# Helper: convert PaymentError to HTTPException
# ---------------------------------------------------------------------------

def _payment_error_to_http(exc: PaymentError) -> HTTPException:
    """Map a PaymentError to an appropriate HTTP error response."""
    detail = {
        "message": exc.message,
        "stripe_error_code": exc.stripe_error_code,
        "stripe_error_type": exc.stripe_error_type,
    }

    if exc.decline_code:
        detail["decline_code"] = exc.decline_code

    return HTTPException(
        status_code=status.HTTP_402_PAYMENT_REQUIRED,
        detail=detail,
    )


# ---------------------------------------------------------------------------
# POST /payments/create-intent
# ---------------------------------------------------------------------------

@router.post(
    "/create-intent",
    response_model=PaymentIntentOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a payment intent for a job",
    description=(
        "Creates a Stripe PaymentIntent for the specified job and amount. "
        "Returns a client_secret that the mobile app uses to confirm the "
        "payment on the client side."
    ),
)
async def create_payment_intent_endpoint(
    body: CreatePaymentIntentRequest,
) -> PaymentIntentOut:
    try:
        result = await create_payment_intent(
            job_id=body.job_id,
            amount_cents=body.amount_cents,
            currency=body.currency,
            customer_stripe_id=body.customer_stripe_id,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return PaymentIntentOut(
        id=result.id,
        client_secret=result.client_secret,
        status=result.status,
        amount_cents=result.amount_cents,
        currency=result.currency,
    )


# ---------------------------------------------------------------------------
# POST /payments/confirm/{payment_intent_id}
# ---------------------------------------------------------------------------

@router.post(
    "/confirm/{payment_intent_id}",
    response_model=PaymentConfirmationOut,
    summary="Confirm a payment intent",
    description=(
        "Server-side confirmation of a PaymentIntent. Most payment flows "
        "confirm client-side using the client_secret. This endpoint is "
        "available for server-driven flows."
    ),
)
async def confirm_payment_endpoint(
    payment_intent_id: str,
) -> PaymentConfirmationOut:
    try:
        result = await confirm_payment(payment_intent_id)
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return PaymentConfirmationOut(
        id=result.id,
        status=result.status,
        amount_cents=result.amount_cents,
        currency=result.currency,
        payment_method_id=result.payment_method_id,
    )


# ---------------------------------------------------------------------------
# POST /payments/cancel/{payment_intent_id}
# ---------------------------------------------------------------------------

@router.post(
    "/cancel/{payment_intent_id}",
    response_model=CancelPaymentOut,
    summary="Cancel a payment intent",
    description=(
        "Cancels a PaymentIntent before it has been captured. Cannot cancel "
        "a payment that has already succeeded."
    ),
)
async def cancel_payment_endpoint(
    payment_intent_id: str,
    body: CancelPaymentRequest | None = None,
) -> CancelPaymentOut:
    reason = body.reason if body else "requested_by_customer"

    try:
        cancelled = await cancel_payment(payment_intent_id, reason=reason)
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return CancelPaymentOut(
        cancelled=cancelled,
        payment_intent_id=payment_intent_id,
    )


# ---------------------------------------------------------------------------
# POST /payments/refund/{payment_intent_id}
# ---------------------------------------------------------------------------

@router.post(
    "/refund/{payment_intent_id}",
    response_model=RefundOut,
    summary="Refund a payment",
    description=(
        "Issue a full or partial refund for a PaymentIntent that has "
        "already succeeded. If amount_cents is omitted, a full refund "
        "is issued."
    ),
)
async def refund_payment_endpoint(
    payment_intent_id: str,
    body: RefundRequest | None = None,
) -> RefundOut:
    amount_cents = body.amount_cents if body else None
    reason = body.reason if body else ""

    try:
        result = await refund_payment(
            payment_intent_id=payment_intent_id,
            amount_cents=amount_cents,
            reason=reason,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        ) from exc
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return RefundOut(
        id=result.id,
        status=result.status,
        amount_cents=result.amount_cents,
    )


# ---------------------------------------------------------------------------
# GET /payments/methods/{customer_id}
# ---------------------------------------------------------------------------

@router.get(
    "/methods/{customer_id}",
    response_model=PaymentMethodListOut,
    summary="List payment methods for a customer",
    description="Returns all saved card payment methods for a Stripe customer.",
)
async def list_payment_methods_endpoint(
    customer_id: str,
) -> PaymentMethodListOut:
    try:
        methods = await list_payment_methods(customer_id)
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    methods_out = [
        PaymentMethodOut(
            id=m.id,
            type=m.type,
            last4=m.last4,
            brand=m.brand,
            exp_month=m.exp_month,
            exp_year=m.exp_year,
        )
        for m in methods
    ]

    return PaymentMethodListOut(
        methods=methods_out,
        count=len(methods_out),
    )


# ---------------------------------------------------------------------------
# POST /payments/methods/attach
# ---------------------------------------------------------------------------

@router.post(
    "/methods/attach",
    status_code=status.HTTP_200_OK,
    summary="Attach a payment method to a customer",
    description=(
        "Attaches a Stripe payment method to a customer and sets it as "
        "the default payment method for invoices."
    ),
)
async def attach_payment_method_endpoint(
    body: AttachPaymentMethodRequest,
) -> dict:
    try:
        success = await attach_payment_method(
            customer_id=body.customer_id,
            payment_method_id=body.payment_method_id,
        )
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return {
        "attached": success,
        "customer_id": body.customer_id,
        "payment_method_id": body.payment_method_id,
    }


# ---------------------------------------------------------------------------
# POST /payments/webhook -- Stripe webhook endpoint
# ---------------------------------------------------------------------------

@router.post(
    "/webhook",
    response_model=WebhookResultOut,
    summary="Stripe webhook endpoint",
    description=(
        "Receives and processes Stripe webhook events. Verifies the webhook "
        "signature and processes events idempotently. This endpoint must "
        "receive the raw request body (not JSON-parsed) for signature "
        "verification."
    ),
)
async def stripe_webhook_endpoint(
    request: Request,
) -> WebhookResultOut:
    # Read raw body for signature verification
    payload = await request.body()
    sig_header = request.headers.get("Stripe-Signature", "")

    if not sig_header:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="Missing Stripe-Signature header",
        )

    try:
        result = await handle_webhook(payload=payload, sig_header=sig_header)
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        ) from exc

    return WebhookResultOut(
        event_type=result.event_type,
        processed=result.processed,
        message=result.message,
    )


# ---------------------------------------------------------------------------
# POST /payments/connect/create
# ---------------------------------------------------------------------------

@router.post(
    "/connect/create",
    response_model=ConnectedAccountOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a Stripe Connect account for a provider",
    description=(
        "Creates a Stripe Express connected account for the provider. "
        "This enables the marketplace to transfer the provider's share "
        "of each job payment to their bank account."
    ),
)
async def create_connected_account_endpoint(
    body: CreateConnectedAccountRequest,
) -> ConnectedAccountOut:
    try:
        result = await create_connected_account(
            provider_id=body.provider_id,
            email=body.email,
            country=body.country,
        )
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return ConnectedAccountOut(
        account_id=result.account_id,
        onboarding_complete=result.onboarding_complete,
        details_submitted=result.details_submitted,
    )


# ---------------------------------------------------------------------------
# POST /payments/connect/onboard-link
# ---------------------------------------------------------------------------

@router.post(
    "/connect/onboard-link",
    response_model=AccountLinkOut,
    summary="Generate a Stripe onboarding link",
    description=(
        "Creates a short-lived URL that redirects the provider to Stripe's "
        "hosted onboarding flow. The link expires quickly, so generate a "
        "fresh one each time the provider needs to continue onboarding."
    ),
)
async def create_onboard_link_endpoint(
    body: CreateAccountLinkRequest,
) -> AccountLinkOut:
    try:
        url = await create_account_link(
            account_id=body.account_id,
            refresh_url=body.refresh_url,
            return_url=body.return_url,
        )
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return AccountLinkOut(
        url=url,
        account_id=body.account_id,
    )


# ---------------------------------------------------------------------------
# GET /payments/connect/status/{account_id}
# ---------------------------------------------------------------------------

@router.get(
    "/connect/status/{account_id}",
    response_model=AccountStatusOut,
    summary="Check Stripe Connect account status",
    description=(
        "Returns the current status of a provider's Stripe Connect account, "
        "including whether charges and payouts are enabled and what "
        "verification requirements remain."
    ),
)
async def get_account_status_endpoint(
    account_id: str,
) -> AccountStatusOut:
    try:
        account_status = await check_account_status(account_id)
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return AccountStatusOut(
        account_id=account_status.account_id,
        charges_enabled=account_status.charges_enabled,
        payouts_enabled=account_status.payouts_enabled,
        requirements_due=account_status.requirements_due,
    )


# ---------------------------------------------------------------------------
# GET /payments/balance/{account_id}
# ---------------------------------------------------------------------------

@router.get(
    "/balance/{account_id}",
    response_model=BalanceOut,
    summary="Get provider account balance",
    description=(
        "Returns the available and pending balance for a provider's "
        "Stripe Connect account."
    ),
)
async def get_balance_endpoint(
    account_id: str,
) -> BalanceOut:
    try:
        balance = await get_balance(account_id)
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    return BalanceOut(
        available_cents=balance.available_cents,
        pending_cents=balance.pending_cents,
        currency=balance.currency,
    )


# ---------------------------------------------------------------------------
# GET /payments/payouts/{account_id}
# ---------------------------------------------------------------------------

@router.get(
    "/payouts/{account_id}",
    response_model=PayoutListOut,
    summary="List provider payouts",
    description=(
        "Returns recent payouts from a provider's Stripe Connect account "
        "to their bank account, sorted by creation date descending."
    ),
)
async def list_payouts_endpoint(
    account_id: str,
    limit: int = Query(
        default=10,
        ge=1,
        le=100,
        description="Maximum number of payouts to return",
    ),
) -> PayoutListOut:
    try:
        payouts = await list_payouts(account_id, limit=limit)
    except PaymentError as exc:
        raise _payment_error_to_http(exc) from exc

    payouts_out = [
        PayoutInfoOut(
            id=p.id,
            status=p.status,
            amount_cents=p.amount_cents,
            currency=p.currency,
            arrival_date=p.arrival_date,
            created_at=p.created_at,
        )
        for p in payouts
    ]

    return PayoutListOut(
        payouts=payouts_out,
        count=len(payouts_out),
    )
