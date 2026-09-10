"""
Legal Consent Service — VISP-BE-LEGAL-007
==========================================

Append-only consent recording with SHA-256 integrity hashing.

Business rules
--------------
* Consents are **immutable**: every action produces a new row.  Rows are
  never updated or deleted.
* ``consent_text_hash`` is the hex-encoded SHA-256 digest of the full
  consent text that was presented to the user.
* The latest *granted* row for a ``(user_id, consent_type)`` pair
  determines whether the user currently has valid consent.
* Consent text files live under ``content/legal/`` and follow the naming
  convention ``{consent_type}_v{version}.txt``.
"""

from __future__ import annotations

import hashlib
import logging
import uuid
from datetime import datetime, timezone
from pathlib import Path
from typing import TYPE_CHECKING

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.verification import ConsentType, LegalConsent

if TYPE_CHECKING:  # pragma: no cover - solo para el tipo
    from src.services.legalPdfService import SignatureData

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Consent text file location
# ---------------------------------------------------------------------------
# Los textos viven DENTRO de backend/ a propósito.
#
# Antes se resolvían a `visp-tasker/content/legal`, un nivel POR ENCIMA del
# contexto de build de Docker: la imagen se construye desde `backend/`, así que
# ese directorio nunca se copió y dentro del contenedor la ruta apuntaba a
# `/content/legal`, que no existe. Nadie lo notó porque hasta hoy no había un
# solo caller de `load_consent_text` — el mismo patrón de
# `feedback_worker_invisible`: código que no se ejecuta no falla, simplemente
# no está vivo.
_BACKEND_ROOT = Path(__file__).resolve().parents[2]
LEGAL_CONTENT_DIR = _BACKEND_ROOT / "content" / "legal"

# ---------------------------------------------------------------------------
# Version registry — single source of truth for the current version of each
# consent type.  When a new version is published, bump the version here and
# add the corresponding text file to content/legal/.
# ---------------------------------------------------------------------------
CONSENT_VERSIONS: dict[ConsentType, str] = {
    ConsentType.PLATFORM_TOS: "1.0",
    ConsentType.PROVIDER_IC_AGREEMENT: "1.3",
    ConsentType.LEVEL_1_TERMS: "1.0",
    ConsentType.LEVEL_2_TERMS: "1.0",
    ConsentType.LEVEL_3_TERMS: "1.0",
    ConsentType.LEVEL_4_EMERGENCY_SLA: "1.0",
    ConsentType.CUSTOMER_SERVICE_AGREEMENT: "1.2",
    ConsentType.EMERGENCY_PRICING_CONSENT: "1.0",
}

# ---------------------------------------------------------------------------
# Re-signature policy
# ---------------------------------------------------------------------------
# Section 24 of the provider agreement lets VISP require renewed acceptance
# after a material change, and the v1.3 PDF is stamped "COUNSEL REVIEW
# REQUIRED" -- so a v1.4 is coming.  The signed version is ALWAYS recorded, so
# we always know who signed what; this flag only decides whether an outdated
# signature blocks the provider.  Ricardo's call (2026-09-08): sign once, no
# forced re-signature.  Flipping this boolean is the whole change when that
# stops being true -- no migration, no data rescue.
REQUIRE_CURRENT_CONTRACT_VERSION = False

# Documents that require a drawn signature.  BOTH the provider and the customer
# agreement are here: Ricardo's call (2026-09-09) is that the customer signs the
# same way the provider does, so the stroke is captured and archived in the PDF
# for the two parties.  The clickwrap clause in the customer text ("By clicking
# 'I Agree'…") remains the acceptance under Ontario's Electronic Commerce Act,
# 2000; the drawn signature is layered on top as extra evidence, exactly as it
# already was for the provider.
SIGNATURE_REQUIRED_CONSENTS: set[ConsentType] = {
    ConsentType.PROVIDER_IC_AGREEMENT,
    ConsentType.CUSTOMER_SERVICE_AGREEMENT,
}


def required_consents_for_roles(
    *, role_customer: bool, role_provider: bool
) -> list[ConsentType]:
    """Los documentos que este usuario debe aceptar, según sus roles.

    El rol NO es una cadena: en `users` son dos banderas independientes
    (`role_customer`, `role_provider`), así que "both" no es un valor, son las
    dos en TRUE. Y quien es las dos cosas acepta los DOS documentos: firma el
    del proveedor porque **es** proveedor, y acepta el del cliente porque
    también reserva. Son dos relaciones distintas con VISP y cada una necesita
    su fila.
    """
    docs: list[ConsentType] = []
    if role_provider:
        docs.append(ConsentType.PROVIDER_IC_AGREEMENT)
    if role_customer:
        docs.append(ConsentType.CUSTOMER_SERVICE_AGREEMENT)
    return docs


def _hash_text(text: str) -> str:
    """Return the hex-encoded SHA-256 hash of *text*."""
    return hashlib.sha256(text.encode("utf-8")).hexdigest()


