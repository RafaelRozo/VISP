"""
Unit tests for the Provider Scoring & Penalties Engine -- VISP-BE-SCORING-005.

Tests penalty application, Level 4 no_show immediate expulsion, score decay,
minimum score thresholds, score recovery, and level-specific penalty matrices.
"""

import uuid
from datetime import datetime, timedelta, timezone
from decimal import Decimal
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.provider import ProviderLevel, ProviderProfile, ProviderProfileStatus
from src.services.scoringEngine import (
    LEVEL_SCORE_CONFIG,
    PENALTY_TABLE,
    WEEKLY_RECOVERY_POINTS,
    NormalizationResult,
    PenaltyAppliedResult,
    _append_penalty,
    _count_incident_free_weeks,
    _get_penalty_history,
    _penalty_history,
    apply_penalty,
    check_expulsion,
    normalize_score,
)


# ---------------------------------------------------------------------------
# Fixtures local to this module
# ---------------------------------------------------------------------------


@pytest.fixture(autouse=True)
def clear_penalty_history():
    """Ensure the module-level penalty history is clean before each test."""
    _penalty_history.clear()
    yield
    _penalty_history.clear()


def _make_provider_profile(
    provider_id: uuid.UUID | None = None,
    level: ProviderLevel = ProviderLevel.LEVEL_1,
    score: Decimal = Decimal("70.00"),
    status: ProviderProfileStatus = ProviderProfileStatus.ACTIVE,
) -> MagicMock:
    """Helper to create a mock ProviderProfile with configurable attributes."""
    profile = MagicMock(spec=ProviderProfile)
    profile.id = provider_id or uuid.uuid4()
    profile.current_level = level
    profile.internal_score = score
    profile.status = status
    return profile


def _mock_db_with_profile(profile: MagicMock) -> AsyncMock:
    """Create a mock AsyncSession that returns the given profile."""
    db = AsyncMock()
    result_mock = MagicMock()
    result_mock.scalar_one_or_none.return_value = profile
    db.execute.return_value = result_mock
    db.flush = AsyncMock()
    return db


# ---------------------------------------------------------------------------
# Penalty application by infraction type
# ---------------------------------------------------------------------------


class TestPenaltyApplication:
    """Tests that penalties are correctly applied per infraction type and level."""

    @pytest.mark.asyncio
    async def test_level1_no_show_deducts_10_points(self):
        """Level 1 no_show should deduct 10 points."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("70.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "no_show")

        assert result.penalty_type == "no_show"
        assert result.previous_score == Decimal("70.00")
        assert result.new_score == Decimal("60.00")
        assert profile.internal_score == Decimal("60.00")

    @pytest.mark.asyncio
    async def test_level2_cancellation_deducts_6_points(self):
        """Level 2 cancellation should deduct 6 points."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_2, score=Decimal("75.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "cancellation")

        assert result.new_score == Decimal("69.00")

    @pytest.mark.asyncio
    async def test_level3_bad_review_deducts_10_points(self):
        """Level 3 bad_review should deduct 10 points."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_3, score=Decimal("80.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "bad_review")

        assert result.new_score == Decimal("70.00")

    @pytest.mark.asyncio
    async def test_level4_sla_breach_deducts_30_points(self):
        """Level 4 sla_breach should deduct 30 points."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_4, score=Decimal("85.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "sla_breach")

        # 85 - 30 = 55, but L4 min is 70, so clamped to 70
        assert result.new_score == Decimal("70")

    @pytest.mark.asyncio
    async def test_invalid_penalty_type_raises(self):
        """An invalid penalty type should raise ValueError."""
        profile = _make_provider_profile(level=ProviderLevel.LEVEL_1)
        db = _mock_db_with_profile(profile)

        with pytest.raises(ValueError, match="Invalid penalty type"):
            await apply_penalty(db, profile.id, "nonexistent_penalty")


# ---------------------------------------------------------------------------
# L4 no_show = immediate expulsion
# ---------------------------------------------------------------------------


class TestL4NoShowExpulsion:
    """Tests the zero-tolerance Level 4 no_show rule."""

    @pytest.mark.asyncio
    async def test_l4_no_show_sets_score_to_zero(self):
        """Level 4 no_show should set the score to 0."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_4, score=Decimal("85.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "no_show")

        assert result.new_score == Decimal("0")
        assert result.is_expelled is True

    @pytest.mark.asyncio
    async def test_l4_no_show_suspends_provider(self):
        """Level 4 no_show should change provider status to SUSPENDED."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_4, score=Decimal("85.00")
        )
        db = _mock_db_with_profile(profile)

        await apply_penalty(db, profile.id, "no_show")

        assert profile.status == ProviderProfileStatus.SUSPENDED

    @pytest.mark.asyncio
    async def test_l4_no_show_records_full_deduction(self):
        """The deducted points should equal the entire previous score."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_4, score=Decimal("92.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "no_show")

        assert result.points_deducted == Decimal("92.00")

    @pytest.mark.asyncio
    async def test_l1_no_show_does_not_expel(self):
        """Level 1 no_show should NOT trigger immediate expulsion (only L4)."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("70.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "no_show")

        assert result.is_expelled is False
        assert result.new_score == Decimal("60.00")
        assert profile.status == ProviderProfileStatus.ACTIVE


