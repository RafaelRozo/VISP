"""
Provider Credential Verification Service for VISP.

Handles the full lifecycle of provider verification:

- Background check submission and tracking
- Professional license / certification submission and review
- Insurance policy submission and review
- Admin approval and rejection workflows
- Provider verification status aggregation
- Automated expiry detection and provider suspension

Business rules enforced:
- Level 1: CRC background check mandatory
- Level 3+: valid professional license + $2M general liability insurance required
- Level 4: all Level 3 requirements + extended emergency insurance
- Expired mandatory credentials auto-suspend the provider

All methods are async and accept an ``AsyncSession`` for transactional safety.
"""

from __future__ import annotations

import enum
import logging
import uuid
from dataclasses import dataclass
from datetime import date, datetime, timedelta, timezone
from typing import Any, Optional, Sequence

from sqlalchemy import and_, or_, select, update
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.models import (
    BackgroundCheckStatus,
    CredentialStatus,
    CredentialType,
    InsuranceStatus,
    ProviderCredential,
    ProviderInsurancePolicy,
    ProviderLevel,
    ProviderLevelRecord,
    ProviderProfile,
    ProviderProfileStatus,
)
from src.services.backgroundCheckIntegration import (
    BackgroundCheckType,
    CheckProvider,
    CheckSubmission,
    CheckSubmissionResult,
    get_background_check_adapter,
    get_fee,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Constants
# ---------------------------------------------------------------------------

# Minimum insurance coverage in cents for Level 3+ providers ($2,000,000)
LEVEL_3_MIN_INSURANCE_CENTS: int = 200_000_000

# Warning window before credential expiry (days)
EXPIRY_WARNING_DAYS: int = 30

# Background check validity period (days)
BACKGROUND_CHECK_VALIDITY_DAYS: int = 365


# ---------------------------------------------------------------------------
# Response DTOs
# ---------------------------------------------------------------------------

class VerificationStatusSummary(str, enum.Enum):
    """Overall verification status for a provider."""
    NOT_STARTED = "not_started"
    INCOMPLETE = "incomplete"
    PENDING_REVIEW = "pending_review"
    VERIFIED = "verified"
    EXPIRED = "expired"
    SUSPENDED = "suspended"


@dataclass
class BackgroundCheckSubmissionResponse:
    """Returned after submitting a background check."""
    credential_id: uuid.UUID
    external_reference_id: str
    check_type: str
    provider_name: str
    status: str
    estimated_fee_cents: Optional[int]


@dataclass
class CredentialSubmissionResponse:
    """Returned after submitting a license or certification."""
    credential_id: uuid.UUID
    credential_type: str
    name: str
    status: str


@dataclass
class InsuranceSubmissionResponse:
    """Returned after submitting an insurance policy."""
    policy_id: uuid.UUID
    policy_number: str
    insurer_name: str
    coverage_amount_cents: int
    status: str


@dataclass
class CredentialDetail:
    """Detailed view of a single credential."""
    id: uuid.UUID
    credential_type: str
    name: str
    issuing_authority: Optional[str]
    credential_number: Optional[str]
    jurisdiction_country: Optional[str]
    jurisdiction_province_state: Optional[str]
    issued_date: Optional[date]
    expiry_date: Optional[date]
    status: str
    verified_at: Optional[datetime]
    rejection_reason: Optional[str]
    document_url: Optional[str]
    created_at: datetime


@dataclass
class InsuranceDetail:
    """Detailed view of a single insurance policy."""
    id: uuid.UUID
    policy_number: str
    insurer_name: str
    policy_type: str
    coverage_amount_cents: int
    deductible_cents: Optional[int]
    effective_date: date
    expiry_date: date
    status: str
    verified_at: Optional[datetime]
    document_url: Optional[str]
    created_at: datetime


@dataclass
class ProviderVerificationStatus:
    """Aggregated verification status for a provider."""
    provider_id: uuid.UUID
    current_level: str
    profile_status: str
    overall_status: VerificationStatusSummary
    background_check: dict[str, Any]
    credentials: list[CredentialDetail]
    insurance_policies: list[InsuranceDetail]
    level_requirements: dict[str, Any]
    warnings: list[str]


@dataclass
class AdminActionResponse:
    """Result of an admin approve or reject action."""
    credential_id: uuid.UUID
    action: str
    new_status: str
    performed_by: uuid.UUID
    performed_at: datetime


@dataclass
class ExpiryCheckResult:
    """Result of the automated expiry check job."""
    credentials_expired: int
    credentials_warning_sent: int
    insurance_expired: int
    insurance_warning_sent: int
    providers_suspended: int
    background_checks_expired: int


# ---------------------------------------------------------------------------
# Service methods
# ---------------------------------------------------------------------------

async def submit_background_check(
    db: AsyncSession,
    provider_id: uuid.UUID,
    check_type: BackgroundCheckType,
    check_provider: CheckProvider,
    applicant_first_name: str,
    applicant_last_name: str,
    applicant_email: str,
    date_of_birth: date,
    address_line_1: str,
    city: str,
    province: str,
    postal_code: str,
    country: str = "CA",
    address_line_2: Optional[str] = None,
    phone: Optional[str] = None,
) -> BackgroundCheckSubmissionResponse:
    """Submit a background check request for a provider.

    Creates a ``ProviderCredential`` of type ``background_check`` and forwards
    the request to the external provider adapter.  Updates the provider
    profile's background check status to ``pending``.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        check_type: CRC, CRJMC, or VSC.
        check_provider: Which external service to use.
        applicant_first_name: Legal first name.
        applicant_last_name: Legal last name.
        applicant_email: Contact email.
        date_of_birth: Applicant date of birth.
        address_line_1: Primary address line.
        city: City name.
        province: Province or state code.
        postal_code: Postal / ZIP code.
        country: ISO 3166-1 alpha-2 country code.
        address_line_2: Optional secondary address line.
        phone: Optional phone number.

    Returns:
        BackgroundCheckSubmissionResponse with credential details.

    Raises:
        ValueError: If the provider profile does not exist.
    """
    # Validate provider exists
    profile = await _get_provider_profile(db, provider_id)

    # Build submission payload
    submission = CheckSubmission(
        provider_id=provider_id,
        applicant_first_name=applicant_first_name,
        applicant_last_name=applicant_last_name,
        applicant_email=applicant_email,
        date_of_birth=date_of_birth,
        check_type=check_type,
        address_line_1=address_line_1,
        city=city,
        province=province,
        postal_code=postal_code,
        country=country,
        address_line_2=address_line_2,
        phone=phone,
    )

    # Submit to external provider
    adapter = get_background_check_adapter(check_provider)
    result: CheckSubmissionResult = await adapter.submit_check(submission)

    # Create credential record
    credential = ProviderCredential(
        provider_id=provider_id,
        credential_type=CredentialType.BACKGROUND_CHECK,
        name=f"{check_type.value.upper()} - {check_provider.value}",
        issuing_authority=check_provider.value,
        credential_number=result.external_reference_id,
        jurisdiction_country=country,
        jurisdiction_province_state=province,
        status=CredentialStatus.PENDING_REVIEW,
    )
    db.add(credential)

    # Update provider profile background check status
    profile.background_check_status = BackgroundCheckStatus.PENDING
    profile.background_check_ref = result.external_reference_id

    await db.flush()

    logger.info(
        "Background check submitted: provider=%s, type=%s, ref=%s",
        provider_id,
        check_type.value,
        result.external_reference_id,
    )

    return BackgroundCheckSubmissionResponse(
        credential_id=credential.id,
        external_reference_id=result.external_reference_id,
        check_type=check_type.value,
        provider_name=check_provider.value,
        status=CredentialStatus.PENDING_REVIEW.value,
        estimated_fee_cents=result.fee_cents,
    )


async def submit_credential(
    db: AsyncSession,
    provider_id: uuid.UUID,
    credential_type: CredentialType,
    name: str,
    issuing_authority: Optional[str] = None,
    credential_number: Optional[str] = None,
    jurisdiction_country: Optional[str] = None,
    jurisdiction_province_state: Optional[str] = None,
    issued_date: Optional[date] = None,
    expiry_date: Optional[date] = None,
    document_url: Optional[str] = None,
    document_hash: Optional[str] = None,
) -> CredentialSubmissionResponse:
    """Submit a professional license, certification, permit, or training credential.

    The credential is created with ``pending_review`` status and must be
    approved by an admin before it becomes active.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        credential_type: LICENSE, CERTIFICATION, PERMIT, or TRAINING.
        name: Human-readable credential name (e.g. "Ontario Master Electrician").
        issuing_authority: Body that issued the credential.
        credential_number: License / certificate number.
        jurisdiction_country: ISO country code.
        jurisdiction_province_state: Province or state.
        issued_date: When the credential was issued.
        expiry_date: When the credential expires.
        document_url: S3 URL to uploaded document.
        document_hash: SHA-256 hash of the uploaded document.

    Returns:
        CredentialSubmissionResponse.

    Raises:
        ValueError: If the provider profile does not exist.
        ValueError: If credential_type is BACKGROUND_CHECK (use submit_background_check).
    """
    if credential_type == CredentialType.BACKGROUND_CHECK:
        raise ValueError(
            "Background checks must be submitted via submit_background_check(). "
            "Use submit_credential() for licenses, certifications, permits, and training."
        )

    # Validate provider exists
    await _get_provider_profile(db, provider_id)

    credential = ProviderCredential(
        provider_id=provider_id,
        credential_type=credential_type,
        name=name,
        issuing_authority=issuing_authority,
        credential_number=credential_number,
        jurisdiction_country=jurisdiction_country,
        jurisdiction_province_state=jurisdiction_province_state,
        issued_date=issued_date,
        expiry_date=expiry_date,
        status=CredentialStatus.PENDING_REVIEW,
        document_url=document_url,
        document_hash=document_hash,
    )
    db.add(credential)
    await db.flush()

    logger.info(
        "Credential submitted: provider=%s, type=%s, name=%s, id=%s",
        provider_id,
        credential_type.value,
        name,
        credential.id,
    )

    return CredentialSubmissionResponse(
        credential_id=credential.id,
        credential_type=credential_type.value,
        name=name,
        status=CredentialStatus.PENDING_REVIEW.value,
    )


async def submit_insurance(
    db: AsyncSession,
    provider_id: uuid.UUID,
    policy_number: str,
    insurer_name: str,
    policy_type: str,
    coverage_amount_cents: int,
    effective_date: date,
    expiry_date: date,
    deductible_cents: Optional[int] = None,
    document_url: Optional[str] = None,
    document_hash: Optional[str] = None,
) -> InsuranceSubmissionResponse:
    """Submit an insurance policy for verification.

    The policy is created with ``pending_review`` status.  Level 3+ providers
    must have at least $2M in general liability coverage.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        policy_number: Insurance policy number.
        insurer_name: Name of the insurance company.
        policy_type: Type (e.g. "general_liability", "professional_liability", "emergency").
        coverage_amount_cents: Coverage amount in cents.
        effective_date: Policy start date.
        expiry_date: Policy end date.
        deductible_cents: Optional deductible in cents.
        document_url: S3 URL to uploaded document.
        document_hash: SHA-256 hash of the uploaded document.

    Returns:
        InsuranceSubmissionResponse.

    Raises:
        ValueError: If provider profile does not exist.
        ValueError: If expiry_date is before effective_date.
    """
    if expiry_date <= effective_date:
        raise ValueError("Insurance expiry_date must be after effective_date.")

    # Validate provider exists
    await _get_provider_profile(db, provider_id)

    policy = ProviderInsurancePolicy(
        provider_id=provider_id,
        policy_number=policy_number,
        insurer_name=insurer_name,
        policy_type=policy_type,
        coverage_amount_cents=coverage_amount_cents,
        deductible_cents=deductible_cents,
        effective_date=effective_date,
        expiry_date=expiry_date,
        status=InsuranceStatus.PENDING_REVIEW,
        document_url=document_url,
        document_hash=document_hash,
    )
    db.add(policy)
    await db.flush()

    logger.info(
        "Insurance submitted: provider=%s, policy=%s, insurer=%s, coverage=%d cents, id=%s",
        provider_id,
        policy_number,
        insurer_name,
        coverage_amount_cents,
        policy.id,
    )

    return InsuranceSubmissionResponse(
        policy_id=policy.id,
        policy_number=policy_number,
        insurer_name=insurer_name,
        coverage_amount_cents=coverage_amount_cents,
        status=InsuranceStatus.PENDING_REVIEW.value,
    )


async def approve_credential(
    db: AsyncSession,
    credential_id: uuid.UUID,
    admin_user_id: uuid.UUID,
) -> AdminActionResponse:
    """Admin approves a credential (license, certification, or background check).

    Sets the credential status to ``verified`` and records the admin who approved.
    If the credential is a background check, also updates the provider profile's
    background check status to ``cleared``.

    Args:
        db: Async database session.
        credential_id: The credential UUID to approve.
        admin_user_id: The admin user UUID performing the action.

    Returns:
        AdminActionResponse.

    Raises:
        ValueError: If credential is not found or not in reviewable state.
    """
    credential = await _get_credential(db, credential_id)

    if credential.status not in (CredentialStatus.PENDING_REVIEW, CredentialStatus.REJECTED):
        raise ValueError(
            f"Credential {credential_id} is in status '{credential.status.value}' "
            f"and cannot be approved. Only 'pending_review' or 'rejected' credentials "
            f"can be approved."
        )

    now = datetime.now(timezone.utc)
    credential.status = CredentialStatus.VERIFIED
    credential.verified_at = now
    credential.verified_by = admin_user_id
    credential.rejection_reason = None  # Clear any previous rejection reason

    # If this is a background check, update the provider profile
    if credential.credential_type == CredentialType.BACKGROUND_CHECK:
        profile = await _get_provider_profile(db, credential.provider_id)
        profile.background_check_status = BackgroundCheckStatus.CLEARED
        profile.background_check_date = now.date()
        profile.background_check_expiry = (now + timedelta(days=BACKGROUND_CHECK_VALIDITY_DAYS)).date()

    await db.flush()

    logger.info(
        "Credential approved: id=%s, type=%s, approved_by=%s",
        credential_id,
        credential.credential_type.value,
        admin_user_id,
    )

    return AdminActionResponse(
        credential_id=credential_id,
        action="approved",
        new_status=CredentialStatus.VERIFIED.value,
        performed_by=admin_user_id,
        performed_at=now,
    )


async def reject_credential(
    db: AsyncSession,
    credential_id: uuid.UUID,
    admin_user_id: uuid.UUID,
    reason: str,
) -> AdminActionResponse:
    """Admin rejects a credential with a reason.

    Sets the credential status to ``rejected`` and records the rejection reason.
    If the credential is a background check, updates the provider profile's
    background check status to ``rejected``.

    Args:
        db: Async database session.
        credential_id: The credential UUID to reject.
        admin_user_id: The admin user UUID performing the action.
        reason: Mandatory rejection reason for the provider.

    Returns:
        AdminActionResponse.

    Raises:
        ValueError: If credential is not found or not in reviewable state.
        ValueError: If reason is empty.
    """
    if not reason or not reason.strip():
        raise ValueError("A rejection reason is required.")

    credential = await _get_credential(db, credential_id)

    if credential.status not in (CredentialStatus.PENDING_REVIEW, CredentialStatus.VERIFIED):
        raise ValueError(
            f"Credential {credential_id} is in status '{credential.status.value}' "
            f"and cannot be rejected. Only 'pending_review' or 'verified' credentials "
            f"can be rejected."
        )

    now = datetime.now(timezone.utc)
    credential.status = CredentialStatus.REJECTED
    credential.verified_at = None
    credential.verified_by = admin_user_id
    credential.rejection_reason = reason.strip()

    # If this is a background check, update the provider profile
    if credential.credential_type == CredentialType.BACKGROUND_CHECK:
        profile = await _get_provider_profile(db, credential.provider_id)
        profile.background_check_status = BackgroundCheckStatus.REJECTED

    await db.flush()

    logger.info(
        "Credential rejected: id=%s, type=%s, rejected_by=%s, reason=%s",
        credential_id,
        credential.credential_type.value,
        admin_user_id,
        reason[:100],
    )

    return AdminActionResponse(
        credential_id=credential_id,
        action="rejected",
        new_status=CredentialStatus.REJECTED.value,
        performed_by=admin_user_id,
        performed_at=now,
    )


async def approve_insurance(
    db: AsyncSession,
    policy_id: uuid.UUID,
    admin_user_id: uuid.UUID,
) -> AdminActionResponse:
    """Admin approves an insurance policy.

    Args:
        db: Async database session.
        policy_id: The insurance policy UUID.
        admin_user_id: The admin user UUID.

    Returns:
        AdminActionResponse.
    """
    policy = await _get_insurance_policy(db, policy_id)

    if policy.status not in (InsuranceStatus.PENDING_REVIEW, InsuranceStatus.REJECTED):
        raise ValueError(
            f"Insurance policy {policy_id} is in status '{policy.status.value}' "
            f"and cannot be approved."
        )

    now = datetime.now(timezone.utc)
    policy.status = InsuranceStatus.VERIFIED
    policy.verified_at = now
    policy.verified_by = admin_user_id

    await db.flush()

    logger.info(
        "Insurance approved: id=%s, approved_by=%s",
        policy_id,
        admin_user_id,
    )

    return AdminActionResponse(
        credential_id=policy_id,
        action="approved",
        new_status=InsuranceStatus.VERIFIED.value,
        performed_by=admin_user_id,
        performed_at=now,
    )


async def reject_insurance(
    db: AsyncSession,
    policy_id: uuid.UUID,
    admin_user_id: uuid.UUID,
    reason: str,
) -> AdminActionResponse:
    """Admin rejects an insurance policy.

    Args:
        db: Async database session.
        policy_id: The insurance policy UUID.
        admin_user_id: The admin user UUID.
        reason: Mandatory rejection reason.

    Returns:
        AdminActionResponse.
    """
    if not reason or not reason.strip():
        raise ValueError("A rejection reason is required.")

    policy = await _get_insurance_policy(db, policy_id)

    if policy.status not in (InsuranceStatus.PENDING_REVIEW, InsuranceStatus.VERIFIED):
        raise ValueError(
            f"Insurance policy {policy_id} is in status '{policy.status.value}' "
            f"and cannot be rejected."
        )

    now = datetime.now(timezone.utc)
    policy.status = InsuranceStatus.REJECTED
    policy.verified_at = None
    policy.verified_by = admin_user_id

    await db.flush()

    logger.info(
        "Insurance rejected: id=%s, rejected_by=%s, reason=%s",
        policy_id,
        admin_user_id,
        reason[:100],
    )

    return AdminActionResponse(
        credential_id=policy_id,
        action="rejected",
        new_status=InsuranceStatus.REJECTED.value,
        performed_by=admin_user_id,
        performed_at=now,
    )


async def check_provider_status(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> ProviderVerificationStatus:
    """Get the full verification status for a provider.

    Aggregates background check status, all credentials, all insurance policies,
    and computes level-specific requirement compliance.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.

    Returns:
        ProviderVerificationStatus with complete verification details.

    Raises:
        ValueError: If the provider profile does not exist.
    """
    profile = await _get_provider_profile_with_relations(db, provider_id)
    today = date.today()
    warnings: list[str] = []

    # ---- Background check status ----
    background_check_info = {
        "status": profile.background_check_status.value,
        "check_date": profile.background_check_date.isoformat() if profile.background_check_date else None,
        "expiry_date": profile.background_check_expiry.isoformat() if profile.background_check_expiry else None,
        "reference": profile.background_check_ref,
        "is_valid": (
            profile.background_check_status == BackgroundCheckStatus.CLEARED
            and profile.background_check_expiry is not None
            and profile.background_check_expiry > today
        ),
    }

    # Check background check expiry warning
    if (
        profile.background_check_expiry
        and profile.background_check_status == BackgroundCheckStatus.CLEARED
    ):
        days_until_expiry = (profile.background_check_expiry - today).days
        if 0 < days_until_expiry <= EXPIRY_WARNING_DAYS:
            warnings.append(
                f"Background check expires in {days_until_expiry} days "
                f"(expiry: {profile.background_check_expiry.isoformat()})."
            )

    # ---- Credentials ----
    credential_details: list[CredentialDetail] = []
    for cred in profile.credentials:
        credential_details.append(_credential_to_detail(cred))
        # Expiry warnings for verified credentials
        if (
            cred.status == CredentialStatus.VERIFIED
            and cred.expiry_date
        ):
            days_left = (cred.expiry_date - today).days
            if 0 < days_left <= EXPIRY_WARNING_DAYS:
                warnings.append(
                    f"Credential '{cred.name}' expires in {days_left} days "
                    f"(expiry: {cred.expiry_date.isoformat()})."
                )
            elif days_left <= 0:
                warnings.append(
                    f"Credential '{cred.name}' has EXPIRED "
                    f"(expiry: {cred.expiry_date.isoformat()})."
                )

    # ---- Insurance policies ----
    insurance_details: list[InsuranceDetail] = []
    for policy in profile.insurance_policies:
        insurance_details.append(_insurance_to_detail(policy))
        if (
            policy.status == InsuranceStatus.VERIFIED
            and policy.expiry_date
        ):
            days_left = (policy.expiry_date - today).days
            if 0 < days_left <= EXPIRY_WARNING_DAYS:
                warnings.append(
                    f"Insurance policy '{policy.policy_number}' expires in {days_left} days "
                    f"(expiry: {policy.expiry_date.isoformat()})."
                )
            elif days_left <= 0:
                warnings.append(
                    f"Insurance policy '{policy.policy_number}' has EXPIRED "
                    f"(expiry: {policy.expiry_date.isoformat()})."
                )

    # ---- Level requirements ----
    level_reqs = _compute_level_requirements(profile, credential_details, insurance_details, today)

    # ---- Overall status ----
    overall = _compute_overall_status(profile, level_reqs, credential_details, insurance_details)

    return ProviderVerificationStatus(
        provider_id=provider_id,
        current_level=profile.current_level.value,
        profile_status=profile.status.value,
        overall_status=overall,
        background_check=background_check_info,
        credentials=credential_details,
        insurance_policies=insurance_details,
        level_requirements=level_reqs,
        warnings=warnings,
    )


async def get_provider_credentials(
    db: AsyncSession,
    provider_id: uuid.UUID,
    credential_type: Optional[CredentialType] = None,
    status: Optional[CredentialStatus] = None,
) -> list[CredentialDetail]:
    """List all credentials for a provider, with optional filters.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        credential_type: Optional filter by credential type.
        status: Optional filter by status.

    Returns:
        List of CredentialDetail objects.
    """
    stmt = select(ProviderCredential).where(
        ProviderCredential.provider_id == provider_id
    )

    if credential_type is not None:
        stmt = stmt.where(ProviderCredential.credential_type == credential_type)
    if status is not None:
        stmt = stmt.where(ProviderCredential.status == status)

    stmt = stmt.order_by(ProviderCredential.created_at.desc())

    result = await db.execute(stmt)
    credentials = result.scalars().all()

    return [_credential_to_detail(c) for c in credentials]


async def get_provider_insurance_policies(
    db: AsyncSession,
    provider_id: uuid.UUID,
    status: Optional[InsuranceStatus] = None,
) -> list[InsuranceDetail]:
    """List all insurance policies for a provider, with optional status filter.

    Args:
        db: Async database session.
        provider_id: The provider profile UUID.
        status: Optional filter by status.

    Returns:
        List of InsuranceDetail objects.
    """
    stmt = select(ProviderInsurancePolicy).where(
        ProviderInsurancePolicy.provider_id == provider_id
    )

    if status is not None:
        stmt = stmt.where(ProviderInsurancePolicy.status == status)

    stmt = stmt.order_by(ProviderInsurancePolicy.created_at.desc())

    result = await db.execute(stmt)
    policies = result.scalars().all()

    return [_insurance_to_detail(p) for p in policies]


async def auto_expire_check(
    db: AsyncSession,
    reference_date: Optional[date] = None,
) -> ExpiryCheckResult:
    """Check and expire credentials and insurance policies past their expiry date.

    This method is intended to be called by a daily scheduled job. It:

    1. Marks verified credentials with past expiry dates as ``expired``.
    2. Marks verified insurance policies with past expiry dates as ``expired``.
    3. Marks provider background checks as ``expired`` if past expiry.
    4. Suspends Level 3/4 providers who have expired mandatory credentials.
    5. Collects counts of items approaching expiry for warning notifications.

    Args:
        db: Async database session.
        reference_date: The date to check against (defaults to today).

    Returns:
        ExpiryCheckResult with counts of all actions taken.
    """
    today = reference_date or date.today()
    warning_date = today + timedelta(days=EXPIRY_WARNING_DAYS)

    credentials_expired = 0
    credentials_warning = 0
    insurance_expired = 0
    insurance_warning = 0
    providers_suspended = 0
    bg_checks_expired = 0

    # ---- 1. Expire credentials ----
    expired_creds_stmt = select(ProviderCredential).where(
        and_(
            ProviderCredential.status == CredentialStatus.VERIFIED,
            ProviderCredential.expiry_date.isnot(None),
            ProviderCredential.expiry_date < today,
        )
    )
    result = await db.execute(expired_creds_stmt)
    expired_creds: Sequence[ProviderCredential] = result.scalars().all()
    for cred in expired_creds:
        cred.status = CredentialStatus.EXPIRED
        credentials_expired += 1
        logger.info(
            "Credential expired: id=%s, name=%s, provider=%s, expiry=%s",
            cred.id,
            cred.name,
            cred.provider_id,
            cred.expiry_date,
        )

    # Count credentials approaching expiry (for notifications)
    warning_creds_stmt = select(ProviderCredential).where(
        and_(
            ProviderCredential.status == CredentialStatus.VERIFIED,
            ProviderCredential.expiry_date.isnot(None),
            ProviderCredential.expiry_date >= today,
            ProviderCredential.expiry_date <= warning_date,
        )
    )
    result = await db.execute(warning_creds_stmt)
    credentials_warning = len(result.scalars().all())

    # ---- 2. Expire insurance policies ----
    expired_ins_stmt = select(ProviderInsurancePolicy).where(
        and_(
            ProviderInsurancePolicy.status == InsuranceStatus.VERIFIED,
            ProviderInsurancePolicy.expiry_date < today,
        )
    )
    result = await db.execute(expired_ins_stmt)
    expired_policies: Sequence[ProviderInsurancePolicy] = result.scalars().all()
    for policy in expired_policies:
        policy.status = InsuranceStatus.EXPIRED
        insurance_expired += 1
        logger.info(
            "Insurance expired: id=%s, policy=%s, provider=%s, expiry=%s",
            policy.id,
            policy.policy_number,
            policy.provider_id,
            policy.expiry_date,
        )

    # Count insurance approaching expiry
    warning_ins_stmt = select(ProviderInsurancePolicy).where(
        and_(
            ProviderInsurancePolicy.status == InsuranceStatus.VERIFIED,
            ProviderInsurancePolicy.expiry_date >= today,
            ProviderInsurancePolicy.expiry_date <= warning_date,
        )
    )
    result = await db.execute(warning_ins_stmt)
    insurance_warning = len(result.scalars().all())

    # ---- 3. Expire background checks ----
    bg_expired_stmt = select(ProviderProfile).where(
        and_(
            ProviderProfile.background_check_status == BackgroundCheckStatus.CLEARED,
            ProviderProfile.background_check_expiry.isnot(None),
            ProviderProfile.background_check_expiry < today,
        )
    )
    result = await db.execute(bg_expired_stmt)
    bg_expired_profiles: Sequence[ProviderProfile] = result.scalars().all()
    for profile in bg_expired_profiles:
        profile.background_check_status = BackgroundCheckStatus.EXPIRED
        bg_checks_expired += 1
        logger.info(
            "Background check expired: provider=%s, expiry=%s",
            profile.id,
            profile.background_check_expiry,
        )

    await db.flush()

    # ---- 4. Suspend Level 3/4 providers with expired mandatory credentials ----
    providers_suspended = await _suspend_providers_with_expired_mandatory_credentials(
        db, today
    )

    await db.flush()

    result_summary = ExpiryCheckResult(
        credentials_expired=credentials_expired,
        credentials_warning_sent=credentials_warning,
        insurance_expired=insurance_expired,
        insurance_warning_sent=insurance_warning,
        providers_suspended=providers_suspended,
        background_checks_expired=bg_checks_expired,
    )

    logger.info(
        "Expiry check completed: expired_creds=%d, warn_creds=%d, expired_ins=%d, "
        "warn_ins=%d, suspended=%d, expired_bg=%d",
        credentials_expired,
        credentials_warning,
        insurance_expired,
        insurance_warning,
        providers_suspended,
        bg_checks_expired,
    )

    return result_summary


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_provider_profile(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> ProviderProfile:
    """Fetch a provider profile by ID or raise ValueError."""
    stmt = select(ProviderProfile).where(ProviderProfile.id == provider_id)
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    if profile is None:
        raise ValueError(f"Provider profile not found: {provider_id}")
    return profile


async def _get_provider_profile_with_relations(
    db: AsyncSession,
    provider_id: uuid.UUID,
) -> ProviderProfile:
    """Fetch a provider profile with credentials and insurance eagerly loaded."""
    stmt = (
        select(ProviderProfile)
        .options(
            selectinload(ProviderProfile.credentials),
            selectinload(ProviderProfile.insurance_policies),
            selectinload(ProviderProfile.levels),
        )
        .where(ProviderProfile.id == provider_id)
    )
    result = await db.execute(stmt)
    profile = result.scalar_one_or_none()
    if profile is None:
        raise ValueError(f"Provider profile not found: {provider_id}")
    return profile


async def _get_credential(
    db: AsyncSession,
    credential_id: uuid.UUID,
) -> ProviderCredential:
    """Fetch a credential by ID or raise ValueError."""
    stmt = select(ProviderCredential).where(ProviderCredential.id == credential_id)
    result = await db.execute(stmt)
    credential = result.scalar_one_or_none()
    if credential is None:
        raise ValueError(f"Credential not found: {credential_id}")
    return credential


async def _get_insurance_policy(
    db: AsyncSession,
    policy_id: uuid.UUID,
) -> ProviderInsurancePolicy:
    """Fetch an insurance policy by ID or raise ValueError."""
    stmt = select(ProviderInsurancePolicy).where(ProviderInsurancePolicy.id == policy_id)
    result = await db.execute(stmt)
    policy = result.scalar_one_or_none()
    if policy is None:
        raise ValueError(f"Insurance policy not found: {policy_id}")
    return policy


def _credential_to_detail(cred: ProviderCredential) -> CredentialDetail:
    """Map a ProviderCredential ORM object to a CredentialDetail DTO."""
    return CredentialDetail(
        id=cred.id,
        credential_type=cred.credential_type.value,
        name=cred.name,
        issuing_authority=cred.issuing_authority,
        credential_number=cred.credential_number,
        jurisdiction_country=cred.jurisdiction_country,
        jurisdiction_province_state=cred.jurisdiction_province_state,
        issued_date=cred.issued_date,
        expiry_date=cred.expiry_date,
        status=cred.status.value,
        verified_at=cred.verified_at,
        rejection_reason=cred.rejection_reason,
        document_url=cred.document_url,
        created_at=cred.created_at,
    )


def _insurance_to_detail(policy: ProviderInsurancePolicy) -> InsuranceDetail:
    """Map a ProviderInsurancePolicy ORM object to an InsuranceDetail DTO."""
    return InsuranceDetail(
        id=policy.id,
        policy_number=policy.policy_number,
        insurer_name=policy.insurer_name,
        policy_type=policy.policy_type,
        coverage_amount_cents=policy.coverage_amount_cents,
        deductible_cents=policy.deductible_cents,
        effective_date=policy.effective_date,
        expiry_date=policy.expiry_date,
        status=policy.status.value,
        verified_at=policy.verified_at,
        document_url=policy.document_url,
        created_at=policy.created_at,
    )


def _compute_level_requirements(
    profile: ProviderProfile,
    credentials: list[CredentialDetail],
    insurance_policies: list[InsuranceDetail],
    today: date,
) -> dict[str, Any]:
    """Compute whether a provider meets the requirements for their current level.

    Level 1 (Helper):
        - CRC background check: CLEARED and not expired

    Level 2 (Experienced):
        - All Level 1 requirements
        - Portfolio (nice-to-have, not blocking)

    Level 3 (Certified Pro):
        - All Level 1 requirements
        - At least one verified, non-expired license
        - $2M+ general liability insurance, verified and non-expired

    Level 4 (Emergency):
        - All Level 3 requirements
        - Extended emergency insurance coverage
    """
    level = profile.current_level
    reqs: dict[str, Any] = {
        "level": level.value,
        "requirements_met": True,
        "details": {},
    }

    # -- Background check (all levels) --
    bg_valid = (
        profile.background_check_status == BackgroundCheckStatus.CLEARED
        and profile.background_check_expiry is not None
        and profile.background_check_expiry > today
    )
    reqs["details"]["background_check"] = {
        "required": True,
        "met": bg_valid,
        "status": profile.background_check_status.value,
        "expiry": profile.background_check_expiry.isoformat() if profile.background_check_expiry else None,
    }
    if not bg_valid:
        reqs["requirements_met"] = False

    if level in (ProviderLevel.LEVEL_3, ProviderLevel.LEVEL_4):
        # -- License requirement --
        has_valid_license = any(
            c.credential_type in ("license", "certification")
            and c.status == CredentialStatus.VERIFIED.value
            and (c.expiry_date is None or c.expiry_date > today)
            for c in credentials
        )
        reqs["details"]["professional_license"] = {
            "required": True,
            "met": has_valid_license,
        }
        if not has_valid_license:
            reqs["requirements_met"] = False

        # -- General liability insurance >= $2M --
        has_valid_gl_insurance = any(
            p.policy_type == "general_liability"
            and p.status == InsuranceStatus.VERIFIED.value
            and p.coverage_amount_cents >= LEVEL_3_MIN_INSURANCE_CENTS
            and p.effective_date <= today
            and p.expiry_date > today
            for p in insurance_policies
        )
        reqs["details"]["general_liability_insurance"] = {
            "required": True,
            "met": has_valid_gl_insurance,
            "minimum_coverage_cents": LEVEL_3_MIN_INSURANCE_CENTS,
        }
        if not has_valid_gl_insurance:
            reqs["requirements_met"] = False

    if level == ProviderLevel.LEVEL_4:
        # -- Emergency insurance (additional to GL) --
        has_emergency_insurance = any(
            p.policy_type == "emergency"
            and p.status == InsuranceStatus.VERIFIED.value
            and p.effective_date <= today
            and p.expiry_date > today
            for p in insurance_policies
        )
        reqs["details"]["emergency_insurance"] = {
            "required": True,
            "met": has_emergency_insurance,
        }
        if not has_emergency_insurance:
            reqs["requirements_met"] = False

    return reqs


def _compute_overall_status(
    profile: ProviderProfile,
    level_reqs: dict[str, Any],
    credentials: list[CredentialDetail],
    insurance_policies: list[InsuranceDetail],
) -> VerificationStatusSummary:
    """Derive the overall verification status from individual components."""
    if profile.status == ProviderProfileStatus.SUSPENDED:
        return VerificationStatusSummary.SUSPENDED

    # Check if anything is expired
    has_expired_creds = any(c.status == CredentialStatus.EXPIRED.value for c in credentials)
    has_expired_insurance = any(p.status == InsuranceStatus.EXPIRED.value for p in insurance_policies)
    if has_expired_creds or has_expired_insurance:
        return VerificationStatusSummary.EXPIRED

    # Check if anything is pending
    has_pending_creds = any(
        c.status == CredentialStatus.PENDING_REVIEW.value for c in credentials
    )
    has_pending_insurance = any(
        p.status == InsuranceStatus.PENDING_REVIEW.value for p in insurance_policies
    )
    if has_pending_creds or has_pending_insurance:
        return VerificationStatusSummary.PENDING_REVIEW

    # Check if level requirements are met
    if not level_reqs.get("requirements_met", False):
        return VerificationStatusSummary.INCOMPLETE

    # No credentials submitted at all
    if not credentials and not insurance_policies:
        bg_status = profile.background_check_status
        if bg_status == BackgroundCheckStatus.NOT_SUBMITTED:
            return VerificationStatusSummary.NOT_STARTED
        elif bg_status == BackgroundCheckStatus.PENDING:
            return VerificationStatusSummary.PENDING_REVIEW
        elif bg_status == BackgroundCheckStatus.CLEARED:
            # Level 1 with only background check may be sufficient
            if level_reqs.get("requirements_met", False):
                return VerificationStatusSummary.VERIFIED
        return VerificationStatusSummary.INCOMPLETE

    return VerificationStatusSummary.VERIFIED


async def _suspend_providers_with_expired_mandatory_credentials(
    db: AsyncSession,
    today: date,
) -> int:
    """Suspend Level 3/4 providers whose mandatory credentials have expired.

    Mandatory means:
    - Background check expired
    - No valid professional license (for Level 3/4)
    - No valid general liability insurance >= $2M (for Level 3/4)
    - No valid emergency insurance (for Level 4)

    Returns:
        Number of providers suspended.
    """
    suspended_count = 0

    # Find all active Level 3/4 providers
    stmt = (
        select(ProviderProfile)
        .options(
            selectinload(ProviderProfile.credentials),
            selectinload(ProviderProfile.insurance_policies),
        )
        .where(
            and_(
                ProviderProfile.status == ProviderProfileStatus.ACTIVE,
                ProviderProfile.current_level.in_([
                    ProviderLevel.LEVEL_3,
                    ProviderLevel.LEVEL_4,
                ]),
            )
        )
    )
    result = await db.execute(stmt)
    providers: Sequence[ProviderProfile] = result.scalars().all()

    for provider in providers:
        should_suspend = False
        reasons: list[str] = []

        # Check background check
        if (
            provider.background_check_status != BackgroundCheckStatus.CLEARED
            or provider.background_check_expiry is None
            or provider.background_check_expiry < today
        ):
            should_suspend = True
            reasons.append("Background check expired or invalid")

        # Check for valid license
        has_valid_license = any(
            c.credential_type in (CredentialType.LICENSE, CredentialType.CERTIFICATION)
            and c.status == CredentialStatus.VERIFIED
            and (c.expiry_date is None or c.expiry_date > today)
            for c in provider.credentials
        )
        if not has_valid_license:
            should_suspend = True
            reasons.append("No valid professional license")

        # Check for valid general liability insurance >= $2M
        has_valid_insurance = any(
            p.policy_type == "general_liability"
            and p.status == InsuranceStatus.VERIFIED
            and p.coverage_amount_cents >= LEVEL_3_MIN_INSURANCE_CENTS
            and p.effective_date <= today
            and p.expiry_date > today
            for p in provider.insurance_policies
        )
        if not has_valid_insurance:
            should_suspend = True
            reasons.append("No valid $2M general liability insurance")

        # Level 4 additional: emergency insurance
        if provider.current_level == ProviderLevel.LEVEL_4:
            has_emergency_insurance = any(
                p.policy_type == "emergency"
                and p.status == InsuranceStatus.VERIFIED
                and p.effective_date <= today
                and p.expiry_date > today
                for p in provider.insurance_policies
            )
            if not has_emergency_insurance:
                should_suspend = True
                reasons.append("No valid emergency insurance")

        if should_suspend:
            provider.status = ProviderProfileStatus.SUSPENDED
            suspended_count += 1
            logger.warning(
                "Provider SUSPENDED due to expired credentials: provider=%s, level=%s, reasons=%s",
                provider.id,
                provider.current_level.value,
                "; ".join(reasons),
            )

    return suspended_count
