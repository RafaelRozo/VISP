"""
E2E: Provider lifecycle flow.

Tests the complete provider journey: verification -> credential submission ->
admin approval -> receive job offers -> accept -> work -> complete -> scoring.

Validates provider-specific business rules including:
- Background check submission and admin approval
- License credential submission and admin approval
- Insurance policy submission
- Verification status aggregation
- Receiving and accepting job assignments
- Job completion from provider perspective
- Provider scoring and admin adjustments
- Provider job listing
"""

from __future__ import annotations

import uuid
from datetime import date

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
    TASK_L1_ID,
    TASK_L4_ID,
    create_job_via_api,
    transition_job,
)


pytestmark = pytest.mark.asyncio


class TestProviderVerificationStatus:
    """Provider checks their verification status."""

    async def test_get_l1_provider_verification_status(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/verification/provider/{PROVIDER_PROFILE_ID}/status"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["provider_id"] == str(PROVIDER_PROFILE_ID)
        assert body["current_level"] == "1"
        assert body["profile_status"] == "active"
        # Background check should be valid (seeded as cleared with future expiry)
        assert body["background_check"]["status"] == "cleared"
        assert body["background_check"]["is_valid"] is True

    async def test_get_l4_provider_verification_status(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/verification/provider/{PROVIDER_L4_PROFILE_ID}/status"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["provider_id"] == str(PROVIDER_L4_PROFILE_ID)
        assert body["current_level"] == "4"
        assert body["profile_status"] == "active"
        # L4 provider has seeded credential and insurance
        assert len(body["credentials"]) >= 1
        assert len(body["insurance_policies"]) >= 1

    async def test_verification_status_for_nonexistent_provider_returns_404(
        self, client: AsyncClient
    ):
        fake_id = uuid.uuid4()
        resp = await client.get(
            f"/api/v1/verification/provider/{fake_id}/status"
        )
        assert resp.status_code == 404


class TestCredentialSubmission:
    """Provider submits credentials for admin review."""

    async def test_submit_license_credential(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/verification/license",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "credential_type": "license",
                "name": "Ontario General Contractor License",
                "issuing_authority": "Ontario College of Trades",
                "credential_number": "GC-12345",
                "jurisdiction": "ON",
                "jurisdiction_country": "CA",
                "issued_date": "2024-06-01",
                "expiry_date": "2027-06-01",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["credential_type"] == "license"
        assert body["name"] == "Ontario General Contractor License"
        assert body["status"] == "pending_review"
        assert "credential_id" in body

    async def test_submit_certification_credential(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/verification/license",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "credential_type": "certification",
                "name": "HVAC Technician Certification",
                "issuing_authority": "HRAI",
                "credential_number": "HVAC-9999",
                "jurisdiction": "ON",
                "jurisdiction_country": "CA",
                "issued_date": "2023-01-15",
                "expiry_date": "2026-01-15",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["credential_type"] == "certification"
        assert body["status"] == "pending_review"

    async def test_submit_insurance_policy(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/verification/insurance",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "policy_number": "INS-GL-001",
                "insurer_name": "Intact Insurance",
                "policy_type": "general_liability",
                "coverage_amount_cents": 200_000_000,
                "deductible_cents": 50000,
                "effective_date": "2025-01-01",
                "expiry_date": "2027-12-31",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["policy_number"] == "INS-GL-001"
        assert body["insurer_name"] == "Intact Insurance"
        assert body["coverage_amount_cents"] == 200_000_000
        assert body["status"] == "pending_review"

    async def test_submit_background_check(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/verification/background-check",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "check_type": "crc",
                "check_provider": "mycrc",
                "applicant_first_name": "John",
                "applicant_last_name": "Smith",
                "applicant_email": "provider@test.visp.ca",
                "date_of_birth": "1990-05-15",
                "address_line_1": "100 Queen St W",
                "city": "Toronto",
                "province": "ON",
                "postal_code": "M5H 2N2",
                "country": "CA",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["check_type"] == "crc"
        assert body["provider_name"] == "mycrc"
        assert body["status"] == "pending_review"
        assert "credential_id" in body
        assert "external_reference_id" in body

    async def test_submit_insurance_with_invalid_dates_returns_422(
        self, client: AsyncClient
    ):
        resp = await client.post(
            "/api/v1/verification/insurance",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "policy_number": "INS-BAD",
                "insurer_name": "Bad Insurance",
                "policy_type": "general_liability",
                "coverage_amount_cents": 100_000_000,
                "effective_date": "2027-01-01",
                "expiry_date": "2025-01-01",  # Before effective -- invalid
            },
        )
        assert resp.status_code == 422


class TestAdminCredentialReview:
    """Admin approves or rejects provider credentials."""

    async def test_admin_approve_credential(self, client: AsyncClient):
        # First submit a license credential
        submit_resp = await client.post(
            "/api/v1/verification/license",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "credential_type": "license",
                "name": "Test License for Approval",
                "issuing_authority": "Test Authority",
                "credential_number": "APPROVE-001",
                "jurisdiction": "ON",
                "jurisdiction_country": "CA",
                "issued_date": "2024-01-01",
                "expiry_date": "2028-01-01",
            },
        )
        assert submit_resp.status_code == 201
        credential_id = submit_resp.json()["credential_id"]

        # Admin approves
        approve_resp = await client.post(
            f"/api/v1/verification/admin/approve/{credential_id}",
            json={"admin_user_id": str(ADMIN_USER_ID)},
        )
        assert approve_resp.status_code == 200
        body = approve_resp.json()
        assert body["credential_id"] == credential_id
        assert body["action"] == "approved"
        assert body["new_status"] == "verified"
        assert body["performed_by"] == str(ADMIN_USER_ID)
        assert body["performed_at"] is not None

    async def test_admin_reject_credential(self, client: AsyncClient):
        # Submit a credential
        submit_resp = await client.post(
            "/api/v1/verification/license",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "credential_type": "license",
                "name": "Test License for Rejection",
                "issuing_authority": "Test Authority",
                "credential_number": "REJECT-001",
                "jurisdiction": "ON",
                "jurisdiction_country": "CA",
                "issued_date": "2024-01-01",
                "expiry_date": "2028-01-01",
            },
        )
        assert submit_resp.status_code == 201
        credential_id = submit_resp.json()["credential_id"]

        # Admin rejects
        reject_resp = await client.post(
            f"/api/v1/verification/admin/reject/{credential_id}",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "reason": "Document is illegible and cannot be verified",
            },
        )
        assert reject_resp.status_code == 200
        body = reject_resp.json()
        assert body["credential_id"] == credential_id
        assert body["action"] == "rejected"
        assert body["new_status"] == "rejected"

    async def test_reject_nonexistent_credential_returns_404(
        self, client: AsyncClient
    ):
        fake_id = uuid.uuid4()
        resp = await client.post(
            f"/api/v1/verification/admin/reject/{fake_id}",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "reason": "Does not exist",
            },
        )
        # Verification service raises ValueError("Credential not found: ..."),
        # which the route maps to 422 or 404 depending on message content
        assert resp.status_code in (404, 422)


class TestProviderJobFlow:
    """Provider receives a job offer, accepts, works, and completes."""

    async def test_provider_receives_offer_and_completes_job(
        self, client: AsyncClient
    ):
        # 1. Customer creates a job
        create_resp = await create_job_via_api(client)
        assert create_resp.status_code == 201
        job_id = create_resp.json()["id"]

        # 2. Move to pending_match
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # 3. Assign L1 provider
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
        assert assignment["status"] == "offered"
        assert assignment["provider_id"] == str(PROVIDER_PROFILE_ID)

        # 4. Provider accepts
        resp = await transition_job(
            client, job_id, "provider_accepted", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "provider_accepted"

        # 5. Provider en route
        resp = await transition_job(
            client, job_id, "provider_en_route", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        assert resp.json()["status"] == "provider_en_route"

        # 6. Provider starts work
        resp = await transition_job(
            client, job_id, "in_progress", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "in_progress"
        assert body["started_at"] is not None

        # 7. Provider completes
        resp = await transition_job(
            client, job_id, "completed", PROVIDER_USER_ID, "provider"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "completed"
        assert body["completed_at"] is not None

    async def test_provider_declines_job_offer(self, client: AsyncClient):
        # Create and move to pending_match
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Assign provider
        await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_PROFILE_ID),
            },
        )

        # Provider declines (cancel by provider)
        cancel_resp = await client.post(
            f"/api/v1/jobs/{job_id}/cancel",
            json={
                "cancelled_by": str(PROVIDER_USER_ID),
                "actor_type": "provider",
                "reason": "Not available at this time",
            },
        )
        assert cancel_resp.status_code == 200
        body = cancel_resp.json()
        assert body["status"] == "cancelled_by_provider"
        assert body["cancellation_reason"] == "Not available at this time"

    async def test_list_provider_jobs(self, client: AsyncClient):
        # Create a job and assign to provider
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )
        await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_PROFILE_ID),
            },
        )

        # List jobs for provider
        resp = await client.get(
            f"/api/v1/jobs/provider/{PROVIDER_PROFILE_ID}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert "data" in body
        assert "meta" in body
        assert body["meta"]["total_items"] >= 1


class TestProviderScoring:
    """Provider scoring retrieval and admin adjustments."""

    async def test_get_l1_provider_score(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/scoring/provider/{PROVIDER_PROFILE_ID}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["provider_id"] == str(PROVIDER_PROFILE_ID)
        assert body["current_level"] == "1"
        # L1 base score is 70, seeded internal_score is 70
        assert float(body["current_score"]) == 70.0
        assert float(body["base_score"]) == 70.0
        assert float(body["min_score"]) == 40.0
        assert float(body["max_score"]) == 90.0
        assert body["is_expelled"] is False
        assert isinstance(body["recent_penalties"], list)

    async def test_get_l4_provider_score(self, client: AsyncClient):
        resp = await client.get(
            f"/api/v1/scoring/provider/{PROVIDER_L4_PROFILE_ID}"
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["current_level"] == "4"
        # L4 base score is 85, seeded internal_score is 85
        assert float(body["current_score"]) == 85.0
        assert float(body["base_score"]) == 85.0
        assert float(body["min_score"]) == 70.0
        assert float(body["max_score"]) == 100.0

    async def test_admin_adjust_provider_score_upward(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/scoring/adjust",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "provider_id": str(PROVIDER_PROFILE_ID),
                "adjustment": 10,
                "reason": "Excellent customer feedback over 3 months",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["provider_id"] == str(PROVIDER_PROFILE_ID)
        assert float(body["adjustment"]) == 10.0
        # Score should increase (from 70 to 80, clamped at max 90)
        assert float(body["new_score"]) >= float(body["previous_score"])
        assert body["reason"] == "Excellent customer feedback over 3 months"
        assert body["adjusted_by"] == str(ADMIN_USER_ID)

    async def test_admin_adjust_score_downward(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/scoring/adjust",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "provider_id": str(PROVIDER_PROFILE_ID),
                "adjustment": -5,
                "reason": "Customer complaint investigation confirmed",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert float(body["adjustment"]) == -5.0
        assert float(body["new_score"]) <= float(body["previous_score"])

    async def test_admin_adjust_score_clamped_to_level_max(
        self, client: AsyncClient
    ):
        # Try to increase L1 provider score by 100 (max for L1 is 90)
        resp = await client.post(
            "/api/v1/scoring/adjust",
            json={
                "admin_user_id": str(ADMIN_USER_ID),
                "provider_id": str(PROVIDER_PROFILE_ID),
                "adjustment": 100,
                "reason": "Test clamping to max score",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        # L1 max is 90, so new score should not exceed 90
        assert float(body["new_score"]) <= 90.0

    async def test_scoring_for_nonexistent_provider_returns_404(
        self, client: AsyncClient
    ):
        fake_id = uuid.uuid4()
        resp = await client.get(f"/api/v1/scoring/provider/{fake_id}")
        assert resp.status_code == 404


class TestProviderMatchingPerspective:
    """Provider-facing matching tests: what jobs match this provider."""

    async def test_l1_provider_matches_l1_job(self, client: AsyncClient):
        # Create L1 job and move to pending_match
        create_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        job_id = create_resp.json()["id"]
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Find matching providers
        resp = await client.post(
            "/api/v1/matching/find",
            json={"job_id": job_id, "max_results": 10},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["job_level"] == "1"

        # L1 provider should appear in matches
        matched_provider_ids = [m["provider_id"] for m in body["matches"]]
        assert str(PROVIDER_PROFILE_ID) in matched_provider_ids

    async def test_l1_provider_does_not_match_l4_emergency_job(
        self, client: AsyncClient
    ):
        # Create L4 emergency job
        create_resp = await create_job_via_api(
            client, task_id=TASK_L4_ID, is_emergency=True, priority="emergency"
        )
        job_id = create_resp.json()["id"]
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )

        # Find matching providers
        resp = await client.post(
            "/api/v1/matching/find",
            json={"job_id": job_id, "max_results": 10},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["job_level"] == "4"

        # L1 provider should NOT appear in L4 matches
        matched_provider_ids = [m["provider_id"] for m in body["matches"]]
        assert str(PROVIDER_PROFILE_ID) not in matched_provider_ids

    async def test_reassign_job_to_different_provider(self, client: AsyncClient):
        # Create and assign job to L1 provider
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]
        await transition_job(
            client, job_id, "pending_match", CUSTOMER_USER_ID, "customer"
        )
        await client.post(
            "/api/v1/matching/assign",
            json={
                "job_id": job_id,
                "provider_id": str(PROVIDER_PROFILE_ID),
            },
        )

        # Reassign to L4 provider (who also qualifies for L1 work)
        reassign_resp = await client.post(
            "/api/v1/matching/reassign",
            json={
                "job_id": job_id,
                "new_provider_id": str(PROVIDER_L4_PROFILE_ID),
                "reason": "Original provider unavailable",
            },
        )
        assert reassign_resp.status_code in (200, 201)
        body = reassign_resp.json()
        assert body["provider_id"] == str(PROVIDER_L4_PROFILE_ID)
