"""
Legal Consent API routes — VISP-BE-LEGAL-007
=============================================

All endpoints are append-only: consents are never updated or deleted.

Autenticación (arreglado 2026-09-08, plan `docs/plan-firma-contratos.md`)
------------------------------------------------------------------------
Hasta hoy ``POST /consents/record`` no pedía token y tomaba el ``user_id``
**del body**: cualquiera podía fabricar un consentimiento a nombre de
cualquiera. El valor de estas filas es probatorio, y una fila que cualquiera
puede escribir no prueba nada. Ahora el firmante sale SIEMPRE del token.

Lo mismo con el PDF firmado: se sirve por un endpoint autenticado y nunca por
el mount estático de ``/uploads``. Un UUID es inadivinable, no es privado, y
aquí hay nombre legal completo y firma manuscrita.
"""

from __future__ import annotations

import uuid

from fastapi import APIRouter, HTTPException, status
from fastapi.responses import FileResponse

from src.api.deps import ClientIP, CurrentUser, DBSession, UserAgent
from src.api.schemas.consent import (
    ConsentCheckResponse,
    ConsentDocumentResponse,
    ConsentListResponse,
    ConsentRecordRequest,
    ConsentRecordResponse,
    ConsentSignRequest,
    ConsentSignResponse,
    PendingConsentItem,
    PendingConsentsResponse,
)
from src.models.verification import ConsentType
from src.services.legalConsentService import (
    SIGNATURE_REQUIRED_CONSENTS,
    ConsentTextMismatch,
    check_consent,
    get_document_metadata,
    get_user_consents,
    has_valid_signature,
    record_consent,
    required_consents_for_roles,
    sign_consent,
)
from src.services.legalPdfService import SignatureData, contract_absolute_path

router = APIRouter(prefix="/consents", tags=["Legal Consents"])

_SIGNATURE_DOCS = SIGNATURE_REQUIRED_CONSENTS


# ---------------------------------------------------------------------------
# GET /api/v1/consents/document/{consent_type}
# ---------------------------------------------------------------------------

