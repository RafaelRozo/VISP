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

from pydantic import BaseModel, ConfigDict, Field, field_validator

from src.models.verification import ConsentType


# ---------------------------------------------------------------------------
# Request schemas
# ---------------------------------------------------------------------------

class ConsentRecordRequest(BaseModel):
    """Body of POST /api/v1/consents/record.

    ``user_id`` is NOT accepted here any more.  It used to come from the body
    on an unauthenticated endpoint, which meant anyone could fabricate a
    consent in anyone else's name -- and a record anyone can write proves
    nothing.  The signer is now taken from the bearer token.
    """

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
                    "consent_type": "platform_tos",
                    "consent_text": "Full terms of service text...",
                    "granted": True,
                    "device_id": "iPhone15,2",
                }
            ]
        }
    )


class SignatureStrokes(BaseModel):
    """El trazo dibujado, en coordenadas del lienzo de la app."""

    width: float = Field(..., gt=0, le=4000)
    height: float = Field(..., gt=0, le=4000)
    strokes: list[list[list[float]]] = Field(
        default_factory=list,
        description=(
            "Lista de trazos; cada trazo es una lista de puntos [x, y]. "
            "Vectorial a propósito: se guarda el original y de ahí sale el PNG."
        ),
    )

    @field_validator("strokes")
    @classmethod
    def _bound_size(cls, v: list[list[list[float]]]) -> list[list[list[float]]]:
        # Un trazo con el dedo son cientos de puntos, no cientos de miles.
        # Sin tope, un cliente malicioso mete megabytes en una columna TEXT.
        total = sum(len(s) for s in v)
        if len(v) > 200 or total > 20000:
            raise ValueError("signature too large")
        for stroke in v:
            for point in stroke:
                if len(point) != 2:
                    raise ValueError("each point must be [x, y]")
        return v


class ConsentSignRequest(BaseModel):
    """Body of POST /api/v1/consents/sign."""

    consent_type: ConsentType
    signed_full_name: str = Field(..., min_length=2, max_length=255)
    business_name: str | None = Field(default=None, max_length=255)
    document_hash: str = Field(
        ...,
        min_length=64,
        max_length=128,
        description=(
            "Hash del texto que la app MOSTRÓ. El servidor lo compara con el "
            "de la versión vigente y rechaza la firma si no coinciden: sin "
            "esta comprobación se podría archivar una versión distinta de la "
            "que el usuario leyó."
        ),
    )
    signature: SignatureStrokes | None = None
    device_id: str | None = Field(default=None, max_length=255)


class ConsentDocumentResponse(BaseModel):
    """Texto vigente de un documento legal, para mostrarlo antes de firmar."""

    consent_type: ConsentType
    version: str
    text: str
    hash: str
    requires_signature: bool
    format: str = "markdown"


class ConsentSignResponse(BaseModel):
    """Resultado de firmar."""

    consent_id: uuid.UUID
    consent_type: ConsentType
    consent_version: str
    signed_full_name: str
    document_hash: str
    document_url: str
    created_at: datetime


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


class PendingConsentItem(BaseModel):
    """Un documento que este usuario todavía no ha aceptado."""

    consent_type: ConsentType
    version: str
    requires_signature: bool


class PendingConsentsResponse(BaseModel):
    """Lo que le falta por firmar al dueño del token.

    ``suggested_legal_name`` viene del registro y la pantalla lo precarga
    EDITABLE: el campo del contrato es "Legal Name" y debe coincidir con la
    identificación oficial.
    """

    pending: list[PendingConsentItem]
    suggested_legal_name: str
    account_email: str
