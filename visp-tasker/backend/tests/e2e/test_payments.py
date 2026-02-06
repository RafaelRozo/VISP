"""
E2E: Payment flow tests.

Tests the complete payment lifecycle with Stripe mocked at the SDK level:
- Payment intent creation for a job
- Payment confirmation (server-side)
- Payment cancellation
- Full and partial refunds
- Payment method listing and attachment
- Stripe Connect account creation for providers
- Provider onboarding link generation
- Connect account status checks
- Provider balance queries
- Provider payout listing
- Stripe webhook processing

All Stripe SDK calls are mocked in the conftest (mock_stripe, mock_stripe_payout,
mock_webhook_handler fixtures). The full route -> service -> mock flow is exercised.
"""

from __future__ import annotations

import uuid

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


class TestPaymentIntentLifecycle:
    """Customer creates, confirms, and cancels payment intents."""

    async def test_create_payment_intent_returns_201(self, client: AsyncClient):
        # First create a job to reference
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        resp = await client.post(
            "/api/v1/payments/create-intent",
            json={
                "job_id": job_id,
                "amount_cents": 3500,
                "currency": "cad",
                "customer_stripe_id": "cus_test_abc",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["id"] == "pi_test_123456"
        assert "client_secret" in body
        assert body["status"] == "requires_payment_method"
        assert body["amount_cents"] == 5000  # From mock
        assert body["currency"] == "cad"

    async def test_create_payment_intent_without_customer_id(
        self, client: AsyncClient
    ):
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        resp = await client.post(
            "/api/v1/payments/create-intent",
            json={
                "job_id": job_id,
                "amount_cents": 5000,
                "currency": "cad",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["id"] == "pi_test_123456"

    async def test_create_payment_intent_invalid_amount_returns_422(
        self, client: AsyncClient
    ):
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        resp = await client.post(
            "/api/v1/payments/create-intent",
            json={
                "job_id": job_id,
                "amount_cents": 0,  # Invalid: must be > 0
                "currency": "cad",
            },
        )
        assert resp.status_code == 422

    async def test_confirm_payment_intent(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/confirm/pi_test_123456",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "pi_test_123456"
        assert body["status"] == "succeeded"
        assert body["amount_cents"] == 5000
        assert body["currency"] == "cad"
        assert body["payment_method_id"] == "pm_test_card"

    async def test_cancel_payment_intent(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/cancel/pi_test_123456",
            json={"reason": "requested_by_customer"},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["cancelled"] is True
        assert body["payment_intent_id"] == "pi_test_123456"

    async def test_cancel_payment_without_body(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/cancel/pi_test_123456",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["cancelled"] is True


class TestRefunds:
    """Refund processing: full and partial."""

    async def test_full_refund(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/refund/pi_test_123456",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "re_test_789"
        assert body["status"] == "succeeded"
        assert body["amount_cents"] == 5000

    async def test_partial_refund(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/refund/pi_test_123456",
            json={
                "amount_cents": 2000,
                "reason": "Customer dissatisfied with partial service",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["id"] == "re_test_789"
        assert body["status"] == "succeeded"

    async def test_refund_with_reason(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/refund/pi_test_123456",
            json={
                "reason": "Service not completed as described",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["status"] == "succeeded"


class TestPaymentMethods:
    """Customer payment method management."""

    async def test_list_payment_methods(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/payments/methods/cus_test_abc",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert len(body["methods"]) == 1

        method = body["methods"][0]
        assert method["id"] == "pm_test_card"
        assert method["type"] == "card"
        assert method["last4"] == "4242"
        assert method["brand"] == "visa"
        assert method["exp_month"] == 12
        assert method["exp_year"] == 2027

    async def test_attach_payment_method(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/methods/attach",
            json={
                "customer_id": "cus_test_abc",
                "payment_method_id": "pm_test_new_card",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["attached"] is True
        assert body["customer_id"] == "cus_test_abc"
        assert body["payment_method_id"] == "pm_test_new_card"


class TestStripeConnectAccounts:
    """Provider Stripe Connect account operations."""

    async def test_create_connected_account(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/connect/create",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "email": "provider@test.visp.ca",
                "country": "CA",
            },
        )
        assert resp.status_code == 201
        body = resp.json()
        assert body["account_id"] == "acct_test_new"
        assert isinstance(body["onboarding_complete"], bool)
        assert isinstance(body["details_submitted"], bool)

    async def test_create_onboarding_link(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/connect/onboard-link",
            json={
                "account_id": "acct_test_l1",
                "refresh_url": "https://tasker.visp.ca/onboard/refresh",
                "return_url": "https://tasker.visp.ca/onboard/return",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["url"] == "https://connect.stripe.com/setup/test"
        assert body["account_id"] == "acct_test_l1"

    async def test_check_account_status(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/payments/connect/status/acct_test_l1",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["account_id"] == "acct_test_l1"
        assert body["charges_enabled"] is True
        assert body["payouts_enabled"] is True
        assert body["requirements_due"] == []


class TestProviderBalanceAndPayouts:
    """Provider balance queries and payout listing."""

    async def test_get_provider_balance(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/payments/balance/acct_test_l1",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["available_cents"] == 150000
        assert body["pending_cents"] == 25000
        assert body["currency"] == "cad"

    async def test_get_l4_provider_balance(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/payments/balance/acct_test_l4",
        )
        assert resp.status_code == 200
        body = resp.json()
        # Mock returns the same balance for all accounts
        assert body["available_cents"] == 150000
        assert body["pending_cents"] == 25000

    async def test_list_provider_payouts(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/payments/payouts/acct_test_l1",
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] == 1
        assert len(body["payouts"]) == 1

        payout = body["payouts"][0]
        assert payout["id"] == "po_test_001"
        assert payout["status"] == "paid"
        assert payout["amount_cents"] == 100000
        assert payout["currency"] == "cad"

    async def test_list_payouts_with_limit(self, client: AsyncClient):
        resp = await client.get(
            "/api/v1/payments/payouts/acct_test_l1",
            params={"limit": 5},
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["count"] >= 0


class TestStripeWebhook:
    """Stripe webhook endpoint processing."""

    async def test_webhook_with_valid_signature(self, client: AsyncClient):
        resp = await client.post(
            "/api/v1/payments/webhook",
            content=b'{"type": "payment_intent.succeeded", "data": {}}',
            headers={
                "Stripe-Signature": "t=1234567890,v1=fake_sig",
                "Content-Type": "application/json",
            },
        )
        assert resp.status_code == 200
        body = resp.json()
        assert body["event_type"] == "payment_intent.succeeded"
        assert body["processed"] is True
        assert body["message"] == "Payment processed successfully"

    async def test_webhook_missing_signature_returns_400(
        self, client: AsyncClient
    ):
        resp = await client.post(
            "/api/v1/payments/webhook",
            content=b'{"type": "payment_intent.succeeded"}',
            headers={"Content-Type": "application/json"},
        )
        assert resp.status_code == 400


class TestPaymentJobIntegration:
    """End-to-end: job creation -> payment -> completion."""

    async def test_full_payment_flow_for_l1_job(self, client: AsyncClient):
        # 1. Create job
        create_resp = await create_job_via_api(client, task_id=TASK_L1_ID)
        assert create_resp.status_code == 201
        job = create_resp.json()
        job_id = job["id"]

        # 2. Get price estimate
        estimate_resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L1_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
                "is_emergency": False,
                "country": "CA",
            },
        )
        assert estimate_resp.status_code == 200
        estimate = estimate_resp.json()
        price_cents = estimate["final_price_min_cents"]

        # 3. Create payment intent
        intent_resp = await client.post(
            "/api/v1/payments/create-intent",
            json={
                "job_id": job_id,
                "amount_cents": price_cents,
                "currency": "cad",
                "customer_stripe_id": "cus_test_abc",
            },
        )
        assert intent_resp.status_code == 201
        intent = intent_resp.json()
        payment_intent_id = intent["id"]

        # 4. Confirm payment
        confirm_resp = await client.post(
            f"/api/v1/payments/confirm/{payment_intent_id}",
        )
        assert confirm_resp.status_code == 200
        assert confirm_resp.json()["status"] == "succeeded"

        # 5. Move job through lifecycle
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
        await transition_job(
            client, job_id, "provider_accepted", PROVIDER_USER_ID, "provider"
        )
        await transition_job(
            client, job_id, "provider_en_route", PROVIDER_USER_ID, "provider"
        )
        await transition_job(
            client, job_id, "in_progress", PROVIDER_USER_ID, "provider"
        )
        complete_resp = await transition_job(
            client, job_id, "completed", PROVIDER_USER_ID, "provider"
        )
        assert complete_resp.status_code == 200
        assert complete_resp.json()["status"] == "completed"

    async def test_payment_and_refund_flow_for_cancelled_job(
        self, client: AsyncClient
    ):
        # 1. Create job
        create_resp = await create_job_via_api(client)
        job_id = create_resp.json()["id"]

        # 2. Create payment intent
        intent_resp = await client.post(
            "/api/v1/payments/create-intent",
            json={
                "job_id": job_id,
                "amount_cents": 3500,
                "currency": "cad",
            },
        )
        assert intent_resp.status_code == 201
        payment_intent_id = intent_resp.json()["id"]

        # 3. Confirm payment
        confirm_resp = await client.post(
            f"/api/v1/payments/confirm/{payment_intent_id}",
        )
        assert confirm_resp.status_code == 200

        # 4. Customer cancels job
        cancel_resp = await client.post(
            f"/api/v1/jobs/{job_id}/cancel",
            json={
                "cancelled_by": str(CUSTOMER_USER_ID),
                "actor_type": "customer",
                "reason": "Changed plans",
            },
        )
        assert cancel_resp.status_code == 200
        assert cancel_resp.json()["status"] == "cancelled_by_customer"

        # 5. Issue refund
        refund_resp = await client.post(
            f"/api/v1/payments/refund/{payment_intent_id}",
            json={
                "reason": "Customer cancelled before service started",
            },
        )
        assert refund_resp.status_code == 200
        assert refund_resp.json()["status"] == "succeeded"

    async def test_emergency_job_payment_with_dynamic_pricing(
        self, client: AsyncClient
    ):
        # 1. Get emergency price estimate
        estimate_resp = await client.get(
            "/api/v1/pricing/estimate",
            params={
                "task_id": str(TASK_L4_ID),
                "latitude": "43.6532168",
                "longitude": "-79.3831523",
                "is_emergency": True,
                "country": "CA",
            },
        )
        assert estimate_resp.status_code == 200
        estimate = estimate_resp.json()
        assert estimate["is_emergency"] is True
        assert estimate["level"] == "4"
        emergency_price = estimate["final_price_min_cents"]

        # 2. Create emergency job
        create_resp = await create_job_via_api(
            client,
            task_id=TASK_L4_ID,
            is_emergency=True,
            priority="emergency",
        )
        assert create_resp.status_code == 201
        job_id = create_resp.json()["id"]

        # 3. Create payment intent for emergency price
        intent_resp = await client.post(
            "/api/v1/payments/create-intent",
            json={
                "job_id": job_id,
                "amount_cents": emergency_price,
                "currency": "cad",
            },
        )
        assert intent_resp.status_code == 201

        # 4. Confirm payment
        payment_intent_id = intent_resp.json()["id"]
        confirm_resp = await client.post(
            f"/api/v1/payments/confirm/{payment_intent_id}",
        )
        assert confirm_resp.status_code == 200
        assert confirm_resp.json()["status"] == "succeeded"


class TestProviderConnectPayoutIntegration:
    """Provider Connect account setup and payout queries."""

    async def test_provider_connect_setup_and_balance_check(
        self, client: AsyncClient
    ):
        # 1. Create Connect account for provider
        connect_resp = await client.post(
            "/api/v1/payments/connect/create",
            json={
                "provider_id": str(PROVIDER_PROFILE_ID),
                "email": "provider@test.visp.ca",
                "country": "CA",
            },
        )
        assert connect_resp.status_code == 201
        account_id = connect_resp.json()["account_id"]

        # 2. Generate onboarding link
        link_resp = await client.post(
            "/api/v1/payments/connect/onboard-link",
            json={
                "account_id": account_id,
                "refresh_url": "https://tasker.visp.ca/refresh",
                "return_url": "https://tasker.visp.ca/return",
            },
        )
        assert link_resp.status_code == 200
        assert "url" in link_resp.json()

        # 3. Check account status
        status_resp = await client.get(
            f"/api/v1/payments/connect/status/{account_id}",
        )
        assert status_resp.status_code == 200
        status = status_resp.json()
        assert status["charges_enabled"] is True
        assert status["payouts_enabled"] is True

        # 4. Check balance
        balance_resp = await client.get(
            f"/api/v1/payments/balance/{account_id}",
        )
        assert balance_resp.status_code == 200
        balance = balance_resp.json()
        assert balance["available_cents"] >= 0
        assert balance["pending_cents"] >= 0

        # 5. List payouts
        payouts_resp = await client.get(
            f"/api/v1/payments/payouts/{account_id}",
        )
        assert payouts_resp.status_code == 200
        payouts = payouts_resp.json()
        assert isinstance(payouts["payouts"], list)
        assert payouts["count"] >= 0


class TestPriceEstimateCommission:
    """Price estimate includes commission breakdown for provider payout."""

    async def test_l1_estimate_includes_commission_info(self, client: AsyncClient):
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
        # Commission fields should be present
        assert "commission_rate_min" in body
        assert "commission_rate_max" in body
        assert "provider_payout_min_cents" in body
        assert "provider_payout_max_cents" in body
        # Provider payout should be less than the total price
        assert body["provider_payout_max_cents"] <= body["final_price_max_cents"]
        # Commission rate for L1 should be in the 15-20% range
        assert float(body["commission_rate_min"]) >= 0.15
        assert float(body["commission_rate_max"]) <= 0.20

    async def test_l4_estimate_includes_commission_info(self, client: AsyncClient):
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
        assert "commission_rate_min" in body
        assert "provider_payout_min_cents" in body
        # L4 commission: 15-25%
        assert float(body["commission_rate_min"]) >= 0.15
        assert float(body["commission_rate_max"]) <= 0.25
