"""
Pydantic v2 schemas for the provider verification API (VISP-BE-VERIFICATION-004).

Covers:
- Background check submission
- License / credential submission and review
- Insurance policy submission and review
- Admin approval and rejection workflows
- Provider verification status aggregation
"""

from __future__ import annotations

import uuid
from datetime import date, datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class BackgroundCheckRequest(BaseModel):
    """Request body for submitting a background check."""

    provider_id: uuid.UUID = Field(
        description="UUID of the provider profile",
    )
    check_type: str = Field(
        description="Type of background check: crc, crjmc, or vsc",
        pattern=r"^(crc|crjmc|vsc)$",
    )
    check_provider: str = Field(
        default="mycrc",
        description=(
            "External check provider to use: opp, toronto_police, mycrc, "
            "or sterling_backcheck"
        ),
        pattern=r"^(opp|toronto_police|mycrc|sterling_backcheck)$",
    )
    applicant_first_name: str = Field(
        min_length=1,
        max_length=100,
        description="Legal first name of the applicant",
    )
    applicant_last_name: str = Field(
        min_length=1,
        max_length=100,
        description="Legal last name of the applicant",
    )
    applicant_email: str = Field(
        min_length=1,
        max_length=255,
        description="Contact email for the applicant",
    )
    date_of_birth: date = Field(
        description="Applicant date of birth (YYYY-MM-DD)",
    )
    address_line_1: str = Field(
        min_length=1,
        max_length=300,
        description="Primary address line",
    )
    address_line_2: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Secondary address line",
    )
    city: str = Field(
        min_length=1,
        max_length=100,
        description="City name",
    )
    province: str = Field(
        min_length=1,
        max_length=100,
        description="Province or state code (e.g. ON, BC)",
    )
    postal_code: str = Field(
        min_length=1,
        max_length=20,
        description="Postal or ZIP code",
    )
    country: str = Field(
        default="CA",
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code",
    )
    phone: Optional[str] = Field(
        default=None,
        max_length=30,
        description="Optional phone number",
    )


class LicenseCredentialRequest(BaseModel):
    """Request body for submitting a professional license or certification."""

    provider_id: uuid.UUID = Field(
        description="UUID of the provider profile",
    )
    credential_type: str = Field(
        description=(
            "Type of credential: license, certification, permit, or training"
        ),
        pattern=r"^(license|certification|permit|training)$",
    )
    name: str = Field(
        min_length=1,
        max_length=300,
        description="Human-readable credential name (e.g. 'Ontario Master Electrician')",
    )
    issuing_authority: Optional[str] = Field(
        default=None,
        max_length=300,
        description="Body that issued the credential",
    )
    credential_number: Optional[str] = Field(
        default=None,
        max_length=200,
        description="License or certificate number",
    )
    jurisdiction: Optional[str] = Field(
        default=None,
        max_length=100,
        description="Province or state where the credential is valid",
    )
    jurisdiction_country: Optional[str] = Field(
        default=None,
        min_length=2,
        max_length=2,
        description="ISO 3166-1 alpha-2 country code for the jurisdiction",
    )
    issued_date: Optional[date] = Field(
        default=None,
        description="Date the credential was issued (YYYY-MM-DD)",
    )
    expiry_date: Optional[date] = Field(
        default=None,
        description="Date the credential expires (YYYY-MM-DD)",
    )
    document_url: Optional[str] = Field(
        default=None,
        description="S3 URL to the uploaded credential document",
    )


class InsurancePolicyRequest(BaseModel):
    """Request body for submitting an insurance policy."""

    provider_id: uuid.UUID = Field(
        description="UUID of the provider profile",
    )
    policy_number: str = Field(
        min_length=1,
        max_length=200,
        description="Insurance policy number",
    )
    insurer_name: str = Field(
        min_length=1,
        max_length=300,
        description="Name of the insurance company",
    )
    policy_type: str = Field(
        min_length=1,
        max_length=100,
        description="Policy type (e.g. general_liability, professional_liability, emergency)",
    )
    coverage_amount_cents: int = Field(
        gt=0,
        description="Coverage amount in cents (e.g. 200000000 for $2,000,000)",
    )
    deductible_cents: Optional[int] = Field(
        default=None,
        ge=0,
        description="Deductible amount in cents",
    )
    effective_date: date = Field(
        description="Policy start date (YYYY-MM-DD)",
    )
    expiry_date: date = Field(
        description="Policy end date (YYYY-MM-DD)",
    )
    document_url: Optional[str] = Field(
        default=None,
        description="S3 URL to the uploaded insurance document",
    )


