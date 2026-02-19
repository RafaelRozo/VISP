"""
Background Check Integration Service for VISP.

Provides a unified interface for submitting and tracking background checks
through multiple Canadian CRC (Criminal Record Check) providers:

- OPP (Ontario Provincial Police)
- Toronto Police Service
- MyCRC.ca (online provider)
- Sterling Backcheck (commercial screening)

All methods are stubs awaiting real provider API integrations.  Each provider
implements the ``BackgroundCheckProvider`` protocol so the verification
service can work with any of them interchangeably.

Ontario background check types:
- CRC  ($25-50, 1-5 business days)  -- Level 1 mandatory
- CRJMC ($35-75, 1-5 business days) -- Enhanced, optional
- VSC  ($50-90, 2-8 weeks, police only) -- Vulnerable Sector Check
"""

from __future__ import annotations

import enum
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime
from typing import Any, Optional, Protocol

import logging

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class BackgroundCheckType(str, enum.Enum):
    """Types of background checks available in Ontario."""
    CRC = "crc"           # Criminal Record Check
    CRJMC = "crjmc"       # Criminal Record & Judicial Matters Check
    VSC = "vsc"           # Vulnerable Sector Check


class CheckProvider(str, enum.Enum):
    """Supported background check service providers."""
    OPP = "opp"
    TORONTO_POLICE = "toronto_police"
    MYCRC = "mycrc"
    STERLING_BACKCHECK = "sterling_backcheck"


class CheckRequestStatus(str, enum.Enum):
    """Status of a background check request at the provider level."""
    SUBMITTED = "submitted"
    IN_PROGRESS = "in_progress"
    COMPLETED_CLEAR = "completed_clear"
    COMPLETED_FLAGGED = "completed_flagged"
    FAILED = "failed"
    EXPIRED = "expired"


# ---------------------------------------------------------------------------
# Data transfer objects
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class CheckSubmission:
    """Data required to submit a background check to any provider."""
    provider_id: uuid.UUID
    applicant_first_name: str
    applicant_last_name: str
    applicant_email: str
    date_of_birth: date
    check_type: BackgroundCheckType
    address_line_1: str
    city: str
    province: str
    postal_code: str
    country: str = "CA"
    address_line_2: Optional[str] = None
    phone: Optional[str] = None


@dataclass(frozen=True)
class CheckSubmissionResult:
    """Result returned after a successful submission to a provider."""
    external_reference_id: str
    provider: CheckProvider
    check_type: BackgroundCheckType
    status: CheckRequestStatus
    estimated_completion_date: Optional[date] = None
    fee_cents: Optional[int] = None


@dataclass(frozen=True)
class CheckStatusResult:
    """Current status of a previously submitted check."""
    external_reference_id: str
    provider: CheckProvider
    status: CheckRequestStatus
    last_updated: datetime
    message: Optional[str] = None


@dataclass(frozen=True)
class CheckResult:
    """Final result of a completed background check."""
    external_reference_id: str
    provider: CheckProvider
    check_type: BackgroundCheckType
    status: CheckRequestStatus
    completed_at: datetime
    valid_until: date
    result_document_url: Optional[str] = None
    flags: list[str] = field(default_factory=list)
    raw_response: Optional[dict[str, Any]] = None


# ---------------------------------------------------------------------------
# Provider protocol
# ---------------------------------------------------------------------------

class BackgroundCheckProviderProtocol(Protocol):
    """Protocol that every background check provider adapter must implement."""

    async def submit_check(self, submission: CheckSubmission) -> CheckSubmissionResult:
        ...

    async def check_status(self, external_reference_id: str) -> CheckStatusResult:
        ...

    async def get_result(self, external_reference_id: str) -> CheckResult:
        ...


# ---------------------------------------------------------------------------
# Provider fee schedule
# ---------------------------------------------------------------------------

PROVIDER_FEES: dict[CheckProvider, dict[BackgroundCheckType, int]] = {
    CheckProvider.OPP: {
        BackgroundCheckType.CRC: 2500,     # $25.00
        BackgroundCheckType.CRJMC: 3500,   # $35.00
        BackgroundCheckType.VSC: 5000,     # $50.00
    },
    CheckProvider.TORONTO_POLICE: {
        BackgroundCheckType.CRC: 3000,     # $30.00
        BackgroundCheckType.CRJMC: 4500,   # $45.00
        BackgroundCheckType.VSC: 6500,     # $65.00
    },
    CheckProvider.MYCRC: {
        BackgroundCheckType.CRC: 4000,     # $40.00
        BackgroundCheckType.CRJMC: 5500,   # $55.00
        # VSC not available online
    },
    CheckProvider.STERLING_BACKCHECK: {
        BackgroundCheckType.CRC: 5000,     # $50.00
        BackgroundCheckType.CRJMC: 7500,   # $75.00
        BackgroundCheckType.VSC: 9000,     # $90.00
    },
}

