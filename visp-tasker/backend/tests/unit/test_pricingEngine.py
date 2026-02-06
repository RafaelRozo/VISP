"""
Unit tests for the Dynamic Pricing Engine -- VISP-BE-PRICING-006.

Tests base rate calculation, dynamic multipliers (night, weekend, emergency),
commission calculation per level, and multiplier cap enforcement.
"""

import uuid
from datetime import date, time
from decimal import Decimal, ROUND_HALF_UP
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from src.models.provider import ProviderLevel
from src.services.pricingEngine import (
    DEFAULT_COMMISSION,
    DYNAMIC_MULTIPLIER_MAX,
    EXTREME_WEATHER_MULTIPLIER,
    NIGHT_END,
    NIGHT_MULTIPLIER,
    NIGHT_START,
    PEAK_HOLIDAY_MULTIPLIER_MAX,
    PriceEstimate,
    _get_holiday_multiplier,
    _is_night_hours,
    calculate_price,
)


# ---------------------------------------------------------------------------
# _is_night_hours
# ---------------------------------------------------------------------------


class TestIsNightHours:
    """Tests for the night surcharge window detection (10pm-6am)."""

    def test_10pm_is_night(self):
        assert _is_night_hours(time(22, 0)) is True

    def test_11pm_is_night(self):
        assert _is_night_hours(time(23, 0)) is True

    def test_midnight_is_night(self):
        assert _is_night_hours(time(0, 0)) is True

    def test_3am_is_night(self):
        assert _is_night_hours(time(3, 0)) is True

    def test_5_59am_is_night(self):
        assert _is_night_hours(time(5, 59)) is True

    def test_6am_is_not_night(self):
        assert _is_night_hours(time(6, 0)) is False

    def test_noon_is_not_night(self):
        assert _is_night_hours(time(12, 0)) is False

    def test_9_59pm_is_not_night(self):
        assert _is_night_hours(time(21, 59)) is False


# ---------------------------------------------------------------------------
# _get_holiday_multiplier
# ---------------------------------------------------------------------------


class TestGetHolidayMultiplier:
    """Tests for holiday/weekend multiplier calculation."""

    def test_christmas_returns_max_multiplier(self):
        """Christmas Day (Dec 25) should return the 2.5x holiday max."""
        result = _get_holiday_multiplier(date(2025, 12, 25))
        assert result == PEAK_HOLIDAY_MULTIPLIER_MAX

    def test_canada_day_returns_max_multiplier(self):
        """Canada Day (Jul 1) should return the 2.5x holiday max."""
        result = _get_holiday_multiplier(date(2025, 7, 1))
        assert result == PEAK_HOLIDAY_MULTIPLIER_MAX

    def test_day_before_holiday_returns_1_5(self):
        """The day before a holiday should return 1.5x."""
        # Dec 24 is the day before Christmas (Dec 25)
        result = _get_holiday_multiplier(date(2025, 12, 24))
        assert result == Decimal("1.5")

    def test_day_after_holiday_returns_1_5(self):
        """The day after a holiday should return 1.5x."""
        # Dec 26 is Boxing Day (itself a holiday), but Jan 2 is day after New Year
        result = _get_holiday_multiplier(date(2025, 1, 2))
        assert result == Decimal("1.5")

    def test_weekend_returns_1_25(self):
        """A Saturday or Sunday not near a holiday should return 1.25x."""
        # Feb 8, 2025 is a Saturday, not adjacent to any holiday
        result = _get_holiday_multiplier(date(2025, 2, 8))
        assert result == Decimal("1.25")

    def test_regular_weekday_returns_1_0(self):
        """A regular weekday with no holiday proximity returns 1.0x."""
        # Feb 12, 2025 is a Wednesday, not near any holiday
        result = _get_holiday_multiplier(date(2025, 2, 12))
        assert result == Decimal("1.0")


# ---------------------------------------------------------------------------
# calculate_price -- base rate per level
# ---------------------------------------------------------------------------


class TestBaseRateCalculation:
    """Tests that base pricing comes directly from the service task catalog."""

    @pytest.mark.asyncio
    async def test_base_rate_from_task_non_emergency(self, mock_db, sample_task):
        """For a non-emergency request, the price should equal the task base
        rate (no multipliers applied)."""
        # Mock _get_service_task
        task_result = MagicMock()
        task_result.scalar_one_or_none.return_value = sample_task
        # Mock _get_commission_rates (no DB schedule)
        commission_result = MagicMock()
        commission_result.scalar_one_or_none.return_value = None

        mock_db.execute.side_effect = [task_result, MagicMock(), commission_result]

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=DEFAULT_COMMISSION[ProviderLevel.LEVEL_1],
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                is_emergency=False,
            )

        assert result.base_price_min_cents == sample_task.base_price_min_cents
        assert result.base_price_max_cents == sample_task.base_price_max_cents
        # Non-emergency: multiplier should be 1.0
        assert result.dynamic_multiplier == Decimal("1.0")
        assert result.final_price_min_cents == sample_task.base_price_min_cents
        assert result.final_price_max_cents == sample_task.base_price_max_cents