class AdminApproveRequest(BaseModel):
    """Request body for admin approval (no extra fields needed beyond path param).

    The admin_user_id is extracted from the authenticated session, but we
    accept it in the body for now until auth middleware is wired up.
    """

    admin_user_id: uuid.UUID = Field(
        description="UUID of the admin user performing the action",
    )


class AdminRejectRequest(BaseModel):
    """Request body for admin rejection -- requires a reason."""

    admin_user_id: uuid.UUID = Field(
        description="UUID of the admin user performing the action",
    )
    reason: str = Field(
        min_length=1,
        max_length=2000,
        description="Mandatory rejection reason for the provider",
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class BackgroundCheckSubmissionOut(BaseModel):
    """Response after submitting a background check."""

    model_config = ConfigDict(from_attributes=True)

    credential_id: uuid.UUID
    external_reference_id: str
    check_type: str
    provider_name: str
    status: str
    estimated_fee_cents: Optional[int] = None


class CredentialSubmissionOut(BaseModel):
    """Response after submitting a license or certification."""

    model_config = ConfigDict(from_attributes=True)

    credential_id: uuid.UUID
    credential_type: str
    name: str
    status: str


class InsuranceSubmissionOut(BaseModel):
    """Response after submitting an insurance policy."""

    model_config = ConfigDict(from_attributes=True)

    policy_id: uuid.UUID
    policy_number: str
    insurer_name: str
    coverage_amount_cents: int
    status: str


class CredentialDetailOut(BaseModel):
    """Detailed view of a single credential."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    credential_type: str
    name: str
    issuing_authority: Optional[str] = None
    credential_number: Optional[str] = None
    jurisdiction_country: Optional[str] = None
    jurisdiction_province_state: Optional[str] = None
    issued_date: Optional[date] = None
    expiry_date: Optional[date] = None
    status: str
    verified_at: Optional[datetime] = None
    rejection_reason: Optional[str] = None
    document_url: Optional[str] = None
    created_at: datetime


class InsuranceDetailOut(BaseModel):
    """Detailed view of a single insurance policy."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    policy_number: str
    insurer_name: str
    policy_type: str
    coverage_amount_cents: int
    deductible_cents: Optional[int] = None
    effective_date: date
    expiry_date: date
    status: str
    verified_at: Optional[datetime] = None
    document_url: Optional[str] = None
    created_at: datetime


class LevelRequirementDetail(BaseModel):
    """Individual requirement status within level requirements."""

    model_config = ConfigDict(from_attributes=True)

    required: bool
    met: bool
    status: Optional[str] = None
    expiry: Optional[str] = None
    minimum_coverage_cents: Optional[int] = None


class LevelRequirementsOut(BaseModel):
    """Level-specific requirement compliance."""

    model_config = ConfigDict(from_attributes=True)

    level: str
    requirements_met: bool
    details: dict[str, Any]


class BackgroundCheckInfoOut(BaseModel):
    """Background check status block within provider verification status."""

    model_config = ConfigDict(from_attributes=True)

    status: str
    check_date: Optional[str] = None
    expiry_date: Optional[str] = None
    reference: Optional[str] = None
    is_valid: bool


class ProviderVerificationStatusOut(BaseModel):
    """Aggregated verification status for a provider."""

    model_config = ConfigDict(from_attributes=True)

    provider_id: uuid.UUID
    current_level: str
    profile_status: str
    overall_status: str
    background_check: dict[str, Any]
    credentials: list[CredentialDetailOut]
    insurance_policies: list[InsuranceDetailOut]
    level_requirements: dict[str, Any]
    warnings: list[str]


class AdminActionOut(BaseModel):
    """Result of an admin approve or reject action."""

    model_config = ConfigDict(from_attributes=True)

    credential_id: uuid.UUID
    action: str
    new_status: str
    performed_by: uuid.UUID
    performed_at: datetime