# ---------------------------------------------------------------------------
# Public service functions
# ---------------------------------------------------------------------------

async def record_consent(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    consent_type: ConsentType,
    consent_text: str,
    ip_address: str | None = None,
    user_agent: str | None = None,
    device_id: str | None = None,
    granted: bool = True,
) -> LegalConsent:
    """Record an immutable consent action.

    Parameters
    ----------
    db:
        Async SQLAlchemy session (caller is responsible for commit).
    user_id:
        The user granting or revoking consent.
    consent_type:
        Which consent document is being agreed to.
    consent_text:
        Full legal text that was displayed to the user.
    ip_address:
        Client IP address for the audit trail.
    user_agent:
        Browser / app user-agent string.
    device_id:
        Optional device identifier (e.g. IDFV on iOS).
    granted:
        ``True`` if the user is granting consent, ``False`` to record a
        revocation.

    Returns
    -------
    LegalConsent
        The newly created consent record (already added to the session).
    """
    version = get_latest_version(consent_type)
    text_hash = _hash_text(consent_text)

    consent = LegalConsent(
        user_id=user_id,
        consent_type=consent_type,
        consent_version=version,
        consent_text_hash=text_hash,
        consent_text=consent_text,
        granted=granted,
        ip_address=ip_address,
        user_agent=user_agent,
        device_id=device_id,
    )
    db.add(consent)
    await db.flush()  # populate server-generated defaults (id, created_at)

    logger.info(
        "Recorded consent: user=%s type=%s version=%s granted=%s hash=%s",
        user_id,
        consent_type.value,
        version,
        granted,
        text_hash[:16],
    )
    return consent


class ConsentTextMismatch(ValueError):
    """La app firmó un texto distinto del vigente."""


async def sign_consent(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    account_email: str,
    consent_type: ConsentType,
    signed_full_name: str,
    document_hash: str,
    signature: "SignatureData | None" = None,
    business_name: str | None = None,
    ip_address: str | None = None,
    user_agent: str | None = None,
    device_id: str | None = None,
) -> LegalConsent:
    """Firma un documento legal y archiva el PDF resultante.

    El orden importa y no es negociable: **se genera el PDF ANTES de insertar
    la fila**. ``legal_consents`` es append-only y no tiene ``updated_at`` —
    de ahí viene su valor probatorio. Insertar primero y actualizar después
    con la ruta del documento dejaría una fila que sí se modificó, que es
    exactamente lo que la tabla existe para impedir. Por eso el id se genera
    aquí, se usa para nombrar el archivo, y la fila entra al final ya completa
    en un solo INSERT.

    Raises
    ------
    ConsentTextMismatch
        Si el hash que manda la app no es el del texto vigente. Sin esta
        comprobación se archivaría una versión distinta de la que se leyó.
    """
    from src.services import legalPdfService as pdf_service

    if consent_type in SIGNATURE_REQUIRED_CONSENTS and (
        signature is None or signature.is_empty()
    ):
        raise ValueError("signature_required")

    meta = get_document_metadata(consent_type)
    if document_hash.lower() != meta["hash"].lower():
        raise ConsentTextMismatch(
            f"El texto firmado no coincide con la versión vigente "
            f"({consent_type.value} v{meta['version']}). Recarga el documento."
        )

    consent_id = uuid.uuid4()
    signed_at = datetime.now(timezone.utc)

    is_provider_doc = consent_type == ConsentType.PROVIDER_IC_AGREEMENT
    party_label = "Service Provider" if is_provider_doc else "Customer"
    title = (
        "VISP Independent Service Provider Platform Agreement"
        if is_provider_doc
        else "VISP Customer Platform and Service Booking Agreement"
    )

    record = pdf_service.AcceptanceRecord(
        legal_name=signed_full_name,
        account_email=account_email,
        consent_id=consent_id,
        user_id=user_id,
        document_version=meta["version"],
        text_hash=meta["hash"],
        accepted_at=signed_at,
        business_name=business_name,
        ip_address=ip_address,
        user_agent=user_agent,
        device_id=device_id,
        party_label=party_label,
    )

    pdf_bytes, signature_png = pdf_service.build_signed_contract(
        markdown=meta["text"],
        record=record,
        signature=signature,
        running_head=f"VISP | {party_label.upper()} AGREEMENT",
        footer_note=f"{title} v{meta['version']}",
    )
    document_path, document_hash_pdf, signature_path = pdf_service.persist_contract(
        consent_id, pdf_bytes, signature_png
    )

    consent = LegalConsent(
        id=consent_id,
        user_id=user_id,
        consent_type=consent_type,
        consent_version=meta["version"],
        consent_text_hash=meta["hash"],
        consent_text=meta["text"],
        granted=True,
        ip_address=ip_address,
        user_agent=user_agent,
        device_id=device_id,
        signed_full_name=signed_full_name,
        business_name=business_name,
        signature_svg=signature.to_svg() if signature is not None else None,
        signature_image_path=signature_path,
        document_path=document_path,
        document_hash=document_hash_pdf,
    )
    db.add(consent)
    await db.flush()

    logger.info(
        "Contrato firmado: user=%s type=%s v%s consent=%s pdf_sha=%s",
        user_id, consent_type.value, meta["version"], consent_id,
        document_hash_pdf[:16],
    )
    return consent


