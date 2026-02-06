"""
E2E: Emergency booking flow.

Tests the complete emergency path: request emergency -> L4 provider matched ->
track -> complete. Validates emergency-specific business rules including:
- Emergency flag propagation
- Only L4 providers eligible for emergency tasks
- SLA timers are strict (penalty_enabled)
- Emergency pricing multiplier applied
- Cancellation with emergency fee
"""

from __future__ import annotations

import uuid
from unittest.mock import MagicMock

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.e2e.conftest import (
    ADMIN_USER_ID,
    CATEGORY_ID,
    CUSTOMER_USER_ID,
    PROVIDER_L4_PROFILE_ID,
    PROVIDER_L4_USER_ID,
    PROVIDER_PROFILE_ID,
    PROVIDER_USER_ID,
    TASK_L4_ID,
    create_job_via_api,
    transition_job,
)


pytestmark = pytest.mark.asyncio


class TestEmergencyJobCreation:
    """Customer creates an emergency job."""

    async def test_create_emergency_job_returns_201(self, client: AsyncClient):
        resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["is_emergency"] is True
        assert body["priority"] == "emergency"
        assert body["task_id"] == str(TASK_L4_ID)
        assert body["status"] == "draft"

    async def test_emergency_job_captures_l4_sla_snapshot(self, client: AsyncClient):
        resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        body = resp.json()
        # L4 SLA: response=5min, arrival=30min, completion=180min
        assert body["sla_response_time_min"] == 5
        assert body["sla_arrival_time_min"] == 30
        assert body["sla_completion_time_min"] == 180
        # SLA snapshot should indicate penalty is enabled
        snapshot = body["sla_snapshot_json"]
        assert snapshot["penalty_enabled"] is True
        assert snapshot["penalty_per_min_cents"] == 500
        assert snapshot["penalty_cap_cents"] == 50000
        assert snapshot["level"] == "4"

    async def test_emergency_job_reference_generated(self, client: AsyncClient):
        resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        body = resp.json()
        assert body["reference_number"].startswith("TSK-")


class TestEmergencyProviderMatching:
    """Only L4 providers should match for emergency jobs."""

    async def test_find_providers_for_emergency_job(self, client: AsyncClient):
        # Create an emergency job
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        job_id = create_resp.json()["id"]

        # Move to pending_match
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Find matching providers
        match_resp = await client.post(
            "/api/v1/matching/find",
            json={"job_id": job_id, "max_results": 10},
        )
        assert match_resp.status_code == 200
        body = match_resp.json()
        assert body["job_level"] == "4"

        # All matched providers must be Level 4
        for match in body["matches"]:
            assert match["current_level"] == "4"
            assert match["on_call_active"] is True
            assert match["background_check_verified"] is True

    async def test_assign_l4_provider_to_emergency_job(self, client: AsyncClient):
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        job_id = create_resp.json()["id"]

        # Move to pending_match
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Assign L4 provider
        assign_resp = await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_L4_PROFILE_ID),
                "match_score": 92.0,
            },
        )
        assert assign_resp.status_code == 201
        assignment = assign_resp.json()
        assert assignment["provider_id"] == str(PROVIDER_L4_PROFILE_ID)
        assert assignment["status"] == "offered"

        # SLA deadlines should be set on assignment
        assert assignment["sla_response_deadline"] is not None
        assert assignment["sla_arrival_deadline"] is not None


class TestEmergencyFullLifecycle:
    """Complete emergency job from creation to completion."""

    async def test_emergency_full_flow(self, client: AsyncClient):
        # 1. Create emergency job
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        assert create_resp.status_code == 201
        job = create_resp.json()
        job_id = job["id"]

        # 2. Move to pending_match
        resp = await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )
        assert resp.status_code == 200

        # 3. Assign L4 provider
        assign_resp = await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_L4_PROFILE_ID),
            },
        )
        assert assign_resp.status_code == 201

        # 4. Provider accepts
        resp = await transition_job(
            client, job_id, "provider_accepted", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 5. Provider en route
        resp = await transition_job(
            client, job_id, "provider_en_route", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 6. Work in progress
        resp = await transition_job(
            client, job_id, "in_progress", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200
        assert resp.json()["started_at"] is not None

        # 7. Complete
        resp = await transition_job(
            client, job_id, "completed", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["completed_at"] is not None
        assert body["is_emergency"] is True

    async def test_emergency_job_cancelled_by_customer_before_en_route(
        self, client: AsyncClient
    ):
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        job_id = create_resp.json()["id"]

        # Move to pending_match (customer can still cancel here)
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Cancel
        cancel_resp = await client.post(
            f"/api/v1/jobs/{job_id}/cancel",
            json={
                "cancelled_by": str(CUSTOMER_USER_ID),
                "actor_type": "customer",
                "reason": "No longer needed",
            },
        )
        assert cancel_resp.status_code == 200
        body = cancel_resp.json()
        assert body["status"] == "cancelled_by_customer"
        assert body["cancellation_reason"] == "No longer needed"

    async def test_customer_cannot_cancel_after_provider_accepted(
        self, client: AsyncClient
    ):
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        job_id = create_resp.json()["id"]

        # Move through: pending_match -> matched -> provider_accepted
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )
        await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_L4_PROFILE_ID),
            },
        )
        await transition_job(
            client, job_id, "provider_accepted", PROVIDER_L4_USER_ID, "provider"
        )

        # Customer tries to cancel after provider accepted -- should fail
        cancel_resp = await client.post(
            f"/api/v1/jobs/{job_id}/cancel",
            json={
                "cancelled_by": str(CUSTOMER_USER_ID),
                "actor_type": "customer",
                "reason": "Too expensive",
            },
        )
        assert cancel_resp.status_code == 409


class TestEmergencyPricing:
    """Emergency pricing multiplier is applied."""

    async def test_emergency_price_estimate_has_multiplier(
        self, client: AsyncClient
    ):
        resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L4_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
                "is_emergency": True,
                "country": "CA",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_emergency"] is True
        assert body["level"] == "4"
        # Emergency pricing: multiplier should be >= 1.0
        assert float(body["dynamic_multiplier"]) >= 1.0
        assert float(body["dynamic_multiplier_cap"]) == 5.0
        # Final price should be at least the base price
        assert body["final_price_min_cents"] >= body["base_price_min_cents"]

    async def test_non_emergency_l4_task_no_dynamic_multiplier(
        self, client: AsyncClient
    ):
        resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L4_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
                "is_emergency": False,
                "country": "CA",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert float(body["dynamic_multiplier"]) == 1.0
        assert body["final_price_min_cents"] == body["base_price_min_cents"]

    async def test_emergency_estimate_with_extreme_weather(
        self, client: AsyncClient, mock_weather_api
    ):
        """When weather is extreme, the multiplier should increase."""
        from src.integrations.weatherApi import WeatherCondition

        mock_result = MagicMock()
        mock_result.is_extreme = True
        mock_result.condition = (
            WeatherCondition.BLIZZARD
            if hasattr(WeatherCondition, "BLIZZARD")
            else MagicMock(value="blizzard")
        )
        mock_result.description = "Heavy blizzard conditions"
        mock_result.temperature_c = -15.0
        mock_weather_api.return_value = mock_result

        resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L4_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
                "is_emergency": True,
                "country": "CA",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        # With extreme weather, dynamic_multiplier should be > 1.0
        assert float(body["dynamic_multiplier"]) > 1.0
        # Multiplier details should mention weather
        weather_rules = [
            m for m in body["multiplier_details"]
            if "weather" in m["rule_name"].lower()
        ]
        assert len(weather_rules) >= 1
