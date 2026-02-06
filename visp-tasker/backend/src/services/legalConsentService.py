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
from pathlib import Path

from sqlalchemy import desc, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.verification import ConsentType, LegalConsent

logger = logging.getLogger(__name__)

# ---------------------------------------------------------------------------
# Consent text file location
# ---------------------------------------------------------------------------
# Resolve relative to project root (three levels up from this file):
#   backend/src/services/legalConsentService.py  ->  visp-tasker/
_PROJECT_ROOT = Path(__file__).resolve().parents[3]
LEGAL_CONTENT_DIR = _PROJECT_ROOT / "content" / "legal"

# ---------------------------------------------------------------------------
# Version registry — single source of truth for the current version of each
# consent type.  When a new version is published, bump the version here and
# add the corresponding text file to content/legal/.
# ---------------------------------------------------------------------------
CONSENT_VERSIONS: dict[ConsentType, str] = {
    ConsentType.PLATFORM_TOS: "1.0",
    ConsentType.PROVIDER_IC_AGREEMENT: "1.0",
    ConsentType.LEVEL_1_TERMS: "1.0",
    ConsentType.LEVEL_2_TERMS: "1.0",
    ConsentType.LEVEL_3_TERMS: "1.0",
    ConsentType.LEVEL_4_EMERGENCY_SLA: "1.0",
    ConsentType.CUSTOMER_SERVICE_AGREEMENT: "1.0",
    ConsentType.EMERGENCY_PRICING_CONSENT: "1.0",
}


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

    filename = f"{consent_type.value}_v{version}.txt"
    filepath = LEGAL_CONTENT_DIR / filename

    if not filepath.is_file():
        raise FileNotFoundError(
            f"Legal text file not found: {filepath}. "
            f"Expected at content/legal/{filename}"
        )

    return filepath.read_text(encoding="utf-8")
