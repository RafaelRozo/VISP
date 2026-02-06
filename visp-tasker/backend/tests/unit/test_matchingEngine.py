"""
Unit tests for the Provider Matching Engine -- VISP-BE-MATCHING-003.

Tests the hard filter checks, soft ranking logic, and Level 4 emergency
matching rules in isolation using mocked database sessions and domain objects.
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
)
from src.services.matchingEngine import (
    LEVEL_4_MIN_INSURANCE_CENTS,
    LEVEL_NUMERIC,
    LICENSED_LEVELS,
    AssignmentError,
    JobNotFoundError,
    ProviderNotFoundError,
    _background_check_valid,
    _evaluate_candidate,
    _has_active_insurance,
    _has_active_on_call_shift,
    _has_valid_license,
    _level_meets_requirement,
    find_matching_providers,
)


# ---------------------------------------------------------------------------
# _level_meets_requirement
# ---------------------------------------------------------------------------


class TestLevelMeetsRequirement:
    """Tests for the provider level >= job level hard check."""

    def test_same_level_passes(self):
        assert _level_meets_requirement(ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_1) is True

    def test_higher_provider_level_passes(self):
        assert _level_meets_requirement(ProviderLevel.LEVEL_3, ProviderLevel.LEVEL_1) is True

    def test_lower_provider_level_fails(self):
        assert _level_meets_requirement(ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_2) is False

    def test_level4_provider_passes_all(self):
        for job_level in ProviderLevel:
            assert _level_meets_requirement(ProviderLevel.LEVEL_4, job_level) is True

    def test_level1_provider_only_passes_level1(self):
        assert _level_meets_requirement(ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_1) is True
        assert _level_meets_requirement(ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_2) is False
        assert _level_meets_requirement(ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_3) is False
        assert _level_meets_requirement(ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_4) is False


# ---------------------------------------------------------------------------
# _background_check_valid
# ---------------------------------------------------------------------------


class TestBackgroundCheckValid:
    """Tests for background check verification status and expiry."""

    def test_cleared_not_expired_passes(self, sample_provider):
        sample_provider.background_check_status = BackgroundCheckStatus.CLEARED
        sample_provider.background_check_expiry = date(2027, 1, 1)
        assert _background_check_valid(sample_provider) is True

    def test_pending_status_fails(self, sample_provider):
        sample_provider.background_check_status = BackgroundCheckStatus.PENDING
        assert _background_check_valid(sample_provider) is False

    def test_expired_status_fails(self, sample_provider):
        sample_provider.background_check_status = BackgroundCheckStatus.EXPIRED
        assert _background_check_valid(sample_provider) is False

    def test_cleared_but_past_expiry_fails(self, sample_provider):
        sample_provider.background_check_status = BackgroundCheckStatus.CLEARED
        sample_provider.background_check_expiry = date(2020, 1, 1)
        assert _background_check_valid(sample_provider) is False

    def test_cleared_no_expiry_passes(self, sample_provider):
        """If expiry is None, the check is considered valid (no expiry set)."""
        sample_provider.background_check_status = BackgroundCheckStatus.CLEARED
        sample_provider.background_check_expiry = None
        assert _background_check_valid(sample_provider) is True

    def test_reference_date_overrides_today(self, sample_provider):
        sample_provider.background_check_status = BackgroundCheckStatus.CLEARED
        sample_provider.background_check_expiry = date(2025, 6, 1)
        # Reference date before expiry
        assert _background_check_valid(sample_provider, reference_date=date(2025, 5, 1)) is True
        # Reference date after expiry
        assert _background_check_valid(sample_provider, reference_date=date(2025, 7, 1)) is False


# ---------------------------------------------------------------------------
# _has_valid_license (async DB query)
# ---------------------------------------------------------------------------


class TestHasValidLicense:
    """Tests for verifying provider has a valid, non-expired license."""

    @pytest.mark.asyncio
    async def test_provider_with_valid_license_returns_true(self, mock_db):
        """Provider with at least one verified non-expired license passes."""
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 1
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_valid_license(mock_db, provider_id)
        assert result is True

    @pytest.mark.asyncio
    async def test_provider_without_license_returns_false(self, mock_db):
        """Provider with no verified license fails."""
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_valid_license(mock_db, provider_id)
        assert result is False


# ---------------------------------------------------------------------------
# _has_active_insurance (async DB query)
# ---------------------------------------------------------------------------


class TestHasActiveInsurance:
    """Tests for verifying provider has active insurance."""

    @pytest.mark.asyncio
    async def test_provider_with_active_insurance_returns_true(self, mock_db):
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 1
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_active_insurance(mock_db, provider_id)
        assert result is True

    @pytest.mark.asyncio
    async def test_provider_without_insurance_returns_false(self, mock_db):
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_active_insurance(mock_db, provider_id)
        assert result is False

    @pytest.mark.asyncio
    async def test_expired_insurance_returns_false(self, mock_db):
        """Insurance that has expired should not count."""
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_active_insurance(
            mock_db, provider_id, reference_date=date(2025, 6, 1)
        )
        assert result is False

    @pytest.mark.asyncio
    async def test_min_coverage_check_applied(self, mock_db):
        """When min_coverage_cents is specified, only policies meeting the
        threshold should be counted."""
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_active_insurance(
            mock_db, provider_id, min_coverage_cents=LEVEL_4_MIN_INSURANCE_CENTS
        )
        assert result is False
        # Verify execute was called (the min coverage filter was applied)
        mock_db.execute.assert_called_once()


# ---------------------------------------------------------------------------
# _has_active_on_call_shift (async DB query)
# ---------------------------------------------------------------------------


class TestHasActiveOnCallShift:
    """Tests for L4 on-call shift validation."""

    @pytest.mark.asyncio
    async def test_provider_with_active_shift_returns_true(self, mock_db):
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 1
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_active_on_call_shift(mock_db, provider_id)
        assert result is True

    @pytest.mark.asyncio
    async def test_provider_without_shift_returns_false(self, mock_db):
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        provider_id = uuid.uuid4()
        result = await _has_active_on_call_shift(mock_db, provider_id)
        assert result is False


# ---------------------------------------------------------------------------
# _evaluate_candidate -- integrated hard filter pipeline
# ---------------------------------------------------------------------------


class TestEvaluateCandidate:
    """Tests for the full candidate evaluation pipeline."""

    @pytest.mark.asyncio
    async def test_level_mismatch_rejects_provider(self, mock_db, sample_provider):
        """A Level 1 provider should be rejected for a Level 2 job."""
        sample_provider.current_level = ProviderLevel.LEVEL_1
        result = await _evaluate_candidate(
            mock_db,
            sample_provider,
            job_level=ProviderLevel.LEVEL_2,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_inactive_provider_rejected(self, mock_db, sample_provider):
        """A suspended provider should be rejected regardless of level."""
        sample_provider.status = ProviderProfileStatus.SUSPENDED
        result = await _evaluate_candidate(
            mock_db,
            sample_provider,
            job_level=ProviderLevel.LEVEL_1,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_expired_background_check_rejects(self, mock_db, sample_provider):
        """A provider with expired background check should be rejected."""
        sample_provider.background_check_status = BackgroundCheckStatus.CLEARED
        sample_provider.background_check_expiry = date(2020, 1, 1)
        result = await _evaluate_candidate(
            mock_db,
            sample_provider,
            job_level=ProviderLevel.LEVEL_1,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_missing_credential_blocks_level3(self, mock_db, sample_provider):
        """A Level 3 provider without a valid license should be rejected."""
        sample_provider.current_level = ProviderLevel.LEVEL_3
        # First call: license check returns 0 (no valid license)
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        result = await _evaluate_candidate(
            mock_db,
            sample_provider,
            job_level=ProviderLevel.LEVEL_3,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_expired_insurance_blocks_level3(self, mock_db, sample_provider):
        """A Level 3 provider without valid insurance should be rejected."""
        sample_provider.current_level = ProviderLevel.LEVEL_3

        # First call (license): passes. Second call (insurance): fails.
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count == 1:
                # License check passes
                result_mock.scalar_one.return_value = 1
            else:
                # Insurance check fails
                result_mock.scalar_one.return_value = 0
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await _evaluate_candidate(
            mock_db,
            sample_provider,
            job_level=ProviderLevel.LEVEL_3,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_level1_provider_passes_all_hard_filters(self, mock_db, sample_provider):
        """A fully qualified Level 1 provider should pass all hard filters."""
        # Both license and insurance checks return 0 (not required for L1,
        # but the function still queries them for informational purposes)
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 0
        mock_db.execute.return_value = result_mock

        result = await _evaluate_candidate(
            mock_db,
            sample_provider,
            job_level=ProviderLevel.LEVEL_1,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is not None
        assert result["provider"] == sample_provider
        assert result["distance_km"] == 5.0

    @pytest.mark.asyncio
    async def test_l4_no_on_call_shift_rejects(self, mock_db, sample_provider_l4):
        """A Level 4 provider without an active on-call shift is rejected."""
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count <= 2:
                # License and insurance checks pass
                result_mock.scalar_one.return_value = 1
            else:
                # On-call shift check fails
                result_mock.scalar_one.return_value = 0
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await _evaluate_candidate(
            mock_db,
            sample_provider_l4,
            job_level=ProviderLevel.LEVEL_4,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=10.0,
        )
        assert result is None


# ---------------------------------------------------------------------------
# Soft ranking: closer provider ranks higher, higher score ranks higher
# ---------------------------------------------------------------------------


class TestSoftRanking:
    """Tests that the ranking algorithm ranks providers correctly by
    composite score (internal_score + distance + response_time)."""

    def test_closer_provider_ranks_higher(self):
        """Given equal internal scores, the closer provider should rank higher."""
        from src.algorithms.providerRanking import RankingCandidate, rank_providers

        closer = RankingCandidate(
            provider="providerA",
            provider_id=uuid.uuid4(),
            internal_score=70.0,
            distance_km=2.0,
            response_time_avg_min=None,
        )
        farther = RankingCandidate(
            provider="providerB",
            provider_id=uuid.uuid4(),
            internal_score=70.0,
            distance_km=40.0,
            response_time_avg_min=None,
        )
        ranked = rank_providers([farther, closer])
        assert ranked[0].provider == "providerA"
        assert ranked[1].provider == "providerB"

    def test_higher_score_ranks_higher(self):
        """Given equal distances, the provider with a higher internal score
        should rank higher."""
        from src.algorithms.providerRanking import RankingCandidate, rank_providers

        high_score = RankingCandidate(
            provider="providerA",
            provider_id=uuid.uuid4(),
            internal_score=95.0,
            distance_km=10.0,
            response_time_avg_min=None,
        )
        low_score = RankingCandidate(
            provider="providerB",
            provider_id=uuid.uuid4(),
            internal_score=50.0,
            distance_km=10.0,
            response_time_avg_min=None,
        )
        ranked = rank_providers([low_score, high_score])
        assert ranked[0].provider == "providerA"
        assert ranked[1].provider == "providerB"

    def test_composite_score_is_weighted_sum(self):
        """Verify the composite score formula uses the documented weights."""
        from src.algorithms.providerRanking import (
            RankingCandidate,
            _normalise_distance,
            _normalise_internal_score,
            _normalise_response_time,
            rank_providers,
        )

        candidate = RankingCandidate(
            provider="test",
            provider_id=uuid.uuid4(),
            internal_score=80.0,
            distance_km=10.0,
            response_time_avg_min=15.0,
        )
        ranked = rank_providers([candidate])
        result = ranked[0]

        expected_internal = _normalise_internal_score(80.0) * 0.6
        expected_distance = _normalise_distance(10.0) * 0.3
        expected_response = _normalise_response_time(15.0) * 0.1
        expected_composite = expected_internal + expected_distance + expected_response

        assert abs(result.composite_score - round(expected_composite, 2)) < 0.01


# ---------------------------------------------------------------------------
# L4 emergency matching
# ---------------------------------------------------------------------------


class TestL4EmergencyMatching:
    """Tests for Level 4 emergency-specific matching rules."""

    @pytest.mark.asyncio
    async def test_only_on_call_providers_eligible_for_l4(
        self, mock_db, sample_provider_l4
    ):
        """For a Level 4 job, a provider without an active on-call shift
        must be rejected even if all other checks pass."""
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count <= 2:
                # License and insurance pass
                result_mock.scalar_one.return_value = 1
            elif call_count == 3:
                # On-call shift check fails
                result_mock.scalar_one.return_value = 0
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await _evaluate_candidate(
            mock_db,
            sample_provider_l4,
            job_level=ProviderLevel.LEVEL_4,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_l4_requires_emergency_insurance(self, mock_db, sample_provider_l4):
        """Level 4 jobs require $2M+ emergency insurance coverage."""
        call_count = 0

        def side_effect(*args, **kwargs):
            nonlocal call_count
            call_count += 1
            result_mock = MagicMock()
            if call_count <= 2:
                # License and insurance pass
                result_mock.scalar_one.return_value = 1
            elif call_count == 3:
                # On-call shift passes
                result_mock.scalar_one.return_value = 1
            elif call_count == 4:
                # Emergency insurance (min coverage) fails
                result_mock.scalar_one.return_value = 0
            return result_mock

        mock_db.execute.side_effect = side_effect

        result = await _evaluate_candidate(
            mock_db,
            sample_provider_l4,
            job_level=ProviderLevel.LEVEL_4,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is None

    @pytest.mark.asyncio
    async def test_l4_fully_qualified_passes(self, mock_db, sample_provider_l4):
        """A Level 4 provider that passes ALL checks should be returned."""
        result_mock = MagicMock()
        result_mock.scalar_one.return_value = 1
        mock_db.execute.return_value = result_mock

        result = await _evaluate_candidate(
            mock_db,
            sample_provider_l4,
            job_level=ProviderLevel.LEVEL_4,
            job_lat=43.65,
            job_lon=-79.38,
            distance_km=5.0,
        )
        assert result is not None
        assert result["provider"] == sample_provider_l4
        assert result["on_call_active"] is True


# ---------------------------------------------------------------------------
# Empty result when no providers qualify
# ---------------------------------------------------------------------------


class TestEmptyResults:
    """Tests that the engine returns empty results when no providers match."""

    @pytest.mark.asyncio
    async def test_empty_result_when_no_providers_in_db(self, mock_db, sample_job):
        """When the DB has no active providers, the result should be empty."""
        # Mock the task query
        task_result = MagicMock()
        task_result.scalar_one_or_none.return_value = sample_job.task

        # Mock the provider query -- return no providers
        provider_scalars = MagicMock()
        provider_scalars.all.return_value = []
        provider_result = MagicMock()
        provider_result.scalars.return_value = provider_scalars

        mock_db.execute.side_effect = [task_result, provider_result]

        with patch(
            "src.services.matchingEngine.filter_by_radius", return_value=[]
        ):
            result = await find_matching_providers(mock_db, sample_job)

        assert result["matches"] == []
        assert result["total_qualified"] == 0

    @pytest.mark.asyncio
    async def test_empty_result_when_all_providers_fail_hard_filters(
        self, mock_db, sample_job, sample_provider
    ):
        """When all providers fail hard filters, the result should be empty."""
        # Make the provider fail by setting status to suspended
        sample_provider.status = ProviderProfileStatus.SUSPENDED

        task_result = MagicMock()
        task_result.scalar_one_or_none.return_value = sample_job.task

        provider_scalars = MagicMock()
        provider_scalars.all.return_value = [sample_provider]
        provider_result = MagicMock()
        provider_result.scalars.return_value = provider_scalars

        mock_db.execute.side_effect = [task_result, provider_result]

        from src.services.geoService import ProviderDistance

        with patch(
            "src.services.matchingEngine.filter_by_radius",
            return_value=[ProviderDistance(provider=sample_provider, distance_km=5.0)],
        ):
            result = await find_matching_providers(mock_db, sample_job)

        assert result["matches"] == []
        assert result["total_qualified"] == 0
