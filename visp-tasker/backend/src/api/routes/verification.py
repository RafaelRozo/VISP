"""
Provider Verification API routes -- VISP-BE-VERIFICATION-004
=============================================================

Endpoints for the full provider verification lifecycle:

  POST /api/v1/verification/background-check            -- Submit a background check
  POST /api/v1/verification/license                      -- Submit a license credential
  POST /api/v1/verification/insurance                    -- Submit an insurance policy
  GET  /api/v1/verification/provider/{provider_id}/status -- Full verification status
  POST /api/v1/verification/admin/approve/{credential_id} -- Admin approve credential
  POST /api/v1/verification/admin/reject/{credential_id}  -- Admin reject credential
"""

from __future__ import annotations

import logging
import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import DBSession
from src.api.schemas.verification import (
    AdminActionOut,
    AdminApproveRequest,
    AdminRejectRequest,
    BackgroundCheckRequest,
    BackgroundCheckSubmissionOut,
    CredentialDetailOut,
    CredentialSubmissionOut,
    InsuranceDetailOut,
    InsurancePolicyRequest,
    InsuranceSubmissionOut,
    LicenseCredentialRequest,
    ProviderVerificationStatusOut,
)
from src.models import CredentialType
from src.services.backgroundCheckIntegration import BackgroundCheckType, CheckProvider
from src.services.verificationService import (
    approve_credential,
    check_provider_status,
    reject_credential,
    submit_background_check,
    submit_credential,
    submit_insurance,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/verification", tags=["Verification"])


# ---------------------------------------------------------------------------
# POST /api/v1/verification/background-check
# ---------------------------------------------------------------------------

@router.post(
    "/background-check",
    response_model=BackgroundCheckSubmissionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a background check request",
    description=(
        "Submit a Criminal Record Check (CRC), Criminal Record and Judicial "
        "Matters Check (CRJMC), or Vulnerable Sector Check (VSC) for a "
        "provider.  The request is forwarded to the selected external check "
        "provider and a credential record is created with pending_review status."
    ),
)
async def submit_background_check_route(
    body: BackgroundCheckRequest,
    db: DBSession,
) -> BackgroundCheckSubmissionOut:
    try:
        check_type = BackgroundCheckType(body.check_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Invalid check_type '{body.check_type}'. Must be one of: crc, crjmc, vsc.",
        )

    try:
        check_provider = CheckProvider(body.check_provider)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid check_provider '{body.check_provider}'. Must be one of: "
                "opp, toronto_police, mycrc, sterling_backcheck."
            ),
        )

    try:
        result = await submit_background_check(
            db=db,
            provider_id=body.provider_id,
            check_type=check_type,
            check_provider=check_provider,
            applicant_first_name=body.applicant_first_name,
            applicant_last_name=body.applicant_last_name,
            applicant_email=body.applicant_email,
            date_of_birth=body.date_of_birth,
            address_line_1=body.address_line_1,
            city=body.city,
            province=body.province,
            postal_code=body.postal_code,
            country=body.country,
            address_line_2=body.address_line_2,
            phone=body.phone,
        )
    except ValueError as exc:
        _raise_from_value_error(exc)

    return BackgroundCheckSubmissionOut(
        credential_id=result.credential_id,
        external_reference_id=result.external_reference_id,
        check_type=result.check_type,
        provider_name=result.provider_name,
        status=result.status,
        estimated_fee_cents=result.estimated_fee_cents,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/verification/license
# ---------------------------------------------------------------------------

@router.post(
    "/license",
    response_model=CredentialSubmissionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit a license or certification credential",
    description=(
        "Submit a professional license, certification, permit, or training "
        "credential for admin review.  The credential is created with "
        "pending_review status."
    ),
)
async def submit_license_route(
    body: LicenseCredentialRequest,
    db: DBSession,
) -> CredentialSubmissionOut:
    try:
        credential_type = CredentialType(body.credential_type)
    except ValueError:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=(
                f"Invalid credential_type '{body.credential_type}'. Must be one of: "
                "license, certification, permit, training."
            ),
        )

    try:
        result = await submit_credential(
            db=db,
            provider_id=body.provider_id,
            credential_type=credential_type,
            name=body.name,
            issuing_authority=body.issuing_authority,
            credential_number=body.credential_number,
            jurisdiction_country=body.jurisdiction_country,
            jurisdiction_province_state=body.jurisdiction,
            issued_date=body.issued_date,
            expiry_date=body.expiry_date,
            document_url=body.document_url,
        )
    except ValueError as exc:
        _raise_from_value_error(exc)

    return CredentialSubmissionOut(
        credential_id=result.credential_id,
        credential_type=result.credential_type,
        name=result.name,
        status=result.status,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/verification/insurance
# ---------------------------------------------------------------------------

@router.post(
    "/insurance",
    response_model=InsuranceSubmissionOut,
    status_code=status.HTTP_201_CREATED,
    summary="Submit an insurance policy",
    description=(
        "Submit an insurance policy for verification.  Level 3+ providers "
        "must have at least $2,000,000 in general liability coverage.  "
        "The policy is created with pending_review status."
    ),
)
async def submit_insurance_route(
    body: InsurancePolicyRequest,
    db: DBSession,
) -> InsuranceSubmissionOut:
    try:
        result = await submit_insurance(
            db=db,
            provider_id=body.provider_id,
            policy_number=body.policy_number,
            insurer_name=body.insurer_name,
            policy_type=body.policy_type,
            coverage_amount_cents=body.coverage_amount_cents,
            effective_date=body.effective_date,
            expiry_date=body.expiry_date,
            deductible_cents=body.deductible_cents,
            document_url=body.document_url,
        )
    except ValueError as exc:
        _raise_from_value_error(exc)

    return InsuranceSubmissionOut(
        policy_id=result.policy_id,
        policy_number=result.policy_number,
        insurer_name=result.insurer_name,
        coverage_amount_cents=result.coverage_amount_cents,
        status=result.status,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/verification/provider/{provider_id}/status
# ---------------------------------------------------------------------------

@router.get(
    "/provider/{provider_id}/status",
    response_model=ProviderVerificationStatusOut,
    summary="Get full verification status for a provider",
    description=(
        "Returns the aggregated verification status including background "
        "check, all credentials, all insurance policies, level-specific "
        "requirement compliance, and any active warnings."
    ),
)
async def get_provider_verification_status(
    provider_id: uuid.UUID,
    db: DBSession,
) -> ProviderVerificationStatusOut:
    try:
        result = await check_provider_status(db=db, provider_id=provider_id)
    except ValueError as exc:
        _raise_not_found(exc, entity="Provider")

    credentials_out = [
        CredentialDetailOut(
            id=c.id,
            credential_type=c.credential_type,
            name=c.name,
            issuing_authority=c.issuing_authority,
            credential_number=c.credential_number,
            jurisdiction_country=c.jurisdiction_country,
            jurisdiction_province_state=c.jurisdiction_province_state,
            issued_date=c.issued_date,
            expiry_date=c.expiry_date,
            status=c.status,
            verified_at=c.verified_at,
            rejection_reason=c.rejection_reason,
            document_url=c.document_url,
            created_at=c.created_at,
        )
        for c in result.credentials
    ]

    insurance_out = [
        InsuranceDetailOut(
            id=p.id,
            policy_number=p.policy_number,
            insurer_name=p.insurer_name,
            policy_type=p.policy_type,
            coverage_amount_cents=p.coverage_amount_cents,
            deductible_cents=p.deductible_cents,
            effective_date=p.effective_date,
            expiry_date=p.expiry_date,
            status=p.status,
            verified_at=p.verified_at,
            document_url=p.document_url,
            created_at=p.created_at,
        )
        for p in result.insurance_policies
    ]

    return ProviderVerificationStatusOut(
        provider_id=result.provider_id,
        current_level=result.current_level,
        profile_status=result.profile_status,
        overall_status=result.overall_status.value,
        background_check=result.background_check,
        credentials=credentials_out,
        insurance_policies=insurance_out,
        level_requirements=result.level_requirements,
        warnings=result.warnings,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/verification/admin/approve/{credential_id}
# ---------------------------------------------------------------------------

@router.post(
    "/admin/approve/{credential_id}",
    response_model=AdminActionOut,
    summary="Admin approve a credential",
    description=(
        "Approve a pending credential (license, certification, or background "
        "check).  Sets the credential status to verified.  If the credential "
        "is a background check, also updates the provider profile."
    ),
)
async def admin_approve_credential(
    credential_id: uuid.UUID,
    body: AdminApproveRequest,
    db: DBSession,
) -> AdminActionOut:
    try:
        result = await approve_credential(
            db=db,
            credential_id=credential_id,
            admin_user_id=body.admin_user_id,
        )
    except ValueError as exc:
        _raise_from_value_error(exc)

    return AdminActionOut(
        credential_id=result.credential_id,
        action=result.action,
        new_status=result.new_status,
        performed_by=result.performed_by,
        performed_at=result.performed_at,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/verification/admin/reject/{credential_id}
# ---------------------------------------------------------------------------

@router.post(
    "/admin/reject/{credential_id}",
    response_model=AdminActionOut,
    summary="Admin reject a credential",
    description=(
        "Reject a pending or verified credential with a mandatory reason.  "
        "Sets the credential status to rejected.  If the credential is a "
        "background check, also updates the provider profile."
    ),
)
async def admin_reject_credential(
    credential_id: uuid.UUID,
    body: AdminRejectRequest,
    db: DBSession,
) -> AdminActionOut:
    try:
        result = await reject_credential(
            db=db,
            credential_id=credential_id,
            admin_user_id=body.admin_user_id,
            reason=body.reason,
        )
    except ValueError as exc:
        _raise_from_value_error(exc)

    return AdminActionOut(
        credential_id=result.credential_id,
        action=result.action,
        new_status=result.new_status,
        performed_by=result.performed_by,
        performed_at=result.performed_at,
    )


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

def _raise_from_value_error(exc: ValueError) -> None:
    """Convert a service-layer ValueError into the appropriate HTTPException.

    - "not found" messages become 404
    - Everything else becomes 422 (validation / business rule failure)
    """
    message = str(exc)
    if "not found" in message.lower():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=message,
        )
    raise HTTPException(
        status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
        detail=message,
    )


def _raise_not_found(exc: ValueError, entity: str = "Resource") -> None:
    """Raise a 404 HTTPException from a ValueError."""
    raise HTTPException(
        status_code=status.HTTP_404_NOT_FOUND,
        detail=str(exc),
    )
