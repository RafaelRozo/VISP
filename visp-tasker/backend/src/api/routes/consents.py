"""
Legal Consent API routes — VISP-BE-LEGAL-007
=============================================

All endpoints are append-only: consents are never updated or deleted.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status

from src.api.deps import ClientIP, DBSession, UserAgent
from src.api.schemas.consent import (
    ConsentCheckResponse,
    ConsentListResponse,
    ConsentRecordRequest,
    ConsentRecordResponse,
)
from src.models.verification import ConsentType
from src.services.legalConsentService import (
    check_consent,
    get_user_consents,
    record_consent,
)

router = APIRouter(prefix="/consents", tags=["Legal Consents"])


# ---------------------------------------------------------------------------
# POST /api/v1/consents/record
# ---------------------------------------------------------------------------

@router.post(
    "/record",
    response_model=ConsentRecordResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Record a legal consent",
    description=(
        "Creates an immutable consent record.  The full consent text is "
        "stored alongside a SHA-256 hash for tamper detection.  Consent "
        "records are append-only and are never modified after creation."
    ),
)
async def record_consent_endpoint(
    body: ConsentRecordRequest,
    db: DBSession,
    client_ip: ClientIP,
    user_agent: UserAgent,
) -> ConsentRecordResponse:
    consent = await record_consent(
        db,
        user_id=body.user_id,
        consent_type=body.consent_type,
        consent_text=body.consent_text,
        ip_address=client_ip,
        user_agent=user_agent,
        device_id=body.device_id,
        granted=body.granted,
    )
    return ConsentRecordResponse.model_validate(consent)


# ---------------------------------------------------------------------------
# GET /api/v1/consents/user/{user_id}
# ---------------------------------------------------------------------------

@router.get(
    "/user/{user_id}",
    response_model=ConsentListResponse,
    summary="List all consents for a user",
    description=(
        "Returns every consent record for the given user, ordered by "
        "creation date descending (newest first).  Both grants and "
        "revocations are included."
    ),
)
async def list_user_consents(
    user_id: uuid.UUID,
    db: DBSession,
) -> ConsentListResponse:
    consents = await get_user_consents(db, user_id)
    return ConsentListResponse(
        user_id=user_id,
        consents=consents,  # Pydantic v2 from_attributes handles ORM objects
        total=len(consents),
    )


# ---------------------------------------------------------------------------
# GET /api/v1/consents/check/{user_id}/{consent_type}
# ---------------------------------------------------------------------------

@router.get(
    "/check/{user_id}/{consent_type}",
    response_model=ConsentCheckResponse,
    summary="Check if a user has valid consent",
    description=(
        "Returns whether the user currently has a valid (granted) consent "
        "of the specified type.  A consent is valid if the most recent "
        "record for that type is a grant (not a revocation)."
    ),
)
async def check_user_consent(
    user_id: uuid.UUID,
    consent_type: ConsentType,
    db: DBSession,
) -> ConsentCheckResponse:
    latest = await check_consent(db, user_id, consent_type)

    if latest is None:
        return ConsentCheckResponse(
            user_id=user_id,
            consent_type=consent_type,
            has_valid_consent=False,
        )

    return ConsentCheckResponse(
        user_id=user_id,
        consent_type=consent_type,
        has_valid_consent=True,
        latest_consent_id=latest.id,
        latest_consent_version=latest.consent_version,
        consented_at=latest.created_at,
    )
