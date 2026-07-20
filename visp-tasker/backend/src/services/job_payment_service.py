"""Job payment authorize/capture orchestration (Provider-Set Pricing · PP4b).

Wraps the Stripe destination-charge + manual-capture primitives into the job
lifecycle:

  authorize_job  — hold the buffered ceiling (total_charged × 1.30) on the
                   customer's card as a destination charge whose merchant of
                   record + settlement target is the provider/company connected
                   account; VISP's commission is the application_fee.
  capture_job    — capture the actual amount at completion; the unused hold is
                   released.

Funds route to the connected account automatically (transfer_data) so the
succeeded webhook must NOT create a second transfer — it detects the
``destination_charge`` metadata flag. See webhookHandler.

Exceptions map to 4xx at the route layer (never 5xx — Cloudflare rule).
"""

from __future__ import annotations

import uuid
from decimal import ROUND_HALF_UP, Decimal
from typing import Any, Optional

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.integrations.stripe import (
    AuthorizationResult,
    CaptureResult,
    capture_job_payment,
    create_job_authorization,
)
from src.models.job import AssignmentStatus, JobAssignment
from src.models.provider import ProviderProfile

# 30% authorization buffer (PP4b decision, 2026-06-29).
AUTHORIZATION_BUFFER = Decimal("1.30")


# ---------------------------------------------------------------------------
# Exceptions (mapped to 4xx by the route layer)
# ---------------------------------------------------------------------------


class JobNotPriceableError(Exception):
    """The job has no agreed total to charge yet (not repriced/approved)."""


class ProviderNotPayableError(Exception):
    """The job's provider/company has no Stripe Connect account to receive funds."""


class ProviderPaymentSetupIncompleteError(Exception):
    """The job's provider/company has a Stripe account but it can't yet settle a
    destination charge (``card_payments``/``transfers`` not active, or charges
    disabled) — they must finish Stripe onboarding first. Carries the account id
    and the first missing requirement so the route can surface a clear message."""

    def __init__(self, account_id: str, reason: str | None) -> None:
        self.account_id = account_id
        self.reason = reason
        super().__init__(
            f"Connected account {account_id} cannot accept charges yet (missing: {reason})."
        )


class PaymentNotAuthorizedError(Exception):
    """Capture was requested but the job has no held authorization."""


class OverageApprovalRequiredError(Exception):
    """The actual amount exceeds the authorized ceiling and the customer has not
    approved the overage yet (D4). Carries the figures for the approval prompt."""

    def __init__(self, actual_cents: int, authorized_cents: int) -> None:
        self.actual_cents = actual_cents
        self.authorized_cents = authorized_cents
        self.overage_cents = actual_cents - authorized_cents
        super().__init__(
            f"Actual {actual_cents} exceeds authorized ceiling {authorized_cents} "
            f"by {self.overage_cents}; customer overage approval required."
        )


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _buffered_authorization_cents(total_charged_cents: int) -> int:
    return int(
        (Decimal(total_charged_cents) * AUTHORIZATION_BUFFER).quantize(
            Decimal("1"), rounding=ROUND_HALF_UP
        )
    )