@router.get(
    "/document/{consent_type}",
    response_model=ConsentDocumentResponse,
    summary="Texto vigente de un documento legal",
    description=(
        "Devuelve el markdown del documento junto con su versión y su hash. "
        "La app DEBE mostrar este texto y devolver el mismo hash al firmar: "
        "es lo que garantiza que se archiva exactamente lo que se leyó."
    ),
)
async def get_legal_document(consent_type: ConsentType) -> ConsentDocumentResponse:
    try:
        meta = get_document_metadata(consent_type)
    except FileNotFoundError as exc:
        # 404, no 500: falta un archivo de contenido, no se ha roto el servidor.
        # Y api.richieyanez.com va detrás de Cloudflare, que envuelve los 5xx en
        # su propia página de error y esconde el motivo real.
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc

    return ConsentDocumentResponse(
        consent_type=consent_type,
        version=meta["version"],
        text=meta["text"],
        hash=meta["hash"],
        requires_signature=consent_type in _SIGNATURE_DOCS,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/consents/pending
# ---------------------------------------------------------------------------

@router.get(
    "/pending",
    response_model=PendingConsentsResponse,
    summary="Qué documentos le faltan por aceptar a este usuario",
    description=(
        "La puerta legal de la app. Se consulta al entrar (registro o login) y "
        "manda a firmar si falta algo.\n\n"
        "Es un PREDICADO EN VIVO, no un momento: si se resolviera solo en el "
        "instante del registro, quien mate la app a mitad de la firma se "
        "quedaría siendo proveedor sin contrato, y los proveedores que ya "
        "existían nunca firmarían. Preguntando aquí, el hueco se cierra solo."
    ),
)
async def pending_consents(
    db: DBSession,
    current_user: CurrentUser,
) -> PendingConsentsResponse:
    required = required_consents_for_roles(
        role_customer=bool(current_user.role_customer),
        role_provider=bool(current_user.role_provider),
    )

    pending: list[PendingConsentItem] = []
    for consent_type in required:
        if await has_valid_signature(db, current_user.id, consent_type):
            continue
        meta = get_document_metadata(consent_type)
        pending.append(
            PendingConsentItem(
                consent_type=consent_type,
                version=meta["version"],
                requires_signature=consent_type in _SIGNATURE_DOCS,
            )
        )

    # El nombre legal se precarga con el del registro y el firmante puede
    # corregirlo: el PDF lo llama "Legal Name" y debe coincidir con la
    # identificación oficial, y mucha gente se registra con un diminutivo.
    suggested = " ".join(
        p for p in (current_user.first_name, current_user.last_name) if p
    ).strip()

    return PendingConsentsResponse(
        pending=pending,
        suggested_legal_name=suggested,
        account_email=current_user.email,
    )


# ---------------------------------------------------------------------------
# POST /api/v1/consents/sign
# ---------------------------------------------------------------------------

@router.post(
    "/sign",
    response_model=ConsentSignResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Firmar un documento legal",
    description=(
        "Registra la aceptación y genera el PDF firmado (contrato + tabla de "
        "aceptación rellenada + página de firma con el rastro de auditoría). "
        "El firmante sale del token, nunca del body."
    ),
)
async def sign_legal_document(
    body: ConsentSignRequest,
    db: DBSession,
    current_user: CurrentUser,
    client_ip: ClientIP,
    user_agent: UserAgent,
) -> ConsentSignResponse:
    signature = None
    if body.signature is not None:
        signature = SignatureData(
            width=body.signature.width,
            height=body.signature.height,
            strokes=body.signature.strokes,
        )

    # Ambos contratos (proveedor y cliente) exigen trazo. La cláusula clickwrap
    # del documento sigue siendo la aceptación; la firma dibujada se archiva en
    # el PDF como prueba adicional, igual para las dos partes.
    if body.consent_type in _SIGNATURE_DOCS and (
        signature is None or signature.is_empty()
    ):
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail="signature_required",
        )

    try:
        consent = await sign_consent(
            db,
            user_id=current_user.id,
            account_email=current_user.email,
            consent_type=body.consent_type,
            signed_full_name=body.signed_full_name.strip(),
            business_name=(body.business_name or "").strip() or None,
            document_hash=body.document_hash,
            signature=signature,
            ip_address=client_ip,
            user_agent=user_agent,
            device_id=body.device_id,
        )
    except ConsentTextMismatch as exc:
        # 409: no es culpa del formato del body, es que el documento cambió
        # entre que la app lo cargó y el usuario firmó.
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT, detail=str(exc)
        ) from exc
    except FileNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail=str(exc)
        ) from exc

    await db.commit()

    return ConsentSignResponse(
        consent_id=consent.id,
        consent_type=consent.consent_type,
        consent_version=consent.consent_version,
        signed_full_name=consent.signed_full_name or "",
        document_hash=consent.document_hash or "",
        document_url=f"/api/v1/consents/{consent.id}/document",
        created_at=consent.created_at,
    )


# ---------------------------------------------------------------------------
# GET /api/v1/consents/{consent_id}/document
# ---------------------------------------------------------------------------

@router.get(
    "/{consent_id}/document",
    summary="Descargar el PDF firmado",
    description=(
        "Solo el firmante puede descargarlo. El admin usa su propia ruta bajo "
        "/admin, con su propio token."
    ),
    response_class=FileResponse,
)
async def download_signed_document(
    consent_id: uuid.UUID,
    db: DBSession,
    current_user: CurrentUser,
) -> FileResponse:
    consents = await get_user_consents(db, current_user.id)
    consent = next((c for c in consents if c.id == consent_id), None)

    # 404 y no 403 cuando el consentimiento es de otro: distinguirlos
    # confirmaría a un tercero que ese id existe.
    if consent is None or not consent.document_path:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="document_not_found"
        )

    path = contract_absolute_path(consent.document_path)
    if not path.is_file():
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND, detail="document_missing_on_disk"
        )

    return FileResponse(
        path,
        media_type="application/pdf",
        filename=f"VISP-{consent.consent_type.value}-v{consent.consent_version}.pdf",
    )


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
    current_user: CurrentUser,
    client_ip: ClientIP,
    user_agent: UserAgent,
) -> ConsentRecordResponse:
    consent = await record_consent(
        db,
        user_id=current_user.id,
        consent_type=body.consent_type,
        consent_text=body.consent_text,
        ip_address=client_ip,
        user_agent=user_agent,
        device_id=body.device_id,
        granted=body.granted,
    )
    await db.commit()
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
    current_user: CurrentUser,
) -> ConsentListResponse:
    if user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="forbidden"
        )
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
    current_user: CurrentUser,
) -> ConsentCheckResponse:
    if user_id != current_user.id:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN, detail="forbidden"
        )

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
