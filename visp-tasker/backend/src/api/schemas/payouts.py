"""
Pydantic schemas — Stripe Connect Accounts v2 onboarding payloads.

Each step of the native onboarding flow has its own request schema. The
shared ``PayoutStatusOut`` response mirrors :class:`V2AccountResult` and
is returned by every step + the GET /payouts/v2/status endpoint.
"""

from __future__ import annotations

from typing import Any

from pydantic import BaseModel, EmailStr, Field, field_validator


# ---------------------------------------------------------------------------
# Step 1 — Personal identity
# ---------------------------------------------------------------------------

class PayoutIdentityIn(BaseModel):
    """Personal info the provider enters on the mobile Identity step."""
    first_name: str = Field(min_length=1, max_length=100)
    last_name: str = Field(min_length=1, max_length=100)
    dob_year: int = Field(ge=1900, le=2100)
    dob_month: int = Field(ge=1, le=12)
    dob_day: int = Field(ge=1, le=31)
    address_line1: str = Field(min_length=1, max_length=255)
    address_city: str = Field(min_length=1, max_length=100)
    address_state: str = Field(min_length=1, max_length=10)
    address_postal_code: str = Field(min_length=1, max_length=20)
    address_country: str = Field(min_length=2, max_length=2)
    phone: str = Field(min_length=7, max_length=20)
    email: EmailStr

    @field_validator("address_country")
    @classmethod
    def _upper_country(cls, v: str) -> str:
        return v.upper()


# ---------------------------------------------------------------------------
# Step 2 — Tax identifier
# ---------------------------------------------------------------------------

class PayoutTaxIn(BaseModel):
    """SSN (US) or SIN (CA). Stripe stores it encrypted and never echoes it back."""
    id_number: str = Field(min_length=9, max_length=15, description="SSN or SIN, digits only or with hyphens.")

    @field_validator("id_number")
    @classmethod
    def _strip_separators(cls, v: str) -> str:
        # Stripe accepts the bare digits — strip dashes / spaces the user types.
        cleaned = "".join(c for c in v if c.isdigit())
        if len(cleaned) < 9:
            raise ValueError("id_number must contain at least 9 digits")
        return cleaned


# ---------------------------------------------------------------------------
# Step 3 — Bank account
# ---------------------------------------------------------------------------

class PayoutBankIn(BaseModel):
    """Bank account fields. For CA, ``routing_number`` is transit+institution
    pre-concatenated (5 digits transit + 3 digits institution); the mobile UI
    collects them as two fields and joins before submitting. US uses the
    9-digit routing number."""
    country: str = Field(min_length=2, max_length=2)
    currency: str = Field(min_length=3, max_length=3)
    account_holder_name: str = Field(min_length=1, max_length=200)
    routing_number: str = Field(min_length=8, max_length=15)
    account_number: str = Field(min_length=4, max_length=20)

    @field_validator("country")
    @classmethod
    def _upper_country(cls, v: str) -> str:
        return v.upper()

    @field_validator("currency")
    @classmethod
    def _lower_currency(cls, v: str) -> str:
        return v.lower()

    @field_validator("routing_number", "account_number")
    @classmethod
    def _digits_only(cls, v: str) -> str:
        cleaned = "".join(c for c in v if c.isdigit())
        if len(cleaned) < 4:
            raise ValueError("must contain digits only")
        return cleaned


# ---------------------------------------------------------------------------
# Step 4 — TOS acceptance
# ---------------------------------------------------------------------------

class PayoutTosIn(BaseModel):
    """Provider taps "I accept" on the mobile TOS screen.

    The IP and user agent are picked from the request server-side; the
    client doesn't supply them. Only the explicit acceptance bool is sent
    over the wire to prevent forged IPs.
    """
    accepted: bool


# ---------------------------------------------------------------------------
# Common response
# ---------------------------------------------------------------------------

class PayoutStatusOut(BaseModel):
    """Current onboarding state — returned by every step + GET status."""
    account_id: str
    onboarding_step: str  # 'identity' | 'tax' | 'bank' | 'identity_doc' | 'tos' | 'complete'
    requirements_due: list[str]
    capabilities: dict[str, Any]
    payouts_enabled: bool
    details_submitted: bool
    has_external_account: bool = False
    identity_session_id: str | None = None


class IdentitySessionOut(BaseModel):
    """Bootstrap data for the @stripe/stripe-identity-react-native SDK."""
    session_id: str
    client_secret: str
    ephemeral_key_secret: str
    publishable_key: str