async def _resolve_destination_account(
    db: AsyncSession, job: Any
) -> Optional[str]:
    """The connected account that should be MoR + receive the payout: the
    company's account when this is a company assignment, else the accepted
    provider's account."""
    # Company assignment overrides the provider (reuse the B2B resolver).
    try:
        from src.services import company_assignment_service

        company_account = await company_assignment_service.resolve_payout_account(
            db, job.id
        )
        if company_account:
            return company_account
    except Exception:  # noqa: BLE001 — never let the B2B branch break the B2C path
        pass

    assignment = (
        await db.execute(
            select(JobAssignment)
            .where(
                JobAssignment.job_id == job.id,
                JobAssignment.status == AssignmentStatus.ACCEPTED,
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    if assignment is None:
        return None
    provider = await db.get(ProviderProfile, assignment.provider_id)
    return provider.stripe_account_id if provider else None


# ---------------------------------------------------------------------------
# Authorize / capture
# ---------------------------------------------------------------------------


async def authorize_job(
    db: AsyncSession,
    job: Any,
    *,
    customer_stripe_id: Optional[str] = None,
    payment_method: Optional[str] = None,
    confirm: bool = False,
) -> AuthorizationResult:
    """Place a manual-capture destination-charge hold for ``job``.

    Holds ``total_charged × 1.30`` so a modest overrun can be captured without
    re-authorizing; VISP keeps ``commission_amount_cents`` as the application
    fee. Stores the held PaymentIntent id on the job.

    Raises:
        JobNotPriceableError: the job has no total_charged_cents yet.
        ProviderNotPayableError: no connected account to receive funds.
    """
    total = job.total_charged_cents
    if not total or total <= 0:
        raise JobNotPriceableError(str(job.id))

    destination = await _resolve_destination_account(db, job)
    if not destination:
        raise ProviderNotPayableError(str(job.id))

    # Gate: our destination charge sets on_behalf_of=destination, so Stripe treats
    # that connected account as the settlement merchant and requires card_payments
    # (+transfers) active. Verify BEFORE creating the PaymentIntent so an unfinished
    # provider onboarding yields a clean 4xx instead of a cryptic Stripe failure.
    from src.integrations.stripe import account_can_accept_charges

    ready, reason = account_can_accept_charges(destination)
    if not ready:
        raise ProviderPaymentSetupIncompleteError(destination, reason)

    auth_amount = _buffered_authorization_cents(total)
    # On a destination charge the platform retains application_fee and pays
    # Stripe out of it. With Model C the customer's service_fee covers the Stripe
    # cost, so the fee VISP keeps = commission + service_fee; the provider then
    # receives charge − application_fee = (net + fee) − (commission + fee) =
    # net − commission (their full payout, fee not absorbed).
    fee = (job.commission_amount_cents or 0) + (job.service_fee_cents or 0)

    result = await create_job_authorization(
        job.id,
        auth_amount,
        destination,
        application_fee_cents=fee,
        currency=(job.currency or "cad"),
        customer_stripe_id=customer_stripe_id,
        payment_method=payment_method,
        confirm=confirm,
    )

    job.stripe_payment_intent_id = result.id
    job.authorized_amount_cents = auth_amount
    job.capture_buffer_pct = AUTHORIZATION_BUFFER - Decimal(1)
    await db.flush()
    return result


async def capture_job(
    db: AsyncSession,
    job: Any,
    final_total_cents: Optional[int] = None,
    *,
    customer_stripe_id: Optional[str] = None,
    payment_method: Optional[str] = None,
    confirm: bool = False,
) -> CaptureResult:
    """Capture the actual amount for ``job`` at completion (PP4c · D4).

    ``final_total_cents`` is the reconciled actual (defaults to the agreed
    ``total_charged_cents``). Behaviour vs the authorized ceiling:

    * actual ≤ ceiling → capture the actual; the unused hold is released.
    * actual > ceiling, NOT approved → raise :class:`OverageApprovalRequiredError`
      (the customer must approve the overage first).
    * actual > ceiling, approved → capture the ceiling on the held PI and charge
      the remaining delta as a second destination charge (best-effort; if it
      can't be collected the shortfall is left on ``actual_total_cents`` for
      support/dispute).

    Raises:
        PaymentNotAuthorizedError: the job has no held authorization.
        OverageApprovalRequiredError: actual exceeds the ceiling, unapproved.
    """
    if not job.stripe_payment_intent_id:
        raise PaymentNotAuthorizedError(str(job.id))

    actual = final_total_cents if final_total_cents is not None else job.total_charged_cents
    job.actual_total_cents = actual
    ceiling = job.authorized_amount_cents or actual

    # See authorize_job: platform keeps commission + customer-covered service_fee.
    fee = (job.commission_amount_cents or 0) + (job.service_fee_cents or 0)

    # Overage gate.
    if actual > ceiling and not job.overage_approved_at:
        raise OverageApprovalRequiredError(actual, ceiling)

    capture_amount = min(actual, ceiling)
    result = await capture_job_payment(
        job.stripe_payment_intent_id,
        amount_to_capture_cents=capture_amount,
        application_fee_cents=fee,
    )
    job.final_price_cents = result.amount_captured_cents

    # Approved overage: collect the delta above the ceiling as a second charge.
    if actual > ceiling and job.overage_approved_at:
        delta = actual - ceiling
        destination = await _resolve_destination_account(db, job)
        if destination and (payment_method or customer_stripe_id):
            # Commission on the extra; the small Stripe fee on the delta is
            # absorbed Phase 1 (negligible) — see follow-ups.
            delta_fee = int(Decimal(delta) * (job.commission_rate or Decimal(0)))
            delta_pi = await create_job_authorization(
                job.id,
                delta,
                destination,
                application_fee_cents=delta_fee,
                currency=(job.currency or "cad"),
                customer_stripe_id=customer_stripe_id,
                payment_method=payment_method,
                confirm=confirm,
            )
            if confirm:
                delta_cap = await capture_job_payment(
                    delta_pi.id,
                    amount_to_capture_cents=delta,
                    application_fee_cents=delta_fee,
                )
                job.final_price_cents = (job.final_price_cents or 0) + delta_cap.amount_captured_cents

    await db.flush()
    return result
