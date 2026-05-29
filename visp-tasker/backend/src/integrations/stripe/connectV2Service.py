"""
Stripe Connect Accounts v2 onboarding service
==============================================

Implements the native onboarding flow for VISP providers:

    1. ``init`` — create a Stripe Connect account via POST /v2/core/accounts
       with ``controller.requirement_collection = 'application'`` so VISP
       (not Stripe) owns the field collection UI.
    2. ``submit_identity`` — push the provider's legal name, DOB, address and
       phone via ``stripe.Account.modify``.
    3. ``submit_tax`` — push the SSN (US) or SIN (CA) via
       ``individual.id_number`` on the connected account.
    4. ``submit_bank`` — attach an external bank account (raw routing +
       account number for US, transit + institution + account for CA).
    5. ``create_identity_session`` — open a Stripe Identity verification
       session so the provider can upload a government-issued ID and selfie
       through the native mobile SDK.
    6. ``accept_tos`` — record the provider's acceptance of the Stripe
       Services Agreement with IP + user agent + timestamp.
    7. ``get_account_status`` — fetch capabilities + currently-due
       requirements; the mobile app uses this to pick the next step.

All monetary amounts (when present in transfer responses) are in cents.

Notes about V2 vs V1
--------------------
Stripe's v2 ``/v2/core/accounts`` API is the actively-invested path. The
SDK exposes it under ``stripe.v2.core.accounts.create`` (Python SDK
v9.0+). For now the rest of the platform (transfers, balances, payouts)
keeps using the v1 surface — the v2 account_id (``acct_...``) is fully
interoperable with v1 endpoints, so we can mix them in this transition.

The platform must have Accounts v2 enabled in the Stripe Dashboard
(Connect → Settings → "Accounts v2 API access") and a compliance review
on file before this works in production. In test mode it's available
without review.
"""

from __future__ import annotations

import logging
import uuid
from dataclasses import dataclass
from datetime import datetime
from typing import Any

import stripe

from src.core.config import settings
from .paymentService import _handle_stripe_error

logger = logging.getLogger(__name__)

stripe.api_key = settings.stripe_secret_key


# ---------------------------------------------------------------------------
# Result dataclasses
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class V2AccountResult:
    """Result of creating or fetching a Stripe Connect v2 account."""
    account_id: str
    onboarding_step: str  # 'identity' | 'tax' | 'bank' | 'identity_doc' | 'tos' | 'complete'
    requirements_due: list[str]
    capabilities: dict[str, Any]
    payouts_enabled: bool
    details_submitted: bool


@dataclass(frozen=True)
class IdentitySessionResult:
    """Stripe Identity verification session bootstrap data for the mobile SDK."""
    session_id: str
    client_secret: str
    ephemeral_key_secret: str


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

# Steps the mobile UI walks through, in order. The next step is whichever
# is the first one with at least one outstanding requirement.
_STEP_REQUIREMENTS: list[tuple[str, tuple[str, ...]]] = [
    ("identity", (
        "individual.first_name",
        "individual.last_name",
        "individual.dob.day",
        "individual.dob.month",
        "individual.dob.year",
        "individual.address.line1",
        "individual.address.city",
        "individual.address.state",
        "individual.address.postal_code",
        "individual.phone",
        "individual.email",
    )),
    ("tax", (
        "individual.id_number",
        "individual.ssn_last_4",
    )),
    ("bank", (
        "external_account",
    )),
    ("identity_doc", (
        "individual.verification.document",
        "individual.verification.additional_document",
        "individual.verification.proof_of_liveness",
    )),
    ("tos", (
        "tos_acceptance.date",
        "tos_acceptance.ip",
    )),
]


def _next_step(requirements_due: list[str]) -> str:
    """Return the first onboarding step that has at least one outstanding field."""
    due_set = set(requirements_due)
    for step_name, fields in _STEP_REQUIREMENTS:
        if any(f in due_set for f in fields):
            return step_name
    return "complete"


