"""
Stripe Payout Service -- VISP-INT-PAYMENTS-002
================================================

Handles all provider-facing payout operations via Stripe Connect:
- Connected account creation and onboarding
- Account status verification
- Transfers from platform to connected accounts
- Payout management and balance queries

Uses Stripe Connect (Standard or Express accounts) to enable marketplace
payouts where the platform collects payment from customers and transfers
the provider's share to their connected Stripe account.

All monetary amounts are in cents (integers).
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime, timezone
from typing import Any, Optional

import stripe

from src.core.config import settings

from .paymentService import PaymentError, _handle_stripe_error

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Stripe SDK configuration (inherited from paymentService, but ensure set)
# ---------------------------------------------------------------------------
# Read from validated settings (same source as paymentService) — avoids the
# "last import wins" race where two modules each clobber stripe.api_key.

stripe.api_key = settings.stripe_secret_key


# ---------------------------------------------------------------------------
# Response dataclasses
# ---------------------------------------------------------------------------

# E.164 country-code prefixes for the most common Stripe-supported countries.
# Used to validate that a user's stored phone matches the Connect account
# country before pre-filling — Stripe rejects phones that don't match.
_E164_COUNTRY_PREFIXES: dict[str, str] = {
    "CA": "+1", "US": "+1", "MX": "+52", "GB": "+44",
    "FR": "+33", "DE": "+49", "ES": "+34", "AU": "+61",
    "BR": "+55", "IT": "+39", "JP": "+81", "IN": "+91",
}


def _phone_matches_country(phone: Optional[str], country: str) -> bool:
    """Return True if ``phone`` has the E.164 prefix expected for ``country``.

    Unknown countries are trusted (returns True) — the Stripe API will be
    the final arbiter via its own validation.
    """
    if not phone or not phone.startswith("+"):
        return False
    expected = _E164_COUNTRY_PREFIXES.get(country.upper())
    if expected is None:
        return True
    return phone.startswith(expected)


@dataclass(frozen=True)
class ConnectedAccountResult:
    """Result of creating a Stripe Connect account."""
    account_id: str
    onboarding_complete: bool
    details_submitted: bool


@dataclass(frozen=True)
class AccountStatus:
    """Current status of a Stripe Connect account."""
    account_id: str
    charges_enabled: bool
    payouts_enabled: bool
    details_submitted: bool
    transfers_capability: str  # "active" | "inactive" | "pending" | "unknown"
    disabled_reason: Optional[str]
    requirements_due: list[str]
    deleted: bool = False  # True if Stripe says the account no longer exists


@dataclass(frozen=True)
class TransferResult:
    """Result of a transfer to a connected account."""
    id: str
    status: str
    amount_cents: int
    arrival_date: datetime | None


@dataclass(frozen=True)
class PayoutResult:
    """Result of a payout from a connected account balance."""
    id: str
    status: str
    amount_cents: int
    arrival_date: datetime | None


@dataclass(frozen=True)
class BalanceInfo:
    """Balance information for a connected account."""
    available_cents: int
    pending_cents: int
    currency: str


@dataclass(frozen=True)
class PayoutInfo:
    """Summary of a single payout."""
    id: str
    status: str
    amount_cents: int
    currency: str
    arrival_date: datetime | None
    created_at: datetime


# ---------------------------------------------------------------------------
# Connected Account operations
# ---------------------------------------------------------------------------

# create_connected_account — RETIRADA el 2026-08-12.
#
# Creaba cuentas Stripe Express (`type: 'express'`). La plataforma opera con
# Accounts v2 (`connectV2Service.create_v2_account`), que además pide la
# capability `card_payments` que el cobro necesita: el pago es un destination
# charge con `on_behalf_of`, así que el proveedor es merchant of record.
#
# `create_account_link` y `check_account_status` SÍ se conservan: el flujo v2 los
# usa para la página hospedada donde el proveedor completa la verificación de
# liveness y para leer el estado de la cuenta.


async def create_account_link(
    account_id: str,
    refresh_url: str,
    return_url: str,
) -> str:
    """Generate a Stripe onboarding link for a connected account.

    The provider is redirected to this URL to complete identity verification
    and bank account setup. The link expires after a short time, so generate
    a fresh one each time the provider needs to continue onboarding.

    Args:
        account_id: The Stripe Connect account ID (``acct_...``).
        refresh_url: URL to redirect to if the link expires.
        return_url: URL to redirect to after onboarding completes.

    Returns:
        The onboarding URL string.

    Raises:
        PaymentError: If the API call fails.
    """
    try:
        link = stripe.AccountLink.create(
            account=account_id,
            refresh_url=refresh_url,
            return_url=return_url,
            type="account_onboarding",
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Account link created for account %s, expires at %s",
        account_id,
        link.expires_at,
    )

    return link.url


async def check_account_status(account_id: str) -> AccountStatus:
    """Check the current status of a Stripe Connect account.

    Returns information about whether the account can accept charges
    and payouts, and what requirements remain unfulfilled.

    Args:
        account_id: The Stripe Connect account ID.

    Returns:
        AccountStatus with capability and requirements information.

    Raises:
        PaymentError: If the retrieval fails.
    """
    # We catch the broad `stripe.StripeError` (always exists across SDK
    # versions) and inspect both the error code and message text to decide
    # whether the account was deleted. Doing it this way avoids depending on
    # `stripe.error.InvalidRequestError` resolving — older SDK versions and
    # some lazy-loading setups expose that symbol differently and importing
    # it at function-call time can raise AttributeError under uvicorn.
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        code = (getattr(exc, "code", None) or "").lower()
        msg = str(exc).lower()
        deleted_markers = (
            "no such account",
            "does not exist",
            "account_not_found",
            "account_invalid",
            "resource_missing",
        )
        looks_deleted = (
            code in {"account_invalid", "resource_missing", "account_not_found"}
            or any(marker in msg for marker in deleted_markers)
        )
        if looks_deleted:
            logger.warning(
                "Stripe account %s no longer exists (deleted) — code=%s msg=%s",
                account_id, code, msg[:200],
            )
            return AccountStatus(
                account_id=account_id,
                charges_enabled=False,
                payouts_enabled=False,
                details_submitted=False,
                transfers_capability="unknown",
                disabled_reason="deleted",
                requirements_due=[],
                deleted=True,
            )
        logger.error(
            "Stripe error retrieving account %s — code=%s msg=%s",
            account_id, code, msg[:300],
        )
        raise _handle_stripe_error(exc) from exc

    # currently_due is what's blocking right now; the union with eventually_due
    # gives the full checklist so the frontend can show overall progress.
    currently_due: list[str] = []
    eventually_due: list[str] = []
    if account.requirements:
        currently_due = list(account.requirements.currently_due or [])
        eventually_due = list(account.requirements.eventually_due or [])

    transfers_cap = "unknown"
    if account.capabilities:
        transfers_cap = account.capabilities.get("transfers", "unknown")

    disabled_reason = None
    if account.requirements and account.requirements.disabled_reason:
        disabled_reason = account.requirements.disabled_reason

    return AccountStatus(
        account_id=account.id,
        charges_enabled=bool(account.charges_enabled),
        payouts_enabled=bool(account.payouts_enabled),
        details_submitted=bool(account.details_submitted),
        transfers_capability=transfers_cap,
        disabled_reason=disabled_reason,
        requirements_due=list({*currently_due, *eventually_due}),
        deleted=False,
    )


# ---------------------------------------------------------------------------
# Transfer operations (platform -> connected account)
# ---------------------------------------------------------------------------

async def create_transfer(
    job_id: uuid.UUID,
    provider_account_id: str,
    amount_cents: int,
    currency: str = "cad",
) -> TransferResult:
    """Transfer funds from the platform balance to a provider's connected account.

    This is the primary method for paying providers. After a customer payment
    succeeds, the platform keeps its commission and transfers the remainder
    to the provider's connected Stripe account.

    Args:
        job_id: The VISP job UUID (stored in transfer metadata).
        provider_account_id: The provider's Stripe Connect account ID.
        amount_cents: Amount to transfer in cents.
        currency: Three-letter ISO currency code.

    Returns:
        TransferResult with the transfer details.

    Raises:
        PaymentError: If the transfer fails.
        ValueError: If amount_cents is non-positive.
    """
    if amount_cents <= 0:
        raise ValueError(f"Transfer amount must be positive, got {amount_cents}")

    try:
        transfer = stripe.Transfer.create(
            amount=amount_cents,
            currency=currency.lower(),
            destination=provider_account_id,
            metadata={
                "job_id": str(job_id),
                "platform": "visp_tasker",
            },
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    logger.info(
        "Transfer created: id=%s, job_id=%s, account=%s, amount=%d %s",
        transfer.id,
        job_id,
        provider_account_id,
        amount_cents,
        currency,
    )

    return TransferResult(
        id=transfer.id,
        status="pending",
        amount_cents=transfer.amount,
        arrival_date=None,
    )


# ---------------------------------------------------------------------------
# Payout operations (connected account balance -> bank account)
# ---------------------------------------------------------------------------

async def create_payout(
    job_id: uuid.UUID,
    provider_account_id: str,
    amount_cents: int,
    currency: str = "cad",
) -> PayoutResult:
    """Trigger a payout from a connected account's Stripe balance to their
    bank account.

    Note: In most cases, Stripe handles payouts automatically based on the
    account's payout schedule. Manual payouts are used for immediate or
    on-demand disbursement.

    Args:
        job_id: The VISP job UUID for tracking.
        provider_account_id: The provider's Stripe Connect account ID.
        amount_cents: Amount to pay out in cents.
        currency: Three-letter ISO currency code.

    Returns:
        PayoutResult with the payout details.

    Raises:
        PaymentError: If the payout fails.
        ValueError: If amount_cents is non-positive.
    """
    if amount_cents <= 0:
        raise ValueError(f"Payout amount must be positive, got {amount_cents}")

    try:
        payout = stripe.Payout.create(
            amount=amount_cents,
            currency=currency.lower(),
            metadata={
                "job_id": str(job_id),
                "platform": "visp_tasker",
            },
            stripe_account=provider_account_id,
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    arrival_date: datetime | None = None
    if payout.arrival_date:
        arrival_date = datetime.fromtimestamp(payout.arrival_date, tz=timezone.utc)

    logger.info(
        "Payout created: id=%s, job_id=%s, account=%s, amount=%d %s, status=%s",
        payout.id,
        job_id,
        provider_account_id,
        amount_cents,
        currency,
        payout.status,
    )

    return PayoutResult(
        id=payout.id,
        status=payout.status,
        amount_cents=payout.amount,
        arrival_date=arrival_date,
    )


# ---------------------------------------------------------------------------
# Balance queries
# ---------------------------------------------------------------------------

async def get_balance(account_id: str) -> BalanceInfo:
    """Retrieve the available and pending balance for a connected account.

    Args:
        account_id: The Stripe Connect account ID.

    Returns:
        BalanceInfo with available and pending amounts.

    Raises:
        PaymentError: If the retrieval fails.
    """
    try:
        balance = stripe.Balance.retrieve(stripe_account=account_id)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    available_cents = 0
    pending_cents = 0
    currency = "cad"

    if balance.available:
        for entry in balance.available:
            available_cents += entry.amount
            currency = entry.currency

    if balance.pending:
        for entry in balance.pending:
            pending_cents += entry.amount

    return BalanceInfo(
        available_cents=available_cents,
        pending_cents=pending_cents,
        currency=currency,
    )


async def list_payouts(
    account_id: str,
    limit: int = 10,
) -> list[PayoutInfo]:
    """List recent payouts for a connected account.

    Args:
        account_id: The Stripe Connect account ID.
        limit: Maximum number of payouts to return (1-100, default 10).

    Returns:
        List of PayoutInfo sorted by creation date descending.

    Raises:
        PaymentError: If the retrieval fails.
    """
    clamped_limit = max(1, min(limit, 100))

    try:
        payouts = stripe.Payout.list(
            limit=clamped_limit,
            stripe_account=account_id,
        )
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    results: list[PayoutInfo] = []
    for p in payouts.data:
        arrival_date: datetime | None = None
        if p.arrival_date:
            arrival_date = datetime.fromtimestamp(p.arrival_date, tz=timezone.utc)

        results.append(
            PayoutInfo(
                id=p.id,
                status=p.status,
                amount_cents=p.amount,
                currency=p.currency,
                arrival_date=arrival_date,
                created_at=datetime.fromtimestamp(p.created, tz=timezone.utc),
            )
        )

    logger.info(
        "Listed %d payouts for account %s",
        len(results),
        account_id,
    )

    return results
