"""
Unit tests for the Legal Consent Service -- VISP-BE-LEGAL-007.

Tests consent recording with SHA-256 hash, consent checking, append-only
immutability, consent type coverage, and IP/user-agent audit storage.
"""

import hashlib
import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.verification import ConsentType, LegalConsent
from src.services.legalConsentService import (
    CONSENT_VERSIONS,
    _hash_text,
    check_consent,
    get_latest_version,
    load_consent_text,
    record_consent,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

SAMPLE_CONSENT_TEXT = (
    "By using the VISP/Tasker platform, you agree to the following terms "
    "and conditions. This is a test consent document for unit testing."
)


def _make_consent_record(
    user_id: uuid.UUID | None = None,
    consent_type: ConsentType = ConsentType.PLATFORM_TOS,
    granted: bool = True,
    consent_text: str = SAMPLE_CONSENT_TEXT,
    ip_address: str | None = "192.168.1.1",
    user_agent: str | None = "TestAgent/1.0",
) -> MagicMock:
    """Create a mock LegalConsent record."""
    record = MagicMock(spec=LegalConsent)
    record.id = uuid.uuid4()
    record.user_id = user_id or uuid.uuid4()
    record.consent_type = consent_type
    record.consent_version = CONSENT_VERSIONS.get(consent_type, "1.0")
    record.consent_text_hash = _hash_text(consent_text)
    record.consent_text = consent_text
    record.granted = granted
    record.ip_address = ip_address
    record.user_agent = user_agent
    record.device_id = None
    record.created_at = datetime(2025, 2, 1, 12, 0, 0, tzinfo=timezone.utc)
    return record


# ---------------------------------------------------------------------------
# _hash_text: SHA-256 hashing
# ---------------------------------------------------------------------------


class TestHashText:
    """Tests for the SHA-256 text hashing function."""

    def test_produces_sha256_hex_digest(self):
        """The hash should be a valid hex-encoded SHA-256 digest."""
        result = _hash_text("hello world")
        expected = hashlib.sha256("hello world".encode("utf-8")).hexdigest()
        assert result == expected
        assert len(result) == 64  # SHA-256 hex digest is 64 chars

    def test_same_input_produces_same_hash(self):
        """Identical input text should produce identical hashes."""
        text = "This is a legal consent agreement."
        assert _hash_text(text) == _hash_text(text)

    def test_different_input_produces_different_hash(self):
        """Different input text should produce different hashes."""
        hash_a = _hash_text("Version 1.0 Terms")
        hash_b = _hash_text("Version 2.0 Terms")
        assert hash_a != hash_b

    def test_empty_string_produces_valid_hash(self):
        """Even an empty string should produce a valid SHA-256 hash."""
        result = _hash_text("")
        expected = hashlib.sha256(b"").hexdigest()
        assert result == expected

    def test_unicode_text_produces_valid_hash(self):
        """Unicode characters should be properly hashed."""
        result = _hash_text("Les termes et conditions de la plateforme")
        assert len(result) == 64


# ---------------------------------------------------------------------------
# record_consent: SHA-256 hash is stored
# ---------------------------------------------------------------------------


class TestRecordConsent:
    """Tests for the consent recording function."""

    @pytest.mark.asyncio
    async def test_consent_recorded_with_sha256_hash(self, mock_db):
        """Recording a consent should store the SHA-256 hash of the text."""
        user_id = uuid.uuid4()
        text = SAMPLE_CONSENT_TEXT
        expected_hash = hashlib.sha256(text.encode("utf-8")).hexdigest()

        result = await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=text,
            ip_address="192.168.1.1",
        )

        # Verify db.add was called
        mock_db.add.assert_called_once()
        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.consent_text_hash == expected_hash

    @pytest.mark.asyncio
    async def test_consent_stores_correct_version(self, mock_db):
        """The consent version should match the version registry."""
        user_id = uuid.uuid4()

        result = await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.consent_version == CONSENT_VERSIONS[ConsentType.PLATFORM_TOS]

    @pytest.mark.asyncio
    async def test_consent_stores_ip_and_user_agent(self, mock_db):
        """IP address and user agent should be stored in the record."""
        user_id = uuid.uuid4()

        result = await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
            ip_address="10.0.0.1",
            user_agent="VISP-iOS/1.0.0",
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.ip_address == "10.0.0.1"
        assert consent_obj.user_agent == "VISP-iOS/1.0.0"

    @pytest.mark.asyncio
    async def test_consent_stores_device_id(self, mock_db):
        """Device ID should be stored when provided."""
        user_id = uuid.uuid4()

        result = await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
            device_id="IDFV-12345-ABCDE",
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.device_id == "IDFV-12345-ABCDE"

    @pytest.mark.asyncio
    async def test_revocation_recorded_with_granted_false(self, mock_db):
        """A revocation should be recorded with granted=False."""
        user_id = uuid.uuid4()

        result = await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
            granted=False,
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.granted is False

    @pytest.mark.asyncio
    async def test_record_consent_calls_flush(self, mock_db):
        """record_consent should call db.flush() to populate server defaults."""
        user_id = uuid.uuid4()

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
        )

        mock_db.flush.assert_called_once()


# ---------------------------------------------------------------------------
# check_consent: returns latest version
# ---------------------------------------------------------------------------