# ---------------------------------------------------------------------------
# Score clamping and minimum threshold
# ---------------------------------------------------------------------------


class TestMinimumScoreThreshold:
    """Tests that scores are clamped and trigger suspension at minimums."""

    @pytest.mark.asyncio
    async def test_score_clamped_at_level_minimum(self):
        """Score should not drop below the level's minimum."""
        # L1 min is 40, starting at 45, deduct 10 (no_show) = 35, clamped to 40
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("45.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "no_show")

        config = LEVEL_SCORE_CONFIG[ProviderLevel.LEVEL_1]
        assert result.new_score == config.min  # 40

    @pytest.mark.asyncio
    async def test_score_at_minimum_triggers_suspension(self):
        """When the score drops to the minimum, the provider should be suspended."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("42.00")
        )
        db = _mock_db_with_profile(profile)

        result = await apply_penalty(db, profile.id, "response_timeout")
        # 42 - 2 = 40, which is the L1 min

        assert result.new_score == Decimal("40")
        assert result.is_expelled is True
        assert profile.status == ProviderProfileStatus.SUSPENDED

    @pytest.mark.parametrize(
        "level,expected_min",
        [
            (ProviderLevel.LEVEL_1, Decimal("40")),
            (ProviderLevel.LEVEL_2, Decimal("50")),
            (ProviderLevel.LEVEL_3, Decimal("60")),
            (ProviderLevel.LEVEL_4, Decimal("70")),
        ],
    )
    def test_level_minimum_scores(self, level, expected_min):
        """Verify the minimum score thresholds per level match the spec."""
        assert LEVEL_SCORE_CONFIG[level].min == expected_min


# ---------------------------------------------------------------------------
# Score decay / incident-free week counting
# ---------------------------------------------------------------------------


class TestScoreDecay:
    """Tests the incident-free weeks calculation used for score recovery."""

    def test_no_penalties_returns_52_weeks(self):
        """A provider with no penalty history should show 52 incident-free weeks."""
        provider_id = uuid.uuid4()
        weeks = _count_incident_free_weeks(provider_id)
        assert weeks == 52

    def test_recent_penalty_returns_zero_weeks(self):
        """A penalty within the last 7 days means 0 incident-free weeks."""
        from src.services.scoringEngine import PenaltyRecord

        provider_id = uuid.uuid4()
        _append_penalty(
            provider_id,
            PenaltyRecord(
                penalty_type="cancellation",
                points_deducted=Decimal("3"),
                applied_at=datetime.now(timezone.utc) - timedelta(days=2),
            ),
        )
        weeks = _count_incident_free_weeks(provider_id)
        assert weeks == 0

    def test_penalty_14_days_ago_returns_2_weeks(self):
        """A penalty from 14 days ago should yield 2 incident-free weeks."""
        from src.services.scoringEngine import PenaltyRecord

        provider_id = uuid.uuid4()
        _append_penalty(
            provider_id,
            PenaltyRecord(
                penalty_type="bad_review",
                points_deducted=Decimal("5"),
                applied_at=datetime.now(timezone.utc) - timedelta(days=14),
            ),
        )
        weeks = _count_incident_free_weeks(provider_id)
        assert weeks == 2


# ---------------------------------------------------------------------------
# Score recovery (+5 weekly)
# ---------------------------------------------------------------------------


class TestScoreRecovery:
    """Tests weekly score normalization / recovery."""

    @pytest.mark.asyncio
    async def test_recovery_adds_5_points(self):
        """A provider below base with incident-free weeks should recover +5."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("60.00")
        )
        db = _mock_db_with_profile(profile)

        # L1 base is 70, current is 60, incident-free weeks > 0
        # We need the penalty history to show incident-free time
        # (no penalties = 52 weeks)
        result = await normalize_score(db, profile.id)

        assert result.points_recovered == Decimal("5")
        assert result.new_score == Decimal("65.00")

    @pytest.mark.asyncio
    async def test_recovery_capped_at_base_score(self):
        """Recovery should not push the score above the level's base score."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("68.00")
        )
        db = _mock_db_with_profile(profile)

        result = await normalize_score(db, profile.id)

        # 68 + 5 would be 73, but base is 70, so cap at 70
        # Recovery = min(5, 70 - 68) = 2
        assert result.new_score == Decimal("70")
        assert result.points_recovered == Decimal("2")

    @pytest.mark.asyncio
    async def test_no_recovery_when_at_or_above_base(self):
        """A provider at or above base score should get 0 recovery."""
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("70.00")
        )
        db = _mock_db_with_profile(profile)

        result = await normalize_score(db, profile.id)

        assert result.points_recovered == Decimal("0")
        assert result.new_score == Decimal("70.00")

    @pytest.mark.asyncio
    async def test_no_recovery_when_recent_incident(self):
        """No recovery if the provider had an incident within the last week."""
        from src.services.scoringEngine import PenaltyRecord

        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("60.00")
        )
        db = _mock_db_with_profile(profile)

        # Add a recent penalty (2 days ago)
        _append_penalty(
            profile.id,
            PenaltyRecord(
                penalty_type="cancellation",
                points_deducted=Decimal("3"),
                applied_at=datetime.now(timezone.utc) - timedelta(days=2),
            ),
        )

        result = await normalize_score(db, profile.id)

        assert result.points_recovered == Decimal("0")
        assert result.new_score == Decimal("60.00")


# ---------------------------------------------------------------------------
# Level-specific penalty matrices
# ---------------------------------------------------------------------------


class TestLevelSpecificPenaltyMatrices:
    """Tests that each level has the correct penalty types and amounts."""

    def test_level1_penalty_types(self):
        penalties = PENALTY_TABLE[ProviderLevel.LEVEL_1]
        assert "response_timeout" in penalties
        assert "cancellation" in penalties
        assert "no_show" in penalties
        assert "bad_review" in penalties
        assert penalties["response_timeout"] == Decimal("-2")
        assert penalties["cancellation"] == Decimal("-3")
        assert penalties["no_show"] == Decimal("-10")
        assert penalties["bad_review"] == Decimal("-5")

    def test_level2_penalty_types(self):
        penalties = PENALTY_TABLE[ProviderLevel.LEVEL_2]
        assert penalties["response_timeout"] == Decimal("-4")
        assert penalties["cancellation"] == Decimal("-6")
        assert penalties["no_show"] == Decimal("-15")
        assert penalties["bad_review"] == Decimal("-7")

    def test_level3_penalty_types(self):
        penalties = PENALTY_TABLE[ProviderLevel.LEVEL_3]
        assert penalties["response_timeout"] == Decimal("-6")
        assert penalties["cancellation"] == Decimal("-10")
        assert penalties["no_show"] == Decimal("-30")
        assert penalties["bad_review"] == Decimal("-10")

    def test_level4_penalty_types(self):
        """Level 4 has sla_breach instead of bad_review."""
        penalties = PENALTY_TABLE[ProviderLevel.LEVEL_4]
        assert penalties["response_timeout"] == Decimal("-15")
        assert penalties["cancellation"] == Decimal("-25")
        assert penalties["no_show"] == Decimal("-50")
        assert penalties["sla_breach"] == Decimal("-30")
        assert "bad_review" not in penalties

    def test_penalties_increase_with_level(self):
        """Higher levels should have stricter penalties for the same infraction."""
        for infraction in ("response_timeout", "cancellation", "no_show"):
            l1_penalty = abs(PENALTY_TABLE[ProviderLevel.LEVEL_1][infraction])
            l2_penalty = abs(PENALTY_TABLE[ProviderLevel.LEVEL_2][infraction])
            l3_penalty = abs(PENALTY_TABLE[ProviderLevel.LEVEL_3][infraction])
            assert l2_penalty > l1_penalty, f"L2 {infraction} should be stricter than L1"
            assert l3_penalty > l2_penalty, f"L3 {infraction} should be stricter than L2"


# ---------------------------------------------------------------------------
# check_expulsion
# ---------------------------------------------------------------------------


class TestCheckExpulsion:
    """Tests the expulsion check logic."""

    @pytest.mark.asyncio
    async def test_suspended_provider_is_expelled(self):
        profile = _make_provider_profile(status=ProviderProfileStatus.SUSPENDED)
        db = _mock_db_with_profile(profile)

        result = await check_expulsion(db, profile.id)
        assert result is True

    @pytest.mark.asyncio
    async def test_active_provider_above_min_is_not_expelled(self):
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("70.00")
        )
        db = _mock_db_with_profile(profile)

        result = await check_expulsion(db, profile.id)
        assert result is False

    @pytest.mark.asyncio
    async def test_provider_at_min_score_is_expelled(self):
        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_1, score=Decimal("40.00")
        )
        db = _mock_db_with_profile(profile)

        result = await check_expulsion(db, profile.id)
        assert result is True

    @pytest.mark.asyncio
    async def test_l4_with_no_show_history_is_expelled(self):
        """A Level 4 provider with a no_show in history should be flagged."""
        from src.services.scoringEngine import PenaltyRecord

        profile = _make_provider_profile(
            level=ProviderLevel.LEVEL_4, score=Decimal("85.00")
        )
        db = _mock_db_with_profile(profile)

        _append_penalty(
            profile.id,
            PenaltyRecord(
                penalty_type="no_show",
                points_deducted=Decimal("85.00"),
                applied_at=datetime.now(timezone.utc) - timedelta(days=30),
            ),
        )

        result = await check_expulsion(db, profile.id)
        assert result is True