# Estimated processing times in business days
PROVIDER_PROCESSING_DAYS: dict[CheckProvider, dict[BackgroundCheckType, tuple[int, int]]] = {
    CheckProvider.OPP: {
        BackgroundCheckType.CRC: (1, 5),
        BackgroundCheckType.CRJMC: (1, 5),
        BackgroundCheckType.VSC: (14, 56),  # 2-8 weeks
    },
    CheckProvider.TORONTO_POLICE: {
        BackgroundCheckType.CRC: (1, 5),
        BackgroundCheckType.CRJMC: (1, 5),
        BackgroundCheckType.VSC: (14, 56),
    },
    CheckProvider.MYCRC: {
        BackgroundCheckType.CRC: (1, 3),
        BackgroundCheckType.CRJMC: (1, 3),
    },
    CheckProvider.STERLING_BACKCHECK: {
        BackgroundCheckType.CRC: (1, 5),
        BackgroundCheckType.CRJMC: (1, 5),
        BackgroundCheckType.VSC: (14, 56),
    },
}


# ---------------------------------------------------------------------------
# Provider adapters (stubs)
# ---------------------------------------------------------------------------

class OPPBackgroundCheckAdapter:
    """Ontario Provincial Police background check adapter (stub)."""

    provider = CheckProvider.OPP

    async def submit_check(self, submission: CheckSubmission) -> CheckSubmissionResult:
        """Submit a check to OPP.

        In production this would POST to the OPP e-check API.
        """
        logger.info(
            "STUB: Submitting %s to OPP for provider %s",
            submission.check_type.value,
            submission.provider_id,
        )
        ref_id = f"OPP-{uuid.uuid4().hex[:12].upper()}"
        fee = PROVIDER_FEES[self.provider].get(submission.check_type)
        return CheckSubmissionResult(
            external_reference_id=ref_id,
            provider=self.provider,
            check_type=submission.check_type,
            status=CheckRequestStatus.SUBMITTED,
            fee_cents=fee,
        )

    async def check_status(self, external_reference_id: str) -> CheckStatusResult:
        """Poll OPP for status of a previously submitted check."""
        logger.info("STUB: Checking status for OPP ref %s", external_reference_id)
        return CheckStatusResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            status=CheckRequestStatus.IN_PROGRESS,
            last_updated=datetime.utcnow(),
            message="Stub: check is being processed",
        )

    async def get_result(self, external_reference_id: str) -> CheckResult:
        """Retrieve the final result from OPP."""
        logger.info("STUB: Retrieving result for OPP ref %s", external_reference_id)
        from datetime import timedelta
        now = datetime.utcnow()
        return CheckResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            check_type=BackgroundCheckType.CRC,
            status=CheckRequestStatus.COMPLETED_CLEAR,
            completed_at=now,
            valid_until=(now + timedelta(days=365)).date(),
            flags=[],
        )


class TorontoPoliceBackgroundCheckAdapter:
    """Toronto Police Service background check adapter (stub)."""

    provider = CheckProvider.TORONTO_POLICE

    async def submit_check(self, submission: CheckSubmission) -> CheckSubmissionResult:
        logger.info(
            "STUB: Submitting %s to Toronto Police for provider %s",
            submission.check_type.value,
            submission.provider_id,
        )
        ref_id = f"TPS-{uuid.uuid4().hex[:12].upper()}"
        fee = PROVIDER_FEES[self.provider].get(submission.check_type)
        return CheckSubmissionResult(
            external_reference_id=ref_id,
            provider=self.provider,
            check_type=submission.check_type,
            status=CheckRequestStatus.SUBMITTED,
            fee_cents=fee,
        )

    async def check_status(self, external_reference_id: str) -> CheckStatusResult:
        logger.info("STUB: Checking status for TPS ref %s", external_reference_id)
        return CheckStatusResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            status=CheckRequestStatus.IN_PROGRESS,
            last_updated=datetime.utcnow(),
            message="Stub: check is being processed",
        )

    async def get_result(self, external_reference_id: str) -> CheckResult:
        logger.info("STUB: Retrieving result for TPS ref %s", external_reference_id)
        from datetime import timedelta
        now = datetime.utcnow()
        return CheckResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            check_type=BackgroundCheckType.CRC,
            status=CheckRequestStatus.COMPLETED_CLEAR,
            completed_at=now,
            valid_until=(now + timedelta(days=365)).date(),
            flags=[],
        )