# ---------------------------------------------------------------------------
# Night surcharge multiplier
# ---------------------------------------------------------------------------


class TestNightSurchargeMultiplier:
    """Tests that emergency requests during night hours get 1.5x multiplier."""

    @pytest.mark.asyncio
    async def test_night_surcharge_applied_for_emergency(self, mock_db, sample_task):
        """An emergency request at 11pm should have 1.5x night multiplier."""
        # Mock weather to be non-extreme
        weather_mock = MagicMock()
        weather_mock.is_extreme = False

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine.get_weather_conditions",
            return_value=weather_mock,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=DEFAULT_COMMISSION[ProviderLevel.LEVEL_1],
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                requested_date=date(2025, 2, 12),  # Regular weekday
                requested_time=time(23, 0),  # 11pm
                is_emergency=True,
            )

        assert result.dynamic_multiplier == NIGHT_MULTIPLIER
        assert len(result.multiplier_details) == 1
        assert result.multiplier_details[0].rule_name == "Night Surcharge"

        expected_min = int(
            (Decimal(sample_task.base_price_min_cents) * NIGHT_MULTIPLIER)
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        assert result.final_price_min_cents == expected_min


# ---------------------------------------------------------------------------
# Weekend multiplier
# ---------------------------------------------------------------------------


class TestWeekendMultiplier:
    """Tests that emergency requests on weekends get the 1.25x multiplier."""

    @pytest.mark.asyncio
    async def test_weekend_multiplier_applied(self, mock_db, sample_task):
        """An emergency on a Saturday at 2pm should get the 1.25x weekend
        multiplier but not the night surcharge."""
        weather_mock = MagicMock()
        weather_mock.is_extreme = False

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine.get_weather_conditions",
            return_value=weather_mock,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=DEFAULT_COMMISSION[ProviderLevel.LEVEL_1],
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                requested_date=date(2025, 2, 8),  # Saturday
                requested_time=time(14, 0),  # 2pm -- not night
                is_emergency=True,
            )

        assert result.dynamic_multiplier == Decimal("1.25")
        # Should have exactly one multiplier detail (weekend, no night)
        assert any(
            d.rule_name == "Peak / Holiday Surcharge" for d in result.multiplier_details
        )


# ---------------------------------------------------------------------------
# Emergency multiplier stacking
# ---------------------------------------------------------------------------


class TestEmergencyMultiplierStacking:
    """Tests that multiple emergency multipliers stack multiplicatively."""

    @pytest.mark.asyncio
    async def test_night_plus_weather_stack(self, mock_db, sample_task):
        """Night (1.5x) and extreme weather (2.0x) should stack to 3.0x."""
        weather_mock = MagicMock()
        weather_mock.is_extreme = True
        weather_mock.condition = MagicMock()
        weather_mock.condition.value = "blizzard"
        weather_mock.description = "Heavy snowfall and low visibility"

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine.get_weather_conditions",
            return_value=weather_mock,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=DEFAULT_COMMISSION[ProviderLevel.LEVEL_1],
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                requested_date=date(2025, 2, 12),  # Regular weekday
                requested_time=time(23, 0),  # Night
                is_emergency=True,
            )

        # 1.5 * 2.0 = 3.0
        assert result.dynamic_multiplier == Decimal("3.0")
        assert len(result.multiplier_details) == 2


# ---------------------------------------------------------------------------
# Commission calculation per level
# ---------------------------------------------------------------------------


class TestCommissionCalculation:
    """Tests that commission rates are correctly applied per provider level."""

    @pytest.mark.parametrize(
        "level,expected_min,expected_max,expected_default",
        [
            (ProviderLevel.LEVEL_1, Decimal("0.1500"), Decimal("0.2000"), Decimal("0.1750")),
            (ProviderLevel.LEVEL_2, Decimal("0.1200"), Decimal("0.1800"), Decimal("0.1500")),
            (ProviderLevel.LEVEL_3, Decimal("0.0800"), Decimal("0.1200"), Decimal("0.1000")),
            (ProviderLevel.LEVEL_4, Decimal("0.1500"), Decimal("0.2500"), Decimal("0.2000")),
        ],
    )
    def test_default_commission_rates_per_level(
        self, level, expected_min, expected_max, expected_default
    ):
        """Verify the hardcoded default commission rates match the spec."""
        rates = DEFAULT_COMMISSION[level]
        assert rates["min"] == expected_min
        assert rates["max"] == expected_max
        assert rates["default"] == expected_default


