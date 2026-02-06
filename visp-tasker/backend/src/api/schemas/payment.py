"""
Pydantic v2 schemas for the Payments API -- VISP-INT-PAYMENTS-002
==================================================================

Request and response schemas for:
- Payment intent lifecycle (create, confirm, cancel, refund)
- Payment method management
- Stripe Connect account operations
- Provider balance and payout information
- Webhook processing

All monetary amounts are represented as integers (cents).
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Payment Intent schemas
# ---------------------------------------------------------------------------

class CreatePaymentIntentRequest(BaseModel):
    """Request body for creating a new payment intent."""

    job_id: uuid.UUID = Field(description="UUID of the job being paid for")
    amount_cents: int = Field(
        gt=0,
        description="Amount to charge in cents (must be positive)",
    )
    currency: str = Field(
        default="cad",
        min_length=3,
        max_length=3,
        description="Three-letter ISO currency code",
    )
    customer_stripe_id: Optional[str] = Field(
        default=None,
        description="Stripe customer ID to associate the payment with",
    )


class PaymentIntentOut(BaseModel):
    """Response after creating a payment intent."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(description="Stripe PaymentIntent ID")
    client_secret: str = Field(
        description="Client secret for client-side payment confirmation",
    )
    status: str = Field(description="Current PaymentIntent status")
    amount_cents: int = Field(description="Amount in cents")
    currency: str = Field(description="Three-letter ISO currency code")


class PaymentConfirmationOut(BaseModel):
    """Response after confirming a payment intent."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    amount_cents: int
    currency: str
    payment_method_id: Optional[str] = None


class CancelPaymentRequest(BaseModel):
    """Request body for cancelling a payment intent."""

    reason: str = Field(
        default="requested_by_customer",
        description=(
            "Cancellation reason. One of: duplicate, fraudulent, "
            "requested_by_customer, abandoned"
        ),
    )


class CancelPaymentOut(BaseModel):
    """Response after cancelling a payment intent."""

    cancelled: bool = Field(description="Whether the cancellation succeeded")
    payment_intent_id: str


# ---------------------------------------------------------------------------
# Refund schemas
# ---------------------------------------------------------------------------

class RefundRequest(BaseModel):
    """Request body for refunding a payment intent."""

    amount_cents: Optional[int] = Field(
        default=None,
        ge=0,
        description=(
            "Amount to refund in cents. If omitted or null, issues a full refund."
        ),
    )
    reason: str = Field(
        default="",
        max_length=500,
        description="Human-readable refund reason",
    )


class RefundOut(BaseModel):
    """Response after processing a refund."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(description="Stripe Refund ID")
    status: str = Field(description="Refund status")
    amount_cents: int = Field(description="Refunded amount in cents")


# ---------------------------------------------------------------------------
# Payment Method schemas
# ---------------------------------------------------------------------------

class AttachPaymentMethodRequest(BaseModel):
    """Request body for attaching a payment method to a customer."""

    customer_id: str = Field(description="Stripe customer ID")
    payment_method_id: str = Field(description="Stripe payment method ID")


class PaymentMethodOut(BaseModel):
    """Summary of a saved payment method."""

    model_config = ConfigDict(from_attributes=True)

    id: str = Field(description="Stripe payment method ID")
    type: str = Field(description="Payment method type (e.g., 'card')")
    last4: str = Field(description="Last 4 digits of the card")
    brand: str = Field(description="Card brand (visa, mastercard, etc.)")
    exp_month: int = Field(description="Expiration month")
    exp_year: int = Field(description="Expiration year")


class PaymentMethodListOut(BaseModel):
    """List of payment methods for a customer."""

    methods: list[PaymentMethodOut]
    count: int = Field(description="Number of payment methods returned")


# ---------------------------------------------------------------------------
# Stripe Connect schemas
# ---------------------------------------------------------------------------

class CreateConnectedAccountRequest(BaseModel):
    """Request body for creating a Stripe Connect account."""

    provider_id: uuid.UUID = Field(description="VISP provider profile UUID")
    email: str = Field(description="Provider email address")
    country: str = Field(
        default="CA",
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code",
    )


class ConnectedAccountOut(BaseModel):
    """Response after creating a connected account."""

    model_config = ConfigDict(from_attributes=True)

    account_id: str = Field(description="Stripe Connect account ID")
    onboarding_complete: bool
    details_submitted: bool


class CreateAccountLinkRequest(BaseModel):
    """Request body for generating a Stripe onboarding link."""

    account_id: str = Field(description="Stripe Connect account ID")
    refresh_url: str = Field(
        description="URL to redirect to if the onboarding link expires",
    )
    return_url: str = Field(
        description="URL to redirect to after onboarding completes",
    )


class AccountLinkOut(BaseModel):
    """Response with the onboarding link URL."""

    url: str = Field(description="Stripe onboarding URL")
    account_id: str


class AccountStatusOut(BaseModel):
    """Current status of a Stripe Connect account."""

    model_config = ConfigDict(from_attributes=True)

    account_id: str
    charges_enabled: bool = Field(
        description="Whether the account can accept charges",
    )
    payouts_enabled: bool = Field(
        description="Whether the account can receive payouts",
    )
    requirements_due: list[str] = Field(
        default_factory=list,
        description="Outstanding verification requirements",
    )


# ---------------------------------------------------------------------------
# Balance and Payout schemas
# ---------------------------------------------------------------------------

class BalanceOut(BaseModel):
    """Balance information for a connected account."""

    model_config = ConfigDict(from_attributes=True)

    available_cents: int = Field(description="Available balance in cents")
    pending_cents: int = Field(description="Pending balance in cents")
    currency: str


class PayoutInfoOut(BaseModel):
    """Summary of a single payout."""

    model_config = ConfigDict(from_attributes=True)

    id: str
    status: str
    amount_cents: int
    currency: str
    arrival_date: Optional[datetime] = None
    created_at: datetime


class PayoutListOut(BaseModel):
    """List of payouts for a connected account."""

    payouts: list[PayoutInfoOut]
    count: int = Field(description="Number of payouts returned")


# ---------------------------------------------------------------------------
# Webhook schemas
# ---------------------------------------------------------------------------

class WebhookResultOut(BaseModel):
    """Response after processing a webhook event."""

    event_type: str
    processed: bool
    message: str