class MyCRCBackgroundCheckAdapter:
    """MyCRC.ca online background check adapter (stub).

    Note: MyCRC does not support Vulnerable Sector Checks (VSC).
    """

    provider = CheckProvider.MYCRC

    async def submit_check(self, submission: CheckSubmission) -> CheckSubmissionResult:
        if submission.check_type == BackgroundCheckType.VSC:
            raise ValueError(
                "MyCRC.ca does not support Vulnerable Sector Checks. "
                "Use a police service provider instead."
            )
        logger.info(
            "STUB: Submitting %s to MyCRC for provider %s",
            submission.check_type.value,
            submission.provider_id,
        )
        ref_id = f"MYCRC-{uuid.uuid4().hex[:12].upper()}"
        fee = PROVIDER_FEES[self.provider].get(submission.check_type)
        return CheckSubmissionResult(
            external_reference_id=ref_id,
            provider=self.provider,
            check_type=submission.check_type,
            status=CheckRequestStatus.SUBMITTED,
            fee_cents=fee,
        )

    async def check_status(self, external_reference_id: str) -> CheckStatusResult:
        logger.info("STUB: Checking status for MyCRC ref %s", external_reference_id)
        return CheckStatusResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            status=CheckRequestStatus.IN_PROGRESS,
            last_updated=datetime.utcnow(),
            message="Stub: check is being processed",
        )

    async def get_result(self, external_reference_id: str) -> CheckResult:
        logger.info("STUB: Retrieving result for MyCRC ref %s", external_reference_id)
        from datetime import timedelta
        now = datetime.utcnow()
        return CheckResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            check_type=BackgroundCheckType.CRC,
            status=CheckRequestStatus.COMPLETED_CLEAR,
            completed_at=now,
            valid_until=(now + timedelta(days=365)).date(),
            flags=[],
        )


class SterlingBackcheckAdapter:
    """Sterling Backcheck commercial screening adapter (stub)."""

    provider = CheckProvider.STERLING_BACKCHECK

    async def submit_check(self, submission: CheckSubmission) -> CheckSubmissionResult:
        logger.info(
            "STUB: Submitting %s to Sterling Backcheck for provider %s",
            submission.check_type.value,
            submission.provider_id,
        )
        ref_id = f"STRL-{uuid.uuid4().hex[:12].upper()}"
        fee = PROVIDER_FEES[self.provider].get(submission.check_type)
        return CheckSubmissionResult(
            external_reference_id=ref_id,
            provider=self.provider,
            check_type=submission.check_type,
            status=CheckRequestStatus.SUBMITTED,
            fee_cents=fee,
        )

    async def check_status(self, external_reference_id: str) -> CheckStatusResult:
        logger.info("STUB: Checking status for Sterling ref %s", external_reference_id)
        return CheckStatusResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            status=CheckRequestStatus.IN_PROGRESS,
            last_updated=datetime.utcnow(),
            message="Stub: check is being processed",
        )

    async def get_result(self, external_reference_id: str) -> CheckResult:
        logger.info("STUB: Retrieving result for Sterling ref %s", external_reference_id)
        from datetime import timedelta
        now = datetime.utcnow()
        return CheckResult(
            external_reference_id=external_reference_id,
            provider=self.provider,
            check_type=BackgroundCheckType.CRC,
            status=CheckRequestStatus.COMPLETED_CLEAR,
            completed_at=now,
            valid_until=(now + timedelta(days=365)).date(),
            flags=[],
        )


# ---------------------------------------------------------------------------
# Provider registry
# ---------------------------------------------------------------------------

_PROVIDER_ADAPTERS: dict[CheckProvider, BackgroundCheckProviderProtocol] = {
    CheckProvider.OPP: OPPBackgroundCheckAdapter(),
    CheckProvider.TORONTO_POLICE: TorontoPoliceBackgroundCheckAdapter(),
    CheckProvider.MYCRC: MyCRCBackgroundCheckAdapter(),
    CheckProvider.STERLING_BACKCHECK: SterlingBackcheckAdapter(),
}


def get_background_check_adapter(
    provider: CheckProvider,
) -> BackgroundCheckProviderProtocol:
    """Return the adapter instance for the given provider.

    Raises ``ValueError`` if the provider is not registered.
    """
    adapter = _PROVIDER_ADAPTERS.get(provider)
    if adapter is None:
        raise ValueError(f"No adapter registered for provider: {provider.value}")
    return adapter


def get_available_providers_for_check_type(
    check_type: BackgroundCheckType,
) -> list[CheckProvider]:
    """Return all providers that support the given check type."""
    return [
        provider
        for provider, fees in PROVIDER_FEES.items()
        if check_type in fees
    ]


def get_fee(provider: CheckProvider, check_type: BackgroundCheckType) -> Optional[int]:
    """Return the fee in cents for a given provider and check type, or None."""
    return PROVIDER_FEES.get(provider, {}).get(check_type)