# ---------------------------------------------------------------------------
# Provider payout = price - commission
# ---------------------------------------------------------------------------


class TestProviderPayout:
    """Tests that provider payout is calculated as price minus commission."""

    @pytest.mark.asyncio
    async def test_payout_equals_price_minus_commission(self, mock_db, sample_task):
        """Provider payout should be final price * (1 - commission rate)."""
        commission = DEFAULT_COMMISSION[ProviderLevel.LEVEL_1]

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=commission,
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                is_emergency=False,
            )

        # Payout min = final_min * (1 - commission_max)
        expected_payout_min = int(
            (Decimal(result.final_price_min_cents) * (Decimal("1") - commission["max"]))
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )
        # Payout max = final_max * (1 - commission_min)
        expected_payout_max = int(
            (Decimal(result.final_price_max_cents) * (Decimal("1") - commission["min"]))
            .quantize(Decimal("1"), rounding=ROUND_HALF_UP)
        )

        assert result.provider_payout_min_cents == expected_payout_min
        assert result.provider_payout_max_cents == expected_payout_max


# ---------------------------------------------------------------------------
# Multiplier cap enforcement
# ---------------------------------------------------------------------------


class TestMultiplierCapEnforcement:
    """Tests that stacked multipliers are capped at DYNAMIC_MULTIPLIER_MAX (5.0)."""

    @pytest.mark.asyncio
    async def test_multiplier_capped_at_max(self, mock_db, sample_task):
        """When night (1.5) + weather (2.0) + holiday (2.5) stack, the result
        should be capped at 5.0 instead of 7.5."""
        weather_mock = MagicMock()
        weather_mock.is_extreme = True
        weather_mock.condition = MagicMock()
        weather_mock.condition.value = "ice_storm"
        weather_mock.description = "Severe ice storm"

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine.get_weather_conditions",
            return_value=weather_mock,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=DEFAULT_COMMISSION[ProviderLevel.LEVEL_1],
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                requested_date=date(2025, 12, 25),  # Christmas = 2.5x
                requested_time=time(23, 0),  # Night = 1.5x
                is_emergency=True,
            )

        # 1.5 * 2.0 * 2.5 = 7.5, but cap at 5.0
        assert result.dynamic_multiplier == DYNAMIC_MULTIPLIER_MAX
        assert result.dynamic_multiplier <= Decimal("5.0")


# ---------------------------------------------------------------------------
# Zero/negative price protection
# ---------------------------------------------------------------------------


class TestZeroNegativePriceProtection:
    """Tests that pricing never produces zero or negative prices."""

    @pytest.mark.asyncio
    async def test_non_emergency_with_zero_base_raises(self, mock_db):
        """A task with no pricing configured should raise ValueError."""
        task = MagicMock()
        task.id = uuid.uuid4()
        task.name = "Unpriceable Task"
        task.base_price_min_cents = None
        task.base_price_max_cents = None
        task.level = ProviderLevel.LEVEL_1

        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=task,
        ):
            with pytest.raises(ValueError, match="no base pricing configured"):
                await calculate_price(
                    mock_db,
                    task_id=task.id,
                    latitude=Decimal("43.65"),
                    longitude=Decimal("-79.38"),
                )

    @pytest.mark.asyncio
    async def test_non_emergency_multiplier_stays_at_one(self, mock_db, sample_task):
        """Non-emergency requests should always have a 1.0x multiplier,
        ensuring the price is never inflated without an emergency flag."""
        with patch(
            "src.services.pricingEngine._get_service_task",
            return_value=sample_task,
        ), patch(
            "src.services.pricingEngine._get_active_pricing_rules",
            return_value=[],
        ), patch(
            "src.services.pricingEngine._get_commission_rates",
            return_value=DEFAULT_COMMISSION[ProviderLevel.LEVEL_1],
        ):
            result = await calculate_price(
                mock_db,
                task_id=sample_task.id,
                latitude=Decimal("43.65"),
                longitude=Decimal("-79.38"),
                requested_date=date(2025, 12, 25),  # Holiday
                requested_time=time(23, 0),  # Night
                is_emergency=False,  # NOT emergency
            )

        # Should stay at 1.0 even on a holiday night
        assert result.dynamic_multiplier == Decimal("1.0")
        assert result.final_price_min_cents > 0
        assert result.final_price_max_cents > 0
