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

from fastapi import APIRouter, Depends, HTTPException, Query, Request, status

from src.api.schemas.payment import (
    # AccountLinkOut / AccountStatusOut / ConnectedAccountOut y sus Request
    # correspondientes se dejaron de importar al retirar los endpoints de
    # Connect v1 (ver la nota más abajo). Los schemas siguen definidos por si
    # se reutilizan.
    AttachPaymentMethodRequest,
    BalanceOut,
    CancelPaymentOut,
    CancelPaymentRequest,
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
    get_balance,
    list_payouts,
)
from src.integrations.stripe.paymentService import STRIPE_PUBLISHABLE_KEY
from src.integrations.stripe.webhookHandler import handle_webhook
from src.api.deps import get_db

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
    db=Depends(get_db),
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
        result = await handle_webhook(payload=payload, sig_header=sig_header, db=db)
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
# Connect v1 (Express) — RETIRADO el 2026-08-12
# ---------------------------------------------------------------------------
# Aquí vivían POST /connect/create, POST /connect/onboard-link y
# GET /connect/status/{account_id}: onboarding con cuentas Express (`type:
# 'express'`) y páginas hospedadas de Stripe.
#
# Se retiran por tres razones:
#   1. La plataforma opera con Accounts v2 (`/v2/core/accounts`), que es la vía
#      en la que Stripe invierte; su guía dice explícitamente no usar los tipos
#      legacy (express/custom/standard) en plataformas nuevas.
#   2. Tener DOS formas de crear la cuenta de pago del mismo proveedor es una
#      trampa: la v1 podía dejar una cuenta Express huérfana junto a la v2.
#   3. Los tres endpoints NO pedían autenticación y tomaban `provider_id` del
#      body — cualquiera podía crear una cuenta de cobro a nombre de otro.
#
# Ningún cliente los llamaba (verificado en app y admin). El onboarding vive en
# /api/v1/provider/payouts/v2/*.
#
# `create_account_link` y `check_account_status` NO se retiran: el flujo v2 los
# usa para la página hospedada de liveness y para leer el estado de la cuenta
# (el retrieve v1 funciona sobre cuentas v2, comprobado).


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


# ---------------------------------------------------------------------------
# GET /payments/config -- Public Stripe config
# ---------------------------------------------------------------------------

@router.get(
    "/config",
    summary="Get Stripe publishable key",
    description="Returns the Stripe publishable key for client-side initialization.",
)
async def get_stripe_config() -> dict:
    return {"publishable_key": STRIPE_PUBLISHABLE_KEY}
