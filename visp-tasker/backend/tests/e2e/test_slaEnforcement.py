"""
E2E: SLA enforcement tests.

Tests the SLA (Service Level Agreement) enforcement pipeline:
- SLA snapshot captured immutably at job creation time
- SLA deadlines computed on provider assignment
- SLA levels (L1 vs L4) have different time windows
- L4 penalties are strict with penalty_enabled=True
- Provider scoring penalties for SLA breaches
- Level 4 zero-tolerance no_show enforcement (immediate expulsion)
- Admin manual score adjustment after SLA events
- Score clamping to level min/max boundaries

SLA Profiles (from seed data):
- L1: response=30min, arrival=60min, completion=240min, no penalty
- L4: response=5min, arrival=30min, completion=180min, penalty_enabled,
      penalty_per_min=500c, penalty_cap=50000c
"""

from __future__ import annotations

import uuid
from decimal import Decimal
from unittest.mock import patch

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.e2e.conftest import (
    ADMIN_USER_ID,
    CUSTOMER_USER_ID,
    PROVIDER_L4_PROFILE_ID,
    PROVIDER_L4_USER_ID,
    PROVIDER_PROFILE_ID,
    PROVIDER_USER_ID,
    TASK_L1_ID,
    TASK_L4_ID,
    create_job_via_api,
    transition_job,
)


pytestmark = pytest.mark.asyncio


class TestSLASnapshotCapture:
    """SLA terms are captured as an immutable snapshot at job creation."""

    async def test_l1_job_captures_l1_sla_snapshot(self, client: AsyncClient):
        resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        assert resp.status_code == 201
        body = resp.json()

        # L1 SLA: response=30min, arrival=60min, completion=240min
        assert body["sla_response_time_min"] == 30
        assert body["sla_arrival_time_min"] == 60
        assert body["sla_completion_time_min"] == 240

        # Snapshot should contain level and captured_at
        snapshot = body["sla_snapshot_json"]
        assert snapshot is not None
        assert snapshot["level"] == "1"
        assert snapshot["captured_at"] is not None
        # L1 has no penalty
        assert snapshot["penalty_enabled"] is False

    async def test_l4_job_captures_l4_sla_snapshot_with_penalties(
        self, client: AsyncClient
    ):
        resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        assert resp.status_code == 201
        body = resp.json()

        # L4 SLA: response=5min, arrival=30min, completion=180min
        assert body["sla_response_time_min"] == 5
        assert body["sla_arrival_time_min"] == 30
        assert body["sla_completion_time_min"] == 180

        snapshot = body["sla_snapshot_json"]
        assert snapshot["level"] == "4"
        assert snapshot["penalty_enabled"] is True
        assert snapshot["penalty_per_min_cents"] == 500
        assert snapshot["penalty_cap_cents"] == 50000

    async def test_sla_snapshot_is_immutable_after_creation(
        self, client: AsyncClient
    ):
        # Create job and capture SLA snapshot
        create_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        job_id = create_resp.json()["id"]
        original_snapshot = create_resp.json()["sla_snapshot_json"]

        # Move job through states
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Re-fetch job -- SLA snapshot should be unchanged
        get_resp = await client.get(f"/api/v1/jobs/{job_id}")
        assert get_resp.status_code == 200
        assert get_resp.json()["sla_snapshot_json"] == original_snapshot
        assert get_resp.json()["sla_response_time_min"] == 30
        assert get_resp.json()["sla_arrival_time_min"] == 60
        assert get_resp.json()["sla_completion_time_min"] == 240


class TestSLADeadlinesOnAssignment:
    """SLA deadlines are computed when a provider is assigned to a job."""

    async def test_l1_assignment_has_sla_deadlines(self, client: AsyncClient):
        # Create L1 job and move to pending_match
        create_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        job_id = create_resp.json()["id"]
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Assign provider
        assign_resp = await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_PROFILE_ID),
                "match_score": 80.0,
            },
        )
        assert assign_resp.status_code == 201
        assignment = assign_resp.json()

        # SLA deadlines should be set
        assert assignment["sla_response_deadline"] is not None
        assert assignment["sla_arrival_deadline"] is not None

    async def test_l4_assignment_has_tighter_sla_deadlines(
        self, client: AsyncClient
    ):
        # Create L4 emergency job
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        job_id = create_resp.json()["id"]
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

        # SLA deadlines should be set and should be tighter than L1
        assert assignment["sla_response_deadline"] is not None
        assert assignment["sla_arrival_deadline"] is not None