class TestCheckConsent:
    """Tests for the consent checking function."""

    @pytest.mark.asyncio
    async def test_check_consent_returns_latest_granted(self, mock_db):
        """check_consent should return the most recent granted consent."""
        user_id = uuid.uuid4()
        latest = _make_consent_record(user_id=user_id, granted=True)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = latest
        mock_db.execute.return_value = result_mock

        result = await check_consent(mock_db, user_id, ConsentType.PLATFORM_TOS)

        assert result is not None
        assert result.granted is True

    @pytest.mark.asyncio
    async def test_check_consent_returns_none_when_revoked(self, mock_db):
        """If the most recent consent was a revocation, return None."""
        user_id = uuid.uuid4()
        revoked = _make_consent_record(user_id=user_id, granted=False)

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = revoked
        mock_db.execute.return_value = result_mock

        result = await check_consent(mock_db, user_id, ConsentType.PLATFORM_TOS)

        assert result is None

    @pytest.mark.asyncio
    async def test_check_consent_returns_none_when_no_consent(self, mock_db):
        """If the user has never granted this consent type, return None."""
        user_id = uuid.uuid4()

        result_mock = MagicMock()
        result_mock.scalar_one_or_none.return_value = None
        mock_db.execute.return_value = result_mock

        result = await check_consent(mock_db, user_id, ConsentType.PLATFORM_TOS)

        assert result is None


# ---------------------------------------------------------------------------
# Append-only: consents cannot be updated
# ---------------------------------------------------------------------------


class TestAppendOnlyImmutability:
    """Tests that the consent system is append-only (no updates or deletes)."""

    @pytest.mark.asyncio
    async def test_record_consent_only_uses_add_never_update(self, mock_db):
        """record_consent should only call db.add(), never update existing rows."""
        user_id = uuid.uuid4()

        # Record first consent
        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text="Version 1 consent text",
        )

        # Record second consent (different text, same type)
        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text="Version 2 consent text",
        )

        # db.add should be called twice (once per record)
        assert mock_db.add.call_count == 2
        # Each call should create a NEW LegalConsent object
        first_obj = mock_db.add.call_args_list[0][0][0]
        second_obj = mock_db.add.call_args_list[1][0][0]
        assert first_obj is not second_obj

    @pytest.mark.asyncio
    async def test_each_consent_has_unique_hash(self, mock_db):
        """Different consent texts should produce different hashes."""
        user_id = uuid.uuid4()

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text="First version of terms",
        )

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text="Second version of terms",
        )

        first_hash = mock_db.add.call_args_list[0][0][0].consent_text_hash
        second_hash = mock_db.add.call_args_list[1][0][0].consent_text_hash
        assert first_hash != second_hash


# ---------------------------------------------------------------------------
# All consent types can be recorded
# ---------------------------------------------------------------------------


class TestAllConsentTypes:
    """Tests that every consent type can be recorded."""

    @pytest.mark.asyncio
    @pytest.mark.parametrize("consent_type", list(ConsentType))
    async def test_all_consent_types_can_be_recorded(self, mock_db, consent_type):
        """Every ConsentType enum value should be recordable."""
        user_id = uuid.uuid4()

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=consent_type,
            consent_text=f"Consent text for {consent_type.value}",
        )

        mock_db.add.assert_called()
        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.consent_type == consent_type

    def test_all_consent_types_have_version(self):
        """Every ConsentType should have a registered version."""
        for consent_type in ConsentType:
            version = get_latest_version(consent_type)
            assert version is not None
            assert isinstance(version, str)
            assert len(version) > 0

    def test_consent_versions_registry_complete(self):
        """CONSENT_VERSIONS should have an entry for every ConsentType."""
        for consent_type in ConsentType:
            assert consent_type in CONSENT_VERSIONS, (
                f"ConsentType.{consent_type.name} is missing from CONSENT_VERSIONS"
            )


# ---------------------------------------------------------------------------
# IP and user agent are stored
# ---------------------------------------------------------------------------


class TestAuditFieldStorage:
    """Tests that audit fields (IP, user agent, device ID) are stored correctly."""

    @pytest.mark.asyncio
    async def test_ip_address_stored(self, mock_db):
        """IP address should be stored exactly as provided."""
        user_id = uuid.uuid4()

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
            ip_address="203.0.113.42",
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.ip_address == "203.0.113.42"

    @pytest.mark.asyncio
    async def test_user_agent_stored(self, mock_db):
        """User agent should be stored exactly as provided."""
        user_id = uuid.uuid4()
        ua = "Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X)"

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
            user_agent=ua,
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.user_agent == ua

    @pytest.mark.asyncio
    async def test_null_ip_and_agent_allowed(self, mock_db):
        """IP and user agent should accept None values."""
        user_id = uuid.uuid4()

        await record_consent(
            mock_db,
            user_id=user_id,
            consent_type=ConsentType.PLATFORM_TOS,
            consent_text=SAMPLE_CONSENT_TEXT,
            ip_address=None,
            user_agent=None,
        )

        consent_obj = mock_db.add.call_args[0][0]
        assert consent_obj.ip_address is None
        assert consent_obj.user_agent is None


# ---------------------------------------------------------------------------
# get_latest_version
# ---------------------------------------------------------------------------


class TestGetLatestVersion:
    """Tests for the consent version registry lookup."""

    def test_platform_tos_version(self):
        assert get_latest_version(ConsentType.PLATFORM_TOS) == "1.0"

    def test_provider_ic_agreement_version(self):
        assert get_latest_version(ConsentType.PROVIDER_IC_AGREEMENT) == "1.0"

    def test_level_4_emergency_sla_version(self):
        assert get_latest_version(ConsentType.LEVEL_4_EMERGENCY_SLA) == "1.0"

    def test_emergency_pricing_consent_version(self):
        assert get_latest_version(ConsentType.EMERGENCY_PRICING_CONSENT) == "1.0"