def _v2_create_call(payload: dict[str, Any]) -> Any:
    """Create a v2 connected account across stripe-python SDK shape variants.

    SDK 11.x+ exposes the v2 surface only via ``StripeClient`` instances:
    ``stripe.StripeClient(api_key).v2.core.accounts.create(params=...)``.
    Some intermediate minors also bind a module-level service at
    ``stripe.v2.core.accounts``. Both call signatures take a single
    ``params=`` dict — not unpacked kwargs — because the SDK uses TypedDicts.
    """
    client_cls = getattr(stripe, "StripeClient", None)
    if client_cls is not None:
        client = client_cls(settings.stripe_secret_key)
        return client.v2.core.accounts.create(params=payload)  # type: ignore[attr-defined]

    v2_mod = getattr(stripe, "v2", None)
    core_mod = getattr(v2_mod, "core", None) if v2_mod is not None else None
    accounts_attr = None
    if core_mod is not None:
        accounts_attr = getattr(core_mod, "accounts", None) or getattr(core_mod, "Accounts", None)
    if accounts_attr is not None and hasattr(accounts_attr, "create"):
        return accounts_attr.create(params=payload)

    sdk_version = getattr(stripe, "VERSION", getattr(stripe, "__version__", "unknown"))
    raise RuntimeError(
        f"stripe-python SDK {sdk_version} does not expose Accounts v2; "
        "expected stripe.StripeClient or stripe.v2.core.accounts. Upgrade to >=11.0."
    )


# ---------------------------------------------------------------------------
# 1. Initialise a v2 account
# ---------------------------------------------------------------------------

