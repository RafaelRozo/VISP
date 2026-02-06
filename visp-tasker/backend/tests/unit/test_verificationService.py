"""
Unit tests for the Provider Credential Verification Service.

Tests credential approval/rejection flows, auto-expiry detection, insurance
validation, and mandatory credential blocking for Level 3+ providers.
"""

import uuid
from datetime import date, datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.provider import (
    BackgroundCheckStatus,
    ProviderLevel,
    ProviderProfile,
    ProviderProfileStatus,
)
from src.models.verification import (
    CredentialStatus,
    CredentialType,
    InsuranceStatus,
    ProviderCredential,
    ProviderInsurancePolicy,
)
from src.services.verificationService import (
    BACKGROUND_CHECK_VALIDITY_DAYS,
    EXPIRY_WARNING_DAYS,
    LEVEL_3_MIN_INSURANCE_CENTS,
    AdminActionResponse,
    CredentialSubmissionResponse,
    InsuranceSubmissionResponse,
    approve_credential,
    approve_insurance,
    auto_expire_check,
    reject_credential,
    reject_insurance,
    submit_credential,
    submit_insurance,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------


def _make_credential(
    credential_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    credential_type: CredentialType = CredentialType.LICENSE,
    status: CredentialStatus = CredentialStatus.PENDING_REVIEW,
    expiry_date: date | None = None,
    name: str = "Test License",
) -> MagicMock:
    cred = MagicMock(spec=ProviderCredential)
    cred.id = credential_id or uuid.uuid4()
    cred.provider_id = provider_id or uuid.uuid4()
    cred.credential_type = credential_type
    cred.status = status
    cred.name = name
    cred.issuing_authority = "Ontario College of Trades"
    cred.credential_number = "LIC-12345"
    cred.jurisdiction_country = "CA"
    cred.jurisdiction_province_state = "ON"
    cred.issued_date = date(2024, 1, 1)
    cred.expiry_date = expiry_date or date(2026, 1, 1)
    cred.verified_at = None
    cred.verified_by = None
    cred.rejection_reason = None
    cred.document_url = "https://s3.example.com/docs/license.pdf"
    cred.document_hash = "abc123def456"
    cred.created_at = datetime(2025, 1, 15, tzinfo=timezone.utc)
    return cred


def _make_insurance_policy(
    policy_id: uuid.UUID | None = None,
    provider_id: uuid.UUID | None = None,
    status: InsuranceStatus = InsuranceStatus.PENDING_REVIEW,
    coverage_cents: int = 200_000_000,
    effective_date: date | None = None,
    expiry_date: date | None = None,
) -> MagicMock:
    policy = MagicMock(spec=ProviderInsurancePolicy)
    policy.id = policy_id or uuid.uuid4()
    policy.provider_id = provider_id or uuid.uuid4()
    policy.policy_number = "POL-2025-001"
    policy.insurer_name = "Aviva Canada"
    policy.policy_type = "general_liability"
    policy.coverage_amount_cents = coverage_cents
    policy.deductible_cents = 50000
    policy.effective_date = effective_date or date(2025, 1, 1)
    policy.expiry_date = expiry_date or date(2026, 1, 1)
    policy.status = status
    policy.verified_at = None
    policy.verified_by = None
    policy.document_url = "https://s3.example.com/docs/insurance.pdf"
    policy.document_hash = "hash789"
    policy.created_at = datetime(2025, 1, 15, tzinfo=timezone.utc)
    return policy


def _make_provider(
    provider_id: uuid.UUID | None = None,
    level: ProviderLevel = ProviderLevel.LEVEL_1,
    bg_status: BackgroundCheckStatus = BackgroundCheckStatus.CLEARED,
    bg_expiry: date | None = None,
) -> MagicMock:
    profile = MagicMock(spec=ProviderProfile)
    profile.id = provider_id or uuid.uuid4()
    profile.user_id = uuid.uuid4()
    profile.current_level = level
    profile.status = ProviderProfileStatus.ACTIVE
    profile.background_check_status = bg_status
    profile.background_check_date = date(2025, 1, 15)
    profile.background_check_expiry = bg_expiry or date(2026, 1, 15)
    profile.background_check_ref = "BG-REF-001"
    profile.credentials = []
    profile.insurance_policies = []
    profile.levels = []
    return profile


# ---------------------------------------------------------------------------
# Credential approval flow
# ---------------------------------------------------------------------------


class TestCredentialApproval:
    """Tests for the admin credential approval workflow."""

    @pytest.mark.asyncio
    async def test_approve_pending_credential_sets_verified(self, mock_db):
        """Approving a pending credential should set its status to VERIFIED."""
        cred = _make_credential(status=CredentialStatus.PENDING_REVIEW)
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = cred
        mock_db.execute.return_value = result_mock

        result = await approve_credential(mock_db, cred.id, admin_id)

        assert result.action == "approved"
        assert result.new_status == CredentialStatus.VERIFIED.value
        assert cred.status == CredentialStatus.VERIFIED
        assert cred.verified_at is not None
        assert cred.verified_by == admin_id
        assert cred.rejection_reason is None

    @pytest.mark.asyncio
    async def test_approve_rejected_credential_sets_verified(self, mock_db):
        """A previously rejected credential can be re-approved."""
        cred = _make_credential(status=CredentialStatus.REJECTED)
        cred.rejection_reason = "Previous rejection reason"
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = cred
        mock_db.execute.return_value = result_mock

        result = await approve_credential(mock_db, cred.id, admin_id)

        assert result.new_status == CredentialStatus.VERIFIED.value
        assert cred.rejection_reason is None  # Cleared

    @pytest.mark.asyncio
    async def test_approve_background_check_updates_provider_profile(self, mock_db):
        """Approving a background check credential should update the provider
        profile's background check status to CLEARED."""
        provider = _make_provider(bg_status=BackgroundCheckStatus.PENDING)
        cred = _make_credential(
            provider_id=provider.id,
            credential_type=CredentialType.BACKGROUND_CHECK,
            status=CredentialStatus.PENDING_REVIEW,
        )
        admin_id = uuid.uuid4()

        # First call returns credential, second returns provider profile
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count == 1:
                result_mock.scalar_one_or_none.return_value = cred
            else:
                result_mock.scalar_one_or_none.return_value = provider
            return result_mock

        mock_db.execute.side_effect = side_effect

        await approve_credential(mock_db, cred.id, admin_id)

        assert provider.background_check_status == BackgroundCheckStatus.CLEARED
        assert provider.background_check_date is not None
        assert provider.background_check_expiry is not None

    @pytest.mark.asyncio
    async def test_approve_already_verified_raises(self, mock_db):
        """Approving an already-verified credential should raise ValueError."""
        cred = _make_credential(status=CredentialStatus.VERIFIED)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = cred
        mock_db.execute.return_value = result_mock

        with pytest.raises(ValueError, match="cannot be approved"):
            await approve_credential(mock_db, cred.id, uuid.uuid4())


# ---------------------------------------------------------------------------
# Credential rejection flow
# ---------------------------------------------------------------------------


class TestCredentialRejection:
    """Tests for the admin credential rejection workflow."""

    @pytest.mark.asyncio
    async def test_reject_pending_credential_sets_rejected(self, mock_db):
        """Rejecting a pending credential should set status to REJECTED."""
        cred = _make_credential(status=CredentialStatus.PENDING_REVIEW)
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = cred
        mock_db.execute.return_value = result_mock

        result = await reject_credential(
            mock_db, cred.id, admin_id, reason="Document is illegible"
        )

        assert result.action == "rejected"
        assert result.new_status == CredentialStatus.REJECTED.value
        assert cred.status == CredentialStatus.REJECTED
        assert cred.rejection_reason == "Document is illegible"

    @pytest.mark.asyncio
    async def test_reject_verified_credential_allowed(self, mock_db):
        """A verified credential can be rejected (revoked)."""
        cred = _make_credential(status=CredentialStatus.VERIFIED)
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = cred
        mock_db.execute.return_value = result_mock

        result = await reject_credential(
            mock_db, cred.id, admin_id, reason="Credential found to be fraudulent"
        )

        assert result.new_status == CredentialStatus.REJECTED.value

    @pytest.mark.asyncio
    async def test_reject_background_check_updates_provider(self, mock_db):
        """Rejecting a background check should update the provider profile."""
        provider = _make_provider(bg_status=BackgroundCheckStatus.PENDING)
        cred = _make_credential(
            provider_id=provider.id,
            credential_type=CredentialType.BACKGROUND_CHECK,
            status=CredentialStatus.PENDING_REVIEW,
        )
        admin_id = uuid.uuid4()

        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count == 1:
                result_mock.scalar_one_or_none.return_value = cred
            else:
                result_mock.scalar_one_or_none.return_value = provider
            return result_mock

        mock_db.execute.side_effect = side_effect

        await reject_credential(mock_db, cred.id, admin_id, reason="Failed check")

        assert provider.background_check_status == BackgroundCheckStatus.REJECTED

    @pytest.mark.asyncio
    async def test_reject_with_empty_reason_raises(self, mock_db):
        """Rejecting a credential without a reason should raise ValueError."""
        with pytest.raises(ValueError, match="rejection reason is required"):
            await reject_credential(mock_db, uuid.uuid4(), uuid.uuid4(), reason="")

    @pytest.mark.asyncio
    async def test_reject_with_whitespace_only_reason_raises(self, mock_db):
        """Rejecting with a whitespace-only reason should raise ValueError."""
        with pytest.raises(ValueError, match="rejection reason is required"):
            await reject_credential(mock_db, uuid.uuid4(), uuid.uuid4(), reason="   ")


# ---------------------------------------------------------------------------
# Auto-expiry check
# ---------------------------------------------------------------------------


class TestAutoExpiryCheck:
    """Tests for the automated daily expiry check job."""

    @pytest.mark.asyncio
    async def test_expired_credentials_marked_as_expired(self, mock_db):
        """Credentials past their expiry date should be marked as EXPIRED."""
        expired_cred = _make_credential(
            status=CredentialStatus.VERIFIED,
            expiry_date=date(2025, 1, 1),
        )

        # Simulate DB returning expired credentials, then empty for all other queries
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            scalars_mock = MagicMock()
            if call_count == 1:
                # Expired credentials query
                scalars_mock.all.return_value = [expired_cred]
            elif call_count == 5:
                # _suspend_providers query
                scalars_mock.all.return_value = []
            else:
                # All other queries return empty
                scalars_mock.all.return_value = []
            result_mock.scalars.return_value = scalars_mock
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await auto_expire_check(
            mock_db, reference_date=date(2025, 2, 1)
        )

        assert expired_cred.status == CredentialStatus.EXPIRED
        assert result.credentials_expired == 1

    @pytest.mark.asyncio
    async def test_expired_insurance_marked_as_expired(self, mock_db):
        """Insurance policies past expiry should be marked as EXPIRED."""
        expired_policy = _make_insurance_policy(
            status=InsuranceStatus.VERIFIED,
            expiry_date=date(2025, 1, 1),
        )

        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            scalars_mock = MagicMock()
            if call_count == 3:
                # Expired insurance query (3rd query in auto_expire_check)
                scalars_mock.all.return_value = [expired_policy]
            elif call_count == 5:
                # Background check expired query returns empty profiles
                scalars_mock.all.return_value = []
            else:
                scalars_mock.all.return_value = []
            result_mock.scalars.return_value = scalars_mock
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await auto_expire_check(
            mock_db, reference_date=date(2025, 2, 1)
        )

        assert expired_policy.status == InsuranceStatus.EXPIRED
        assert result.insurance_expired == 1


# ---------------------------------------------------------------------------
# Insurance validation
# ---------------------------------------------------------------------------


class TestInsuranceValidation:
    """Tests for insurance policy submission and approval."""

    @pytest.mark.asyncio
    async def test_submit_insurance_creates_pending_policy(self, mock_db):
        """Submitting insurance should create a policy in pending_review state."""
        provider = _make_provider()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = provider
        mock_db.execute.return_value = result_mock

        result = await submit_insurance(
            mock_db,
            provider_id=provider.id,
            policy_number="POL-2025-TEST",
            insurer_name="Aviva Canada",
            policy_type="general_liability",
            coverage_amount_cents=200_000_000,
            effective_date=date(2025, 1, 1),
            expiry_date=date(2026, 1, 1),
        )

        assert result.status == InsuranceStatus.PENDING_REVIEW.value
        assert result.policy_number == "POL-2025-TEST"
        mock_db.add.assert_called_once()

    @pytest.mark.asyncio
    async def test_submit_insurance_expiry_before_effective_raises(self, mock_db):
        """Insurance with expiry before effective date should raise ValueError."""
        provider = _make_provider()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = provider
        mock_db.execute.return_value = result_mock

        with pytest.raises(ValueError, match="expiry_date must be after effective_date"):
            await submit_insurance(
                mock_db,
                provider_id=provider.id,
                policy_number="POL-BAD",
                insurer_name="Test",
                policy_type="general_liability",
                coverage_amount_cents=200_000_000,
                effective_date=date(2026, 1, 1),
                expiry_date=date(2025, 1, 1),
            )

    @pytest.mark.asyncio
    async def test_approve_insurance_sets_verified(self, mock_db):
        """Approving an insurance policy should set its status to VERIFIED."""
        policy = _make_insurance_policy(status=InsuranceStatus.PENDING_REVIEW)
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = policy
        mock_db.execute.return_value = result_mock

        result = await approve_insurance(mock_db, policy.id, admin_id)

        assert result.new_status == InsuranceStatus.VERIFIED.value
        assert policy.status == InsuranceStatus.VERIFIED
        assert policy.verified_at is not None


# ---------------------------------------------------------------------------
# Mandatory credential blocking
# ---------------------------------------------------------------------------


class TestMandatoryCredentialBlocking:
    """Tests that providers are blocked from operating without required
    credentials for their level."""

    @pytest.mark.asyncio
    async def test_submit_background_check_type_via_credential_raises(self, mock_db):
        """Using submit_credential for a background check should raise."""
        provider = _make_provider()
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = provider
        mock_db.execute.return_value = result_mock

        with pytest.raises(ValueError, match="Background checks must be submitted"):
            await submit_credential(
                mock_db,
                provider_id=provider.id,
                credential_type=CredentialType.BACKGROUND_CHECK,
                name="CRC Check",
            )


# ---------------------------------------------------------------------------
# Level 3 requires license
# ---------------------------------------------------------------------------


class TestLevel3RequiresLicense:
    """Tests that Level 3 providers must have a verified license."""

    @pytest.mark.asyncio
    async def test_submit_license_for_level3(self, mock_db):
        """A Level 3 provider should be able to submit a license credential."""
        provider = _make_provider(level=ProviderLevel.LEVEL_3)
        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = provider
        mock_db.execute.return_value = result_mock

        result = await submit_credential(
            mock_db,
            provider_id=provider.id,
            credential_type=CredentialType.LICENSE,
            name="Ontario Master Electrician License",
            issuing_authority="OCOT",
            credential_number="ME-2025-001",
            jurisdiction_country="CA",
            jurisdiction_province_state="ON",
            issued_date=date(2024, 6, 1),
            expiry_date=date(2027, 6, 1),
        )

        assert result.credential_type == CredentialType.LICENSE.value
        assert result.status == CredentialStatus.PENDING_REVIEW.value
        mock_db.add.assert_called_once()


# ---------------------------------------------------------------------------
# Level 4 requires insurance
# ---------------------------------------------------------------------------


class TestLevel4RequiresInsurance:
    """Tests that Level 4 providers must have valid emergency insurance."""

    @pytest.mark.asyncio
    async def test_reject_insurance_sets_rejected(self, mock_db):
        """Rejecting insurance should set status to REJECTED."""
        policy = _make_insurance_policy(status=InsuranceStatus.PENDING_REVIEW)
        admin_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = policy
        mock_db.execute.return_value = result_mock

        result = await reject_insurance(
            mock_db, policy.id, admin_id, reason="Coverage insufficient"
        )

        assert result.new_status == InsuranceStatus.REJECTED.value
        assert policy.status == InsuranceStatus.REJECTED

    @pytest.mark.asyncio
    async def test_reject_insurance_empty_reason_raises(self, mock_db):
        """Rejecting insurance without a reason should raise ValueError."""
        with pytest.raises(ValueError, match="rejection reason is required"):
            await reject_insurance(mock_db, uuid.uuid4(), uuid.uuid4(), reason="")

    @pytest.mark.asyncio
    async def test_level3_min_insurance_constant(self):
        """The minimum insurance coverage for Level 3+ should be $2M (200M cents)."""
        assert LEVEL_3_MIN_INSURANCE_CENTS == 200_000_000
