"""
E2E: Complete customer booking flow.

Tests the full journey: browse categories -> select task -> create job ->
get matched -> track status transitions -> complete -> review.
"""

from __future__ import annotations

import uuid

import pytest
import pytest_asyncio
from httpx import AsyncClient

from tests.e2e.conftest import (
    CATEGORY_ID,
    CUSTOMER_USER_ID,
    PROVIDER_PROFILE_ID,
    PROVIDER_USER_ID,
    TASK_L1_ID,
    create_job_via_api,
    transition_job,
)


pytestmark = pytest.mark.asyncio


class TestBrowseCatalog:
    """Customer browses the service catalog."""

    async def test_list_categories_returns_200(self, client: AsyncClient):
        resp = await client.get("/api/v1/categories")
        assert resp.status_code == 200
        body = resp.json()
        assert "data" in body
        assert "meta" in body
        assert body["meta"]["total_items"] >= 1

    async def test_list_categories_contains_seeded_category(self, client: AsyncClient):
        resp = await client.get("/api/v1/categories")
        body = resp.json()
        slugs = [cat["slug"] for cat in body["data"]]
        assert "home-maintenance" in slugs

    async def test_list_category_tasks_returns_tasks(self, client: AsyncClient):
        resp = await client.get(f"/api/v1/categories/{CATEGORY_ID}/tasks")
        assert resp.status_code == 200
        body = resp.json()
        assert body["meta"]["total_items"] >= 1
        task_names = [t["name"] for t in body["data"]]
        assert "Basic Cleaning" in task_names

    async def test_list_category_tasks_filter_by_level(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/categories/{CATEGORY_ID}/tasks", params={"level": "1"}
        )
        assert resp.status_code == 200
        body = resp.json()
        for task in body["data"]:
            assert task["level"] == "1"

    async def test_category_not_found_returns_404(self, client: AsyncClient):
        fake_id = uuid.uuid4()
        resp = await client.get(f"/api/v1/categories/{fake_id}/tasks")
        assert resp.status_code == 404

    async def test_get_task_detail(self, client: AsyncClient):
        resp = await client.get(f"/api/v1/tasks/{TASK_L1_ID}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == str(TASK_L1_ID)
        assert body["name"] == "Basic Cleaning"
        assert body["level"] == "1"
        assert body["base_price_min_cents"] == 2500
        assert body["base_price_max_cents"] == 4500
        assert "category" in body

    async def test_search_tasks(self, client: AsyncClient):
        resp = await client.get("/api/v1/tasks/search", params={"q": "cleaning"})
        assert resp.status_code == 200
        body = resp.json()
        assert body["query"] == "cleaning"
        assert body["meta"]["total_items"] >= 1


class TestJobCreation:
    """Customer creates a job from the closed task catalog."""

    async def test_create_job_returns_201(self, client: AsyncClient):
        resp = await create_job_via_api(client)
        assert resp.status_code == 201
        body = resp.json()
        assert body["customer_id"] == str(CUSTOMER_USER_ID)
        assert body["task_id"] == str(TASK_L1_ID)
        assert body["status"] == "draft"
        assert body["is_emergency"] is False

    async def test_create_job_generates_reference_number(self, client: AsyncClient):
        resp = await create_job_via_api(client)
        body = resp.json()
        assert body["reference_number"].startswith("TSK-")
        assert len(body["reference_number"]) == 10  # TSK- + 6 chars

    async def test_create_job_captures_sla_snapshot(self, client: AsyncClient):
        resp = await create_job_via_api(client)
        body = resp.json()
        # SLA snapshot should be captured from the Level 1 Ontario profile
        assert body["sla_response_time_min"] == 30
        assert body["sla_arrival_time_min"] == 60
        assert body["sla_completion_time_min"] == 240
        assert body["sla_snapshot_json"] is not None
        snapshot = body["sla_snapshot_json"]
        assert snapshot["level"] == "1"
        assert snapshot["captured_at"] is not None

    async def test_create_job_stores_location(self, client: AsyncClient):
        resp = await create_job_via_api(client)
        body = resp.json()
        assert body["service_city"] == "Toronto"
        assert body["service_province_state"] == "ON"
        assert body["service_country"] == "CA"

    async def test_create_job_with_invalid_task_returns_404(self, client: AsyncClient):
        resp = await create_job_via_api(client, task_id=uuid.uuid4())
        assert resp.status_code == 404

    async def test_get_job_by_id(self, client: AsyncClient):
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        resp = await client.get(f"/api/v1/jobs/{job_id}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == job_id
        assert body["reference_number"].startswith("TSK-")

    async def test_list_customer_jobs(self, client: AsyncClient):
        await create_job_via_api(client)

        resp = await client.get(f"/api/v1/jobs/customer/{CUSTOMER_USER_ID}")
        assert resp.status_code == 200
        body = resp.json()
        assert body["meta"]["total_items"] >= 1
        assert all(
            j["customer_id"] == str(CUSTOMER_USER_ID) for j in body["data"]
        )


class TestJobStatusTransitions:
    """Customer booking: job moves through the complete lifecycle."""

    async def test_full_booking_lifecycle(self, client: AsyncClient):
        # Step 1: Create job (draft)
        create_resp = await create_job_via_api(client)
        assert create_resp.status_code == 201
        job = create_resp.json()
        job_id = job["id"]
        assert job["status"] == "draft"

        # Step 2: Move to pending_match
        resp = await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "pending_match"

        # Step 3: Assign provider (creates assignment, transitions to matched)
        assign_resp = await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_PROFILE_ID),
                "match_score": 85.5,
            },
        )
        assert assign_resp.status_code == 201
        assignment = assign_resp.json()
        assert assignment["status"] == "offered"
        assert assignment["job_id"] == job_id

        # Verify job is now matched
        job_resp = await client.get(f"/api/v1/jobs/{job_id}")
        assert job_resp.json()["status"] == "matched"

        # Step 4: Provider accepts
        resp = await transition_job(
            client, job_id, "provider_accepted", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "provider_accepted"

        # Step 5: Provider en route
        resp = await transition_job(
            client, job_id, "provider_en_route", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "provider_en_route"

        # Step 6: Work in progress
        resp = await transition_job(
            client, job_id, "in_progress", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "in_progress"
        assert body["started_at"] is not None

        # Step 7: Completed
        resp = await transition_job(
            client, job_id, "completed", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["completed_at"] is not None

    async def test_invalid_transition_returns_409(self, client: AsyncClient):
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        # Try to jump from draft directly to completed (invalid)
        resp = await transition_job(
            client, job_id, "completed", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 409

    async def test_customer_cancel_in_draft(self, client: AsyncClient):
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        resp = await client.post(
            f"/api/v1/jobs/{job_id}/cancel",
            json={
                "cancelled_by": str(CUSTOMER_USER_ID),
                "actor_type": "customer",
                "reason": "Changed my mind",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "cancelled_by_customer"
        assert body["cancellation_reason"] == "Changed my mind"
        assert body["cancelled_at"] is not None


class TestPriceEstimate:
    """Customer gets a price estimate before booking."""

    async def test_price_estimate_for_task(self, client: AsyncClient):
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
        assert body["task_id"] == str(TASK_L1_ID)
        assert body["task_name"] == "Basic Cleaning"
        assert body["level"] == "1"
        assert body["base_price_min_cents"] == 2500
        assert body["base_price_max_cents"] == 4500
        assert body["final_price_min_cents"] >= 2500
        assert body["final_price_max_cents"] >= body["final_price_min_cents"]
        assert body["currency"] == "CAD"
        # Non-emergency: multiplier should be 1.0
        assert float(body["dynamic_multiplier"]) == 1.0

    async def test_price_estimate_returns_commission_info(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L1_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
            },
        )
        body = resp.json()
        assert "commission_rate_min" in body
        assert "commission_rate_max" in body
        assert "provider_payout_min_cents" in body
        assert "provider_payout_max_cents" in body
        # Payout should be less than final price (commission deducted)
        assert body["provider_payout_max_cents"] <= body["final_price_max_cents"]

    async def test_price_estimate_nonexistent_task_returns_404(
        self, client: AsyncClient
    ):
        resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(uuid.uuid4()),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
            },
        )
        assert resp.status_code == 404