async def create_v2_account(
    provider_id: uuid.UUID,
    email: str,
    country: str = "CA",
) -> V2AccountResult:
    """Create a Stripe Connect v2 account where VISP collects all KYC fields.

    Controller properties chosen:
      - ``stripe_dashboard.type = "none"`` — providers never see the Stripe
        dashboard. All UI lives in the VISP app.
      - ``fees.payer = "application"`` — VISP absorbs Stripe processing fees.
      - ``losses.payments = "application"`` — VISP is liable for refunds /
        chargebacks (typical marketplace pattern).
      - ``requirement_collection = "application"`` — the critical setting:
        we collect KYC info and push it to Stripe ourselves.

    Args:
        provider_id: The VISP provider profile UUID (stored in metadata).
        email: Provider's contact email (Stripe sends some compliance
            notices here).
        country: Two-letter ISO country code (CA or US).

    Returns:
        V2AccountResult with the new acct_id and current requirement state.
    """
    payload: dict[str, Any] = {
        "contact_email": email,
        "identity": {
            "country": country.upper(),
            "entity_type": "individual",
        },
        "defaults": {
            "currency": "cad" if country.upper() == "CA" else "usd",
            "responsibilities": {
                "fees_collector": "application",
                "losses_collector": "application",
            },
        },
        "configuration": {
            "recipient": {
                "capabilities": {
                    "stripe_balance": {
                        "stripe_transfers": {"requested": True},
                    },
                },
            },
        },
        "dashboard": "none",
        "metadata": {
            "visp_provider_id": str(provider_id),
            "platform": "visp_tasker",
        },
    }

    try:
        v2_account = _v2_create_call(payload)
    except stripe.StripeError as exc:
        logger.error(
            "v2 account create failed for provider %s: %s",
            provider_id, exc,
        )
        raise _handle_stripe_error(exc) from exc

    account_id = v2_account.id  # type: ignore[attr-defined]

    # v2 create returns a different shape than v1 (requirements live under
    # configuration.recipient.requirements.entries instead of top-level
    # `requirements.currently_due`). Since v2 acct_ids are interoperable
    # with v1 endpoints, we immediately fetch the v1 view to get the
    # familiar requirement lists for the mobile UI.
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        logger.error("v1 retrieve after v2 create failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    requirements_due = _extract_requirements_due(account)
    capabilities = _extract_capabilities(account)

    logger.info(
        "v2 connected account created: account_id=%s provider_id=%s country=%s",
        account_id, provider_id, country,
    )

    return V2AccountResult(
        account_id=account_id,
        onboarding_step=_next_step(requirements_due),
        requirements_due=requirements_due,
        capabilities=capabilities,
        payouts_enabled=bool(getattr(account, "payouts_enabled", False)),
        details_submitted=bool(getattr(account, "details_submitted", False)),
    )


# ---------------------------------------------------------------------------
# 2. Submit identity (personal info)
# ---------------------------------------------------------------------------

async def submit_identity(
    account_id: str,
    *,
    first_name: str,
    last_name: str,
    dob_year: int,
    dob_month: int,
    dob_day: int,
    address_line1: str,
    address_city: str,
    address_state: str,
    address_postal_code: str,
    address_country: str,
    phone: str,
    email: str,
) -> V2AccountResult:
    """Patch the connected account with the provider's identity fields.

    We use the v1 surface (``stripe.Account.modify``) because v2 accounts are
    fully interoperable with v1 update calls. ``individual.*`` is the same
    shape on both.
    """
    try:
        account = stripe.Account.modify(
            account_id,
            individual={
                "first_name": first_name,
                "last_name": last_name,
                "dob": {
                    "year": dob_year,
                    "month": dob_month,
                    "day": dob_day,
                },
                "address": {
                    "line1": address_line1,
                    "city": address_city,
                    "state": address_state,
                    "postal_code": address_postal_code,
                    "country": address_country.upper(),
                },
                "phone": phone,
                "email": email,
                "relationship": {"title": "owner"},
            },
            business_profile={
                "mcc": "1520",  # General Contractors — Residential & Commercial
                "url": "https://visptasker.com",
                "product_description": "Home services provided via the VISP marketplace",
            },
            business_type="individual",
        )
    except stripe.StripeError as exc:
        logger.error("submit_identity failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    return _to_status_result(account_id, account)


# ---------------------------------------------------------------------------
# 3. Submit tax (SSN / SIN)
# ---------------------------------------------------------------------------

async def submit_tax(
    account_id: str,
    *,
    id_number: str,
) -> V2AccountResult:
    """Submit the provider's national tax id (SSN for US, SIN for CA).

    Stripe stores this securely and never echoes it back; we only know it
    was accepted by checking that the corresponding requirement leaves
    ``currently_due`` on the next status call.
    """
    try:
        account = stripe.Account.modify(
            account_id,
            individual={"id_number": id_number},
        )
    except stripe.StripeError as exc:
        logger.error("submit_tax failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    return _to_status_result(account_id, account)


# ---------------------------------------------------------------------------
# 4. Submit bank
# ---------------------------------------------------------------------------

async def submit_bank(
    account_id: str,
    *,
    country: str,
    currency: str,
    account_holder_name: str,
    routing_number: str,
    account_number: str,
) -> tuple[V2AccountResult, str]:
    """Attach a bank account as the external_account for payouts.

    For CA, ``routing_number`` is the concatenated transit + institution
    (``XXXXXYYY`` — 5 transit + 3 institution). The mobile UI should merge
    the two before submitting. US uses the 9-digit routing number.

    Returns the new account status AND the new external_account id so we
    can persist it (``ba_...``).
    """
    try:
        external = stripe.Account.create_external_account(  # type: ignore[attr-defined]
            account_id,
            external_account={
                "object": "bank_account",
                "country": country.upper(),
                "currency": currency.lower(),
                "account_holder_name": account_holder_name,
                "account_holder_type": "individual",
                "routing_number": routing_number,
                "account_number": account_number,
            },
        )
    except stripe.StripeError as exc:
        logger.error("submit_bank failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    external_account_id = external.id  # type: ignore[attr-defined]

    # Get fresh status after the bank attach
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        raise _handle_stripe_error(exc) from exc

    return _to_status_result(account_id, account), external_account_id


# ---------------------------------------------------------------------------
# 5. Open Stripe Identity verification session
# ---------------------------------------------------------------------------

async def create_identity_session(
    account_id: str,
    customer_email: str,
) -> IdentitySessionResult:
    """Open a Stripe Identity verification session for the provider.

    The mobile app uses the returned ``client_secret`` + ``ephemeral_key_secret``
    with ``@stripe/stripe-identity-react-native`` to render the native
    document + selfie capture UI.
    """
    try:
        session = stripe.identity.VerificationSession.create(
            type="document",
            metadata={"stripe_account_id": account_id},
            options={"document": {"require_matching_selfie": True}},
            provided_details={"email": customer_email},
        )
    except stripe.StripeError as exc:
        logger.error("create_identity_session failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    # The mobile SDK also needs an ephemeral key tied to the session for
    # client-side document submission.
    try:
        ephemeral_key = stripe.EphemeralKey.create(
            verification_session=session.id,
            stripe_version=getattr(stripe, "api_version", "2024-06-20"),
        )
    except stripe.StripeError as exc:
        logger.error("ephemeral key creation failed for %s: %s", session.id, exc)
        raise _handle_stripe_error(exc) from exc

    return IdentitySessionResult(
        session_id=session.id,
        client_secret=session.client_secret,  # type: ignore[arg-type]
        ephemeral_key_secret=ephemeral_key.secret,  # type: ignore[arg-type]
    )


# ---------------------------------------------------------------------------
# 6. Accept TOS
# ---------------------------------------------------------------------------

async def accept_tos(
    account_id: str,
    *,
    ip: str,
    user_agent: str,
    accepted_at: datetime,
) -> V2AccountResult:
    """Record the provider's TOS acceptance.

    Stripe requires the timestamp (epoch seconds), the IP that made the
    acceptance, and the user agent. The fingerprint binds the acceptance
    to the device + session so it's legally enforceable.
    """
    try:
        account = stripe.Account.modify(
            account_id,
            tos_acceptance={
                "date": int(accepted_at.timestamp()),
                "ip": ip,
                "user_agent": user_agent[:500],  # Stripe length cap
            },
        )
    except stripe.StripeError as exc:
        logger.error("accept_tos failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    return _to_status_result(account_id, account)


# ---------------------------------------------------------------------------
# 7. Status
# ---------------------------------------------------------------------------

async def get_account_status(account_id: str) -> V2AccountResult:
    """Fetch the current state of the connected account."""
    try:
        account = stripe.Account.retrieve(account_id)
    except stripe.StripeError as exc:
        logger.error("get_account_status failed for %s: %s", account_id, exc)
        raise _handle_stripe_error(exc) from exc

    return _to_status_result(account_id, account)


# ---------------------------------------------------------------------------
# Common helpers
# ---------------------------------------------------------------------------

def _extract_requirements_due(account: Any) -> list[str]:
    """Pull the union of `currently_due` and `past_due` for the next-step calc."""
    reqs = getattr(account, "requirements", None)
    if not reqs:
        return []
    out: set[str] = set()
    for key in ("currently_due", "past_due"):
        vals = getattr(reqs, key, None) or []
        for v in vals:
            out.add(v)
    return sorted(out)


def _extract_capabilities(account: Any) -> dict[str, Any]:
    caps = getattr(account, "capabilities", None) or {}
    if isinstance(caps, dict):
        return dict(caps)
    # SDK sometimes returns a StripeObject — coerce via vars()
    try:
        return {k: caps[k] for k in caps.keys()}
    except Exception:
        return {}


def _to_status_result(account_id: str, account: Any) -> V2AccountResult:
    requirements_due = _extract_requirements_due(account)
    capabilities = _extract_capabilities(account)
    return V2AccountResult(
        account_id=account_id,
        onboarding_step=_next_step(requirements_due),
        requirements_due=requirements_due,
        capabilities=capabilities,
        payouts_enabled=bool(getattr(account, "payouts_enabled", False)),
        details_submitted=bool(getattr(account, "details_submitted", False)),
    )
