"""
Stripe Subscription Service -- VISP-INT-PAYMENTS-002
=====================================================

Manages provider subscription tiers through Stripe Billing. Designed for
future use where providers can subscribe to premium tiers that unlock
additional features (priority matching, analytics, reduced commission, etc.).

Currently built with full Stripe Billing integration patterns so it is
ready for production activation without structural changes.

All operations use the Stripe Python SDK synchronously (wrapped in async
signatures for consistency with the rest of the payment module).
"""

from __future__ import annotations

import logging
import os
from dataclasses import dataclass
from datetime import datetime, timezone

import stripe

from .paymentService import PaymentError, _handle_stripe_error

logger = logging.getLogger(__name__)

stripe.api_key = os.environ.get("STRIPE_SECRET_KEY", "")


# ---------------------------------------------------------------------------
# Response dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class SubscriptionResult:
    """Result of creating or updating a Stripe Subscription."""
    id: str
    status: str
    current_period_end: datetime


@dataclass(frozen=True)
class SubscriptionInfo:
    """Detailed subscription information."""
    id: str
    status: str
    price_id: str
    current_period_start: datetime
    current_period_end: datetime
    cancel_at_period_end: bool


# ---------------------------------------------------------------------------
# Subscription operations
# ---------------------------------------------------------------------------

async def create_subscription(
    customer_id: str,
    price_id: str,
) -> SubscriptionResult:
    """Create a new subscription for a Stripe customer.

    Args:
        customer_id: The Stripe customer ID (``cus_...``).
        price_id: The Stripe price ID for the subscription tier (``price_...``).

    Returns:
        SubscriptionResult with the new subscription details.

    Raises:
        PaymentError: If the Stripe API call fails.
    """
    try:
        subscription = stripe.Subscription.create(
            customer=customer_id,
            items=[{"price": price_id}],
            payment_behavior="default_incomplete",
            expand=["latest_invoice.payment_intent"],
            metadata={
                "platform": "visp_tasker",
            },
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Subscription created: id=%s, customer=%s, price=%s, status=%s",
        subscription.id,
        customer_id,
        price_id,
        subscription.status,
    )

    return SubscriptionResult(
        id=subscription.id,
        status=subscription.status,
        current_period_end=datetime.fromtimestamp(
            subscription.current_period_end, tz=timezone.utc
        ),
    )


async def cancel_subscription(
    subscription_id: str,
    at_period_end: bool = True,
) -> bool:
    """Cancel a subscription.

    Args:
        subscription_id: The Stripe subscription ID (``sub_...``).
        at_period_end: If True, the subscription remains active until the
                       current billing period ends. If False, cancel immediately.

    Returns:
        True if the cancellation was successfully processed.

    Raises:
        PaymentError: If the Stripe API call fails.
    """
    try:
        if at_period_end:
            subscription = stripe.Subscription.modify(
                subscription_id,
                cancel_at_period_end=True,
            )
        else:
            subscription = stripe.Subscription.cancel(subscription_id)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Subscription cancellation processed: id=%s, at_period_end=%s, status=%s",
        subscription.id,
        at_period_end,
        subscription.status,
    )

    return True


async def update_subscription(
    subscription_id: str,
    new_price_id: str,
) -> SubscriptionResult:
    """Update a subscription to a different price/tier.

    Prorates the change by default so the customer is billed proportionally
    for the remaining time on their current plan.

    Args:
        subscription_id: The Stripe subscription ID.
        new_price_id: The new Stripe price ID to switch to.

    Returns:
        SubscriptionResult with the updated subscription details.

    Raises:
        PaymentError: If the Stripe API call fails.
    """
    try:
        subscription = stripe.Subscription.retrieve(subscription_id)

        if not subscription.items or not subscription.items.data:
            raise PaymentError(
                message=f"Subscription {subscription_id} has no items to update.",
            )

        current_item_id = subscription.items.data[0].id

        updated = stripe.Subscription.modify(
            subscription_id,
            items=[{
                "id": current_item_id,
                "price": new_price_id,
            }],
            proration_behavior="create_prorations",
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Subscription updated: id=%s, new_price=%s, status=%s",
        updated.id,
        new_price_id,
        updated.status,
    )

    return SubscriptionResult(
        id=updated.id,
        status=updated.status,
        current_period_end=datetime.fromtimestamp(
            updated.current_period_end, tz=timezone.utc
        ),
    )


async def get_subscription(subscription_id: str) -> SubscriptionInfo:
    """Retrieve detailed information about a subscription.

    Args:
        subscription_id: The Stripe subscription ID.

    Returns:
        SubscriptionInfo with full subscription details.

    Raises:
        PaymentError: If the retrieval fails.
    """
    try:
        subscription = stripe.Subscription.retrieve(subscription_id)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    price_id = ""
    if subscription.items and subscription.items.data:
        price_id = subscription.items.data[0].price.id

    return SubscriptionInfo(
        id=subscription.id,
        status=subscription.status,
        price_id=price_id,
        current_period_start=datetime.fromtimestamp(
            subscription.current_period_start, tz=timezone.utc
        ),
        current_period_end=datetime.fromtimestamp(
            subscription.current_period_end, tz=timezone.utc
        ),
        cancel_at_period_end=bool(subscription.cancel_at_period_end),
    )


async def list_subscriptions(
    customer_id: str,
) -> list[SubscriptionInfo]:
    """List all subscriptions for a Stripe customer.

    Args:
        customer_id: The Stripe customer ID.

    Returns:
        List of SubscriptionInfo for each subscription.

    Raises:
        PaymentError: If the retrieval fails.
    """
    try:
        subscriptions = stripe.Subscription.list(
            customer=customer_id,
            limit=20,
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    results: list[SubscriptionInfo] = []
    for sub in subscriptions.data:
        price_id = ""
        if sub.items and sub.items.data:
            price_id = sub.items.data[0].price.id

        results.append(
            SubscriptionInfo(
                id=sub.id,
                status=sub.status,
                price_id=price_id,
                current_period_start=datetime.fromtimestamp(
                    sub.current_period_start, tz=timezone.utc
                ),
                current_period_end=datetime.fromtimestamp(
                    sub.current_period_end, tz=timezone.utc
                ),
                cancel_at_period_end=bool(sub.cancel_at_period_end),
            )
        )

    logger.info(
        "Listed %d subscriptions for customer %s",
        len(results),
        customer_id,
    )

    return results