async def check_consent(
    db: AsyncSession,
    user_id: uuid.UUID,
    consent_type: ConsentType,
) -> LegalConsent | None:
    """Return the most recent *granted* consent for the user+type pair.

    Returns ``None`` if the user has never granted this consent type, or if
    the most recent action was a revocation.
    """
    stmt = (
        select(LegalConsent)
        .where(
            LegalConsent.user_id == user_id,
            LegalConsent.consent_type == consent_type,
        )
        .order_by(desc(LegalConsent.created_at))
        .limit(1)
    )
    result = await db.execute(stmt)
    latest = result.scalar_one_or_none()

    if latest is None or not latest.granted:
        return None
    return latest


async def get_user_consents(
    db: AsyncSession,
    user_id: uuid.UUID,
) -> list[LegalConsent]:
    """Return every consent record for a user, newest first."""
    stmt = (
        select(LegalConsent)
        .where(LegalConsent.user_id == user_id)
        .order_by(desc(LegalConsent.created_at))
    )
    result = await db.execute(stmt)
    return list(result.scalars().all())


def get_latest_version(consent_type: ConsentType) -> str:
    """Return the current version string for a consent type.

    Raises ``ValueError`` if the consent type is unknown (should never
    happen with the enum constraint).
    """
    version = CONSENT_VERSIONS.get(consent_type)
    if version is None:
        raise ValueError(f"No version registered for consent type: {consent_type}")
    return version


def load_consent_text(consent_type: ConsentType, version: str | None = None) -> str:
    """Load the canonical legal text from disk.

    Parameters
    ----------
    consent_type:
        The consent type whose text to load.
    version:
        Explicit version string (e.g. ``"1.0"``).  Defaults to the latest
        registered version.

    Returns
    -------
    str
        Full text content of the legal file.

    Raises
    ------
    FileNotFoundError
        If the expected file does not exist under ``content/legal/``.
    """
    if version is None:
        version = get_latest_version(consent_type)

    # ``.md`` first: the agreements converted from the signed PDFs are
    # markdown (headings, callouts, the supply matrix).  ``.txt`` stays as the
    # fallback so the Phase-2 files keep working untouched.
    candidates = [
        LEGAL_CONTENT_DIR / f"{consent_type.value}_v{version}.md",
        LEGAL_CONTENT_DIR / f"{consent_type.value}_v{version}.txt",
    ]
    for filepath in candidates:
        if filepath.is_file():
            return _strip_front_matter(filepath.read_text(encoding="utf-8"))

    raise FileNotFoundError(
        f"Legal text file not found for {consent_type.value} v{version}. "
        f"Expected one of: {', '.join(p.name for p in candidates)}"
    )


def _strip_front_matter(text: str) -> str:
    """Drop the YAML front matter from a markdown legal file.

    The metadata block is bookkeeping, not part of the agreement.  It must not
    reach the user's screen, and therefore must not be inside the hash either:
    what is hashed has to be exactly what was displayed.
    """
    if not text.startswith("---"):
        return text
    end = text.find("\n---", 3)
    if end == -1:
        return text
    return text[end + 4:].lstrip("\n")


def get_document_metadata(consent_type: ConsentType) -> dict[str, str]:
    """Return ``{version, text, hash}`` for the current version of a document.

    The hash travels with the text to the client so the signing screen can echo
    back which exact document it displayed; the server verifies the echo before
    recording the signature.
    """
    version = get_latest_version(consent_type)
    text = load_consent_text(consent_type, version)
    return {"version": version, "text": text, "hash": _hash_text(text)}


async def has_valid_signature(
    db: AsyncSession,
    user_id: uuid.UUID,
    consent_type: ConsentType,
) -> bool:
    """Whether the user currently holds an acceptable consent for *type*.

    Version-aware on purpose: ``check_consent`` returns the latest row without
    looking at which version it covers, which silently treats a signature on an
    old text as consent to a new one.  Whether an outdated version actually
    blocks is governed by ``REQUIRE_CURRENT_CONTRACT_VERSION``.
    """
    latest = await check_consent(db, user_id, consent_type)
    if latest is None:
        return False
    # Legacy checkbox/clickwrap records do not satisfy drawn-contract signing.
    # Keep them immutable; /pending asks the user to create a new signed record.
    if consent_type in SIGNATURE_REQUIRED_CONSENTS and not all((
        latest.signed_full_name,
        latest.signature_svg,
        latest.signature_image_path,
        latest.document_path,
        latest.document_hash,
    )):
        return False
    if REQUIRE_CURRENT_CONTRACT_VERSION:
        return latest.consent_version == get_latest_version(consent_type)
    return True