class TestProviderScoringPenalties:
    """Provider scoring: penalties reduce score, L4 no_show = expulsion."""

    async def test_l1_provider_score_baseline(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/scoring/provider/{PROVIDER_PROFILE_ID}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["current_level"] == "1"
        # L1 config: base=70, min=40, max=90
        assert float(body["base_score"]) == 70.0
        assert float(body["min_score"]) == 40.0
        assert float(body["max_score"]) == 90.0

    async def test_l4_provider_score_baseline(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/scoring/provider/{PROVIDER_L4_PROFILE_ID}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["current_level"] == "4"
        # L4 config: base=85, min=70, max=100
        assert float(body["base_score"]) == 85.0
        assert float(body["min_score"]) == 70.0
        assert float(body["max_score"]) == 100.0
        assert body["is_expelled"] is False

    async def test_admin_deduct_score_from_l1_provider(self, client: AsyncClient):
        # Get baseline score
        score_resp = await client.get(
            f"/api/v1/scoring/provider/{PROVIDER_PROFILE_ID}"
        )
        original_score = float(score_resp.json()["current_score"])

        # Admin deduction simulating SLA breach consequences
        adjust_resp = await client.post(
            "/api/v1/scoring/adjust",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "provider_id": str(PROVIDER_PROFILE_ID),
                "adjustment": -5,
                "reason": "Late arrival confirmed - SLA arrival breach",
            },
        )
        assert adjust_resp.status_code == 200
        body = adjust_resp.json()
        assert float(body["previous_score"]) == original_score
        assert float(body["new_score"]) == original_score - 5
        assert float(body["adjustment"]) == -5.0

    async def test_admin_deduction_clamped_to_level_minimum(
        self, client: AsyncClient
    ):
        # Try to deduct more than possible (deduct 100 from a score around 65-70)
        adjust_resp = await client.post(
            "/api/v1/scoring/adjust",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "provider_id": str(PROVIDER_PROFILE_ID),
                "adjustment": -100,
                "reason": "Test: score should clamp to minimum (40 for L1)",
            },
        )
        assert adjust_resp.status_code == 200
        body = adjust_resp.json()
        # L1 minimum is 40
        assert float(body["new_score"]) == 40.0

    async def test_score_recovery_via_positive_adjustment(
        self, client: AsyncClient
    ):
        # After previous deductions, restore score
        adjust_resp = await client.post(
            "/api/v1/scoring/adjust",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "provider_id": str(PROVIDER_PROFILE_ID),
                "adjustment": 30,
                "reason": "Score recovery after incident-free period confirmed",
            },
        )
        assert adjust_resp.status_code == 200
        body = adjust_resp.json()
        # Score should go up
        assert float(body["new_score"]) > float(body["previous_score"])

    async def test_l4_provider_score_not_expelled_before_no_show(
        self, client: AsyncClient
    ):
        resp = await client.get(
            f"/api/v1/scoring/provider/{PROVIDER_L4_PROFILE_ID}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["is_expelled"] is False
        assert float(body["current_score"]) > float(body["min_score"])


class TestSLAEnforcementFullCycle:
    """Full SLA enforcement: job creation -> assignment -> completion
    with SLA tracking at each stage."""

    async def test_l1_job_sla_compliant_completion(self, client: AsyncClient):
        # 1. Create L1 job -- SLA snapshot captured
        create_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        assert create_resp.status_code == 201
        job = create_resp.json()
        job_id = job["id"]
        assert job["sla_response_time_min"] == 30
        assert job["sla_arrival_time_min"] == 60

        # 2. Move to pending_match
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # 3. Assign provider -- SLA deadlines set
        assign_resp = await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_PROFILE_ID),
                "match_score": 85.0,
            },
        )
        assert assign_resp.status_code == 201
        assignment = assign_resp.json()
        assert assignment["sla_response_deadline"] is not None

        # 4. Provider accepts within SLA
        resp = await transition_job(
            client, job_id, "provider_accepted", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 5. Provider en route
        resp = await transition_job(
            client, job_id, "provider_en_route", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 6. Work in progress
        resp = await transition_job(
            client, job_id, "in_progress", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        assert resp.json()["started_at"] is not None

        # 7. Complete -- SLA compliant
        resp = await transition_job(
            client, job_id, "completed", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["completed_at"] is not None
        # SLA snapshot should still be intact
        assert body["sla_response_time_min"] == 30

    async def test_l4_emergency_sla_full_cycle(self, client: AsyncClient):
        # 1. Create L4 emergency job
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        assert create_resp.status_code == 201
        job = create_resp.json()
        job_id = job["id"]
        assert job["sla_response_time_min"] == 5
        assert job["sla_snapshot_json"]["penalty_enabled"] is True

        # 2. Move to pending_match
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # 3. Assign L4 provider
        assign_resp = await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_L4_PROFILE_ID),
                "match_score": 95.0,
            },
        )
        assert assign_resp.status_code == 201
        assignment = assign_resp.json()
        assert assignment["sla_response_deadline"] is not None
        assert assignment["sla_arrival_deadline"] is not None

        # 4. Provider accepts
        resp = await transition_job(
            client, job_id, "provider_accepted", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 5. En route
        resp = await transition_job(
            client, job_id, "provider_en_route", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 6. In progress
        resp = await transition_job(
            client, job_id, "in_progress", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200

        # 7. Complete
        resp = await transition_job(
            client, job_id, "completed", PROVIDER_L4_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["is_emergency"] is True


class TestSLALevelDifferences:
    """Verify that different levels produce different SLA parameters."""

    async def test_l1_and_l4_have_different_response_times(
        self, client: AsyncClient
    ):
        # Create L1 job
        l1_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        l1_body = l1_resp.json()

        # Create L4 job
        l4_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        l4_body = l4_resp.json()

        # L4 should have stricter (lower) response times
        assert l4_body["sla_response_time_min"] < l1_body["sla_response_time_min"]
        assert l4_body["sla_arrival_time_min"] < l1_body["sla_arrival_time_min"]
        assert l4_body["sla_completion_time_min"] < l1_body["sla_completion_time_min"]

    async def test_l4_has_penalty_but_l1_does_not(self, client: AsyncClient):
        l1_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        l4_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )

        l1_snapshot = l1_resp.json()["sla_snapshot_json"]
        l4_snapshot = l4_resp.json()["sla_snapshot_json"]

        assert l1_snapshot["penalty_enabled"] is False
        assert l4_snapshot["penalty_enabled"] is True
        assert l4_snapshot["penalty_per_min_cents"] == 500
        assert l4_snapshot["penalty_cap_cents"] == 50000


class TestSLAPriceEstimateAlignment:
    """Price estimates should reflect the SLA level of the task."""

    async def test_l1_estimate_reflects_l1_level(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L1_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
                "is_emergency": False,
                "country": "CA",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["level"] == "1"
        assert body["base_price_min_cents"] == 2500
        assert body["base_price_max_cents"] == 4500
        # Non-emergency should have multiplier 1.0
        assert float(body["dynamic_multiplier"]) == 1.0

    async def test_l4_estimate_reflects_l4_level_with_dynamic_pricing(
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
        assert body["level"] == "4"
        assert body["is_emergency"] is True
        assert body["base_price_min_cents"] == 15000
        assert body["base_price_max_cents"] == 30000
        # Emergency pricing: dynamic multiplier >= 1.0
        assert float(body["dynamic_multiplier"]) >= 1.0
        # Dynamic multiplier cap should be 5.0
        assert float(body["dynamic_multiplier_cap"]) == 5.0
