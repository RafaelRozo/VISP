"""
Pydantic v2 schemas for the Legal Consent endpoints.

These schemas define the request/response contracts for recording, checking,
and listing legal consents.  They deliberately expose only the fields that
external consumers need; internal audit fields are surfaced only in the
read-side schemas.
"""

from __future__ import annotations

import uuid
from datetime import datetime

from pydantic import BaseModel, ConfigDict, Field

from src.models.verification import ConsentType


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ConsentRecordRequest(BaseModel):
    """Body of POST /api/v1/consents/record."""

    user_id: uuid.UUID = Field(
        ...,
        description="UUID of the user granting (or revoking) consent.",
    )
    consent_type: ConsentType = Field(
        ...,
        description="Type of consent being recorded.",
    )
    consent_text: str = Field(
        ...,
        min_length=1,
        description=(
            "Full legal text the user agreed to.  A SHA-256 hash of this "
            "text is stored alongside it for tamper detection."
        ),
    )
    granted: bool = Field(
        default=True,
        description="Whether the user is granting or revoking consent.",
    )
    device_id: str | None = Field(
        default=None,
        max_length=255,
        description="Optional device identifier for audit trail.",
    )

    model_config = ConfigDict(
        json_schema_extra={
            "examples": [
                {
                    "user_id": "a1b2c3d4-e5f6-7890-abcd-ef1234567890",
                    "consent_type": "platform_tos",
                    "consent_text": "Full terms of service text...",
                    "granted": True,
                    "device_id": "iPhone15,2",
                }
            ]
        }
    )


# ---------------------------------------------------------------------------
# Response schemas
# ---------------------------------------------------------------------------

class ConsentRecordResponse(BaseModel):
    """Returned after successfully recording a consent."""

    id: uuid.UUID
    user_id: uuid.UUID
    consent_type: ConsentType
    consent_version: str
    consent_text_hash: str
    granted: bool
    ip_address: str | None
    user_agent: str | None
    device_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConsentCheckResponse(BaseModel):
    """Result of checking whether a user has valid consent of a given type."""

    user_id: uuid.UUID
    consent_type: ConsentType
    has_valid_consent: bool
    latest_consent_id: uuid.UUID | None = None
    latest_consent_version: str | None = None
    consented_at: datetime | None = None

    model_config = ConfigDict(from_attributes=True)


class ConsentListItem(BaseModel):
    """Single item in the list of consents for a user."""

    id: uuid.UUID
    consent_type: ConsentType
    consent_version: str
    consent_text_hash: str
    granted: bool
    ip_address: str | None
    user_agent: str | None
    device_id: str | None
    created_at: datetime

    model_config = ConfigDict(from_attributes=True)


class ConsentListResponse(BaseModel):
    """Paginated list of consents for a user."""

    user_id: uuid.UUID
    consents: list[ConsentListItem]
    total: int
