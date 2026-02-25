"""
E2E test fixtures for VISP backend.

Provides:
- An in-process FastAPI test app with all routes registered
- httpx AsyncClient wired via ASGI transport (no network needed)
- An async SQLite database session (in-memory) for isolation
- Pre-populated seed data: users, providers, categories, tasks, SLA profiles
- Helper fixtures for creating jobs in various states

External services (Stripe, Google Maps, FCM, weather API) are mocked at the
service/integration level so the full route -> service -> DB flow is exercised.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, AsyncGenerator
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
import pytest_asyncio
from httpx import ASGITransport, AsyncClient
from sqlalchemy import event
from sqlalchemy.ext.asyncio import (
    AsyncSession,
    async_sessionmaker,
    create_async_engine,
)

from src.models.base import Base
from sqlalchemy import JSON
from sqlalchemy.dialects.postgresql import JSONB
from sqlalchemy.ext.compiler import compiles

@compiles(JSONB, "sqlite")
def compile_jsonb_sqlite(type_, compiler, **kw):
    return "JSON"

from sqlalchemy.dialects.postgresql import INET
from sqlalchemy import String

@compiles(INET, "sqlite")
def compile_inet_sqlite(type_, compiler, **kw):
    return "VARCHAR(45)"

# ---------------------------------------------------------------------------
# Test IDs (stable across tests so cross-references work)
# ---------------------------------------------------------------------------

CUSTOMER_USER_ID = uuid.UUID("aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa")
PROVIDER_USER_ID = uuid.UUID("bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb")
PROVIDER_L4_USER_ID = uuid.UUID("cccccccc-cccc-cccc-cccc-cccccccccccc")
ADMIN_USER_ID = uuid.UUID("dddddddd-dddd-dddd-dddd-dddddddddddd")

PROVIDER_PROFILE_ID = uuid.UUID("11111111-1111-1111-1111-111111111111")
PROVIDER_L4_PROFILE_ID = uuid.UUID("22222222-2222-2222-2222-222222222222")

CATEGORY_ID = uuid.UUID("33333333-3333-3333-3333-333333333333")
TASK_L1_ID = uuid.UUID("44444444-4444-4444-4444-444444444444")
TASK_L4_ID = uuid.UUID("55555555-5555-5555-5555-555555555555")

SLA_L1_ID = uuid.UUID("66666666-6666-6666-6666-666666666666")
SLA_L4_ID = uuid.UUID("77777777-7777-7777-7777-777777777777")

CREDENTIAL_ID = uuid.UUID("88888888-8888-8888-8888-888888888888")
INSURANCE_ID = uuid.UUID("99999999-9999-9999-9999-999999999999")


# ---------------------------------------------------------------------------
# Async engine + session factory (in-memory SQLite)
# ---------------------------------------------------------------------------

TEST_DB_URL = "sqlite+aiosqlite:///:memory:"


@pytest_asyncio.fixture(scope="session")
async def _test_engine():
    """Create a single engine for the entire test session."""
    engine = create_async_engine(TEST_DB_URL, echo=False)

    # SQLite does not enforce foreign keys by default
    @event.listens_for(engine.sync_engine, "connect")
    def _enable_fk(dbapi_conn, _):
        cursor = dbapi_conn.cursor()
        cursor.execute("PRAGMA foreign_keys=ON")
        cursor.close()

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    yield engine

    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.drop_all)

    await engine.dispose()


@pytest_asyncio.fixture
async def db_session(_test_engine) -> AsyncGenerator[AsyncSession, None]:
    """Yield a fresh session wrapped in a savepoint so each test is isolated."""
    session_factory = async_sessionmaker(
        bind=_test_engine,
        class_=AsyncSession,
        expire_on_commit=False,
    )
    async with session_factory() as session:
        # Start a transaction but do not use the context manager that auto-commits
        await session.begin()
        yield session
        # Always rollback at the end of the test
        await session.rollback()


# ---------------------------------------------------------------------------
# Seed data
# ---------------------------------------------------------------------------

async def _seed_data(db: AsyncSession) -> None:
    """Insert minimum seed data for E2E tests."""
    from src.models.user import AuthProvider, User, UserStatus
    from src.models.provider import (
        BackgroundCheckStatus,
        ProviderLevel,
        ProviderProfile,
        ProviderProfileStatus,
    )
    from src.models.taxonomy import ServiceCategory, ServiceTask
    from src.models.sla import SLAProfile, SLARegionType
    from src.models.verification import (
        CredentialStatus,
        CredentialType,
        InsuranceStatus,
        ProviderCredential,
        ProviderInsurancePolicy,
    )
    from src.models.sla import OnCallShift, OnCallStatus

    now = datetime.now(timezone.utc)

    # -- Users --
    customer = User(
        id=CUSTOMER_USER_ID,
        email="customer@test.visp.ca",
        first_name="Jane",
        last_name="Doe",
        display_name="Jane D.",
        phone="+14165551111",
        auth_provider=AuthProvider.EMAIL,
        role_customer=True,
        role_provider=False,
        role_admin=False,
        status=UserStatus.ACTIVE,
        email_verified=True,
        phone_verified=True,
        last_latitude=Decimal("43.6532168"),
        last_longitude=Decimal("-79.3831523"),
    )
    provider_user = User(
        id=PROVIDER_USER_ID,
        email="provider@test.visp.ca",
        first_name="John",
        last_name="Smith",
        display_name="John S.",
        phone="+14165552222",
        auth_provider=AuthProvider.EMAIL,
        role_customer=False,
        role_provider=True,
        role_admin=False,
        status=UserStatus.ACTIVE,
        email_verified=True,
        phone_verified=True,
    )
    provider_l4_user = User(
        id=PROVIDER_L4_USER_ID,
        email="provider-l4@test.visp.ca",
        first_name="Mike",
        last_name="Emergency",
        display_name="Mike E.",
        phone="+14165553333",
        auth_provider=AuthProvider.EMAIL,
        role_customer=False,
        role_provider=True,
        role_admin=False,
        status=UserStatus.ACTIVE,
        email_verified=True,
        phone_verified=True,
    )
    admin_user = User(
        id=ADMIN_USER_ID,
        email="admin@test.visp.ca",
        first_name="Admin",
        last_name="User",
        display_name="Admin",
        phone="+14165554444",
        auth_provider=AuthProvider.EMAIL,
        role_customer=False,
        role_provider=False,
        role_admin=True,
        status=UserStatus.ACTIVE,
        email_verified=True,
        phone_verified=True,
    )
    db.add_all([customer, provider_user, provider_l4_user, admin_user])
    await db.flush()

    # -- Provider Profiles --
    provider_profile = ProviderProfile(
        id=PROVIDER_PROFILE_ID,
        user_id=PROVIDER_USER_ID,
        status=ProviderProfileStatus.ACTIVE,
        current_level=ProviderLevel.LEVEL_1,
        background_check_status=BackgroundCheckStatus.CLEARED,
        background_check_date=date(2025, 1, 15),
        background_check_expiry=date(2027, 1, 15),
        background_check_ref="BG-001",
        internal_score=Decimal("70.00"),
        service_radius_km=Decimal("25.00"),
        home_latitude=Decimal("43.6500000"),
        home_longitude=Decimal("-79.3800000"),
        home_address="100 Queen St W, Toronto, ON",
        home_city="Toronto",
        home_province_state="ON",
        home_postal_zip="M5H 2N2",
        home_country="CA",
        max_concurrent_jobs=2,
        available_for_emergency=False,
        years_experience=3,
        stripe_account_id="acct_test_l1",
        activated_at=now,
    )
    provider_l4_profile = ProviderProfile(
        id=PROVIDER_L4_PROFILE_ID,
        user_id=PROVIDER_L4_USER_ID,
        status=ProviderProfileStatus.ACTIVE,
        current_level=ProviderLevel.LEVEL_4,
        background_check_status=BackgroundCheckStatus.CLEARED,
        background_check_date=date(2025, 1, 10),
        background_check_expiry=date(2027, 1, 10),
        background_check_ref="BG-L4-001",
        internal_score=Decimal("85.00"),
        service_radius_km=Decimal("50.00"),
        home_latitude=Decimal("43.6500000"),
        home_longitude=Decimal("-79.3800000"),
        home_address="200 Bay St, Toronto, ON",
        home_city="Toronto",
        home_province_state="ON",
        home_postal_zip="M5J 2J2",
        home_country="CA",
        max_concurrent_jobs=3,
        available_for_emergency=True,
        years_experience=15,
        stripe_account_id="acct_test_l4",
        activated_at=now,
    )
    db.add_all([provider_profile, provider_l4_profile])
    await db.flush()

    # -- L4 credentials: license + insurance + on-call shift --
    l4_credential = ProviderCredential(
        id=CREDENTIAL_ID,
        provider_id=PROVIDER_L4_PROFILE_ID,
        credential_type=CredentialType.LICENSE,
        name="Ontario Master Plumber",
        issuing_authority="Ontario College of Trades",
        credential_number="LIC-9999",
        jurisdiction_country="CA",
        jurisdiction_province_state="ON",
        issued_date=date(2020, 1, 1),
        expiry_date=date(2028, 12, 31),
        status=CredentialStatus.VERIFIED,
        verified_at=now,
    )
    l4_insurance = ProviderInsurancePolicy(
        id=INSURANCE_ID,
        provider_id=PROVIDER_L4_PROFILE_ID,
        policy_number="INS-L4-001",
        insurer_name="Intact Insurance",
        policy_type="general_liability",
        coverage_amount_cents=300_000_000,  # $3M
        deductible_cents=50000,
        effective_date=date(2025, 1, 1),
        expiry_date=date(2027, 12, 31),
        status=InsuranceStatus.VERIFIED,
        verified_at=now,
    )
    l4_on_call = OnCallShift(
        provider_id=PROVIDER_L4_PROFILE_ID,
        shift_start=now - timedelta(hours=12),
        shift_end=now + timedelta(hours=12),
        region_type=SLARegionType.CITY,
        region_value="Toronto",
        country="CA",
        status=OnCallStatus.ACTIVE,
    )
    db.add_all([l4_credential, l4_insurance, l4_on_call])
    await db.flush()

    # -- Service Category & Tasks --
    category = ServiceCategory(
        id=CATEGORY_ID,
        slug="home-maintenance",
        name="Home Maintenance",
        description="General home maintenance services",
        display_order=1,
        is_active=True,
    )
    db.add(category)
    await db.flush()

    task_l1 = ServiceTask(
        id=TASK_L1_ID,
        category_id=CATEGORY_ID,
        slug="basic-cleaning",
        name="Basic Cleaning",
        description="Standard household cleaning",
        level=ProviderLevel.LEVEL_1,
        regulated=False,
        license_required=False,
        hazardous=False,
        structural=False,
        emergency_eligible=False,
        base_price_min_cents=2500,
        base_price_max_cents=4500,
        estimated_duration_min=120,
        escalation_keywords=[],
        display_order=1,
        is_active=True,
    )
    task_l4 = ServiceTask(
        id=TASK_L4_ID,
        category_id=CATEGORY_ID,
        slug="emergency-plumbing",
        name="Emergency Plumbing",
        description="Emergency burst pipe or flood repair",
        level=ProviderLevel.LEVEL_4,
        regulated=True,
        license_required=True,
        hazardous=False,
        structural=False,
        emergency_eligible=True,
        base_price_min_cents=15000,
        base_price_max_cents=30000,
        estimated_duration_min=180,
        escalation_keywords=["flood", "burst", "emergency"],
        display_order=2,
        is_active=True,
    )
    db.add_all([task_l1, task_l4])
    await db.flush()

    # -- SLA Profiles --
    sla_l1 = SLAProfile(
        id=SLA_L1_ID,
        name="Ontario Level 1 Standard",
        description="Standard SLA for Level 1 helpers in Ontario",
        level=ProviderLevel.LEVEL_1,
        region_type=SLARegionType.PROVINCE_STATE,
        region_value="ON",
        country="CA",
        response_time_min=30,
        arrival_time_min=60,
        completion_time_min=240,
        penalty_enabled=False,
        is_active=True,
        effective_from=date(2024, 1, 1),
        priority_order=0,
    )
    sla_l4 = SLAProfile(
        id=SLA_L4_ID,
        name="Ontario Level 4 Emergency",
        description="Emergency SLA for Level 4 providers in Ontario",
        level=ProviderLevel.LEVEL_4,
        region_type=SLARegionType.PROVINCE_STATE,
        region_value="ON",
        country="CA",
        response_time_min=5,
        arrival_time_min=30,
        completion_time_min=180,
        penalty_enabled=True,
        penalty_per_min_cents=500,
        penalty_cap_cents=50000,
        is_active=True,
        effective_from=date(2024, 1, 1),
        priority_order=10,
    )
    db.add_all([sla_l1, sla_l4])
    await db.flush()


@pytest_asyncio.fixture
async def seeded_db(db_session: AsyncSession) -> AsyncSession:
    """A database session with seed data already inserted."""
    await _seed_data(db_session)
    return db_session


# ---------------------------------------------------------------------------
# FastAPI test application
# ---------------------------------------------------------------------------

def _create_test_app(db_session_override: AsyncSession):
    """Build a FastAPI app with all routes registered and the DB dependency
    overridden to use the test session."""
    from fastapi import FastAPI

    from src.api.deps import get_db
    from src.api.routes.categories import router as categories_router
    from src.api.routes.tasks import router as tasks_router
    from src.api.routes.jobs import router as jobs_router
    from src.api.routes.matching import router as matching_router
    from src.api.routes.pricing import router as pricing_router
    from src.api.routes.payments import router as payments_router
    from src.api.routes.scoring import router as scoring_router
    from src.api.routes.escalations import router as escalations_router
    from src.api.routes.verification import router as verification_router
    from src.api.routes.consents import router as consents_router
    from src.api.routes.notifications import router as notifications_router
    from src.api.routes.geolocation import router as geolocation_router

    app = FastAPI(title="VISP Test")

    # Override DB dependency
    async def _override_get_db():
        yield db_session_override

    app.dependency_overrides[get_db] = _override_get_db

    # Register all route modules under /api/v1
    app.include_router(categories_router, prefix="/api/v1")
    app.include_router(tasks_router, prefix="/api/v1")
    app.include_router(jobs_router, prefix="/api/v1")
    app.include_router(matching_router, prefix="/api/v1")
    app.include_router(pricing_router, prefix="/api/v1")
    app.include_router(payments_router, prefix="/api/v1")
    app.include_router(scoring_router, prefix="/api/v1")
    app.include_router(escalations_router, prefix="/api/v1")
    app.include_router(verification_router, prefix="/api/v1")
    app.include_router(consents_router, prefix="/api/v1")
    app.include_router(notifications_router, prefix="/api/v1")
    app.include_router(geolocation_router, prefix="/api/v1")

    return app


@pytest_asyncio.fixture
async def client(seeded_db: AsyncSession) -> AsyncGenerator[AsyncClient, None]:
    """httpx AsyncClient connected to the test app via ASGI transport."""
    app = _create_test_app(seeded_db)
    transport = ASGITransport(app=app)
    async with AsyncClient(transport=transport, base_url="http://test") as ac:
        yield ac


# ---------------------------------------------------------------------------
# Weather API mock (used by pricing engine)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_weather_api():
    """Mock the weather API to return calm conditions by default."""
    from src.integrations.weatherApi import WeatherCondition

    mock_result = MagicMock()
    mock_result.is_extreme = False
    mock_result.condition = WeatherCondition.CLEAR if hasattr(WeatherCondition, "CLEAR") else MagicMock(value="clear")
    mock_result.description = "Clear skies"
    mock_result.temperature_c = 20.0

    with patch(
        "src.services.pricingEngine.get_weather_conditions",
        new_callable=AsyncMock,
        return_value=mock_result,
    ) as mock:
        yield mock


# ---------------------------------------------------------------------------
# Stripe mock (used by payment routes)
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_stripe():
    """Mock all Stripe SDK calls used in payment routes."""
    with patch("src.integrations.stripe.paymentService.stripe") as mock_stripe_mod:
        # PaymentIntent.create
        mock_intent = MagicMock()
        mock_intent.id = "pi_test_123456"
        mock_intent.client_secret = "pi_test_123456_secret_abc"
        mock_intent.status = "requires_payment_method"
        mock_intent.amount = 5000
        mock_intent.currency = "cad"
        mock_intent.payment_method = None
        mock_stripe_mod.PaymentIntent.create.return_value = mock_intent

        # PaymentIntent.confirm
        confirmed_intent = MagicMock()
        confirmed_intent.id = "pi_test_123456"
        confirmed_intent.status = "succeeded"
        confirmed_intent.amount = 5000
        confirmed_intent.currency = "cad"
        confirmed_intent.payment_method = "pm_test_card"
        mock_stripe_mod.PaymentIntent.confirm.return_value = confirmed_intent

        # PaymentIntent.cancel
        cancelled_intent = MagicMock()
        cancelled_intent.id = "pi_test_123456"
        cancelled_intent.status = "canceled"
        mock_stripe_mod.PaymentIntent.cancel.return_value = cancelled_intent

        # Refund.create
        mock_refund = MagicMock()
        mock_refund.id = "re_test_789"
        mock_refund.status = "succeeded"
        mock_refund.amount = 5000
        mock_stripe_mod.Refund.create.return_value = mock_refund

        # PaymentMethod.list
        mock_card = MagicMock()
        mock_card.last4 = "4242"
        mock_card.brand = "visa"
        mock_card.exp_month = 12
        mock_card.exp_year = 2027

        mock_pm = MagicMock()
        mock_pm.id = "pm_test_card"
        mock_pm.card = mock_card

        mock_pm_list = MagicMock()
        mock_pm_list.data = [mock_pm]
        mock_stripe_mod.PaymentMethod.list.return_value = mock_pm_list

        # PaymentMethod.attach
        mock_stripe_mod.PaymentMethod.attach.return_value = MagicMock()

        # Customer.modify
        mock_stripe_mod.Customer.modify.return_value = MagicMock()

        # Customer.create
        mock_stripe_mod.Customer.create.return_value = MagicMock(id="cus_test_abc")

        # PaymentIntent.retrieve
        mock_stripe_mod.PaymentIntent.retrieve.return_value = mock_intent

        # Connect: Account creation
        mock_account = MagicMock()
        mock_account.id = "acct_test_new"

        # StripeError for reference
        mock_stripe_mod.StripeError = Exception

        yield mock_stripe_mod


# ---------------------------------------------------------------------------
# Stripe payout service mock
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_stripe_payout():
    """Mock payout service functions."""
    with patch("src.integrations.stripe.payoutService.stripe") as mock_mod:
        # create_connected_account
        mock_acct = MagicMock()
        mock_acct.id = "acct_test_new"
        mock_mod.Account.create.return_value = mock_acct

        # account link
        mock_link = MagicMock()
        mock_link.url = "https://connect.stripe.com/setup/test"
        mock_mod.AccountLink.create.return_value = mock_link

        # account retrieve for status
        mock_acct_status = MagicMock()
        mock_acct_status.charges_enabled = True
        mock_acct_status.payouts_enabled = True
        mock_acct_status.requirements = MagicMock()
        mock_acct_status.requirements.currently_due = []
        mock_mod.Account.retrieve.return_value = mock_acct_status

        # balance
        mock_available = MagicMock()
        mock_available.amount = 150000
        mock_available.currency = "cad"
        mock_pending = MagicMock()
        mock_pending.amount = 25000
        mock_pending.currency = "cad"
        mock_balance = MagicMock()
        mock_balance.available = [mock_available]
        mock_balance.pending = [mock_pending]
        mock_mod.Balance.retrieve.return_value = mock_balance

        # payouts
        mock_payout = MagicMock()
        mock_payout.id = "po_test_001"
        mock_payout.status = "paid"
        mock_payout.amount = 100000
        mock_payout.currency = "cad"
        mock_payout.arrival_date = int(datetime.now(timezone.utc).timestamp())
        mock_payout.created = int(datetime.now(timezone.utc).timestamp())
        mock_payout_list = MagicMock()
        mock_payout_list.data = [mock_payout]
        mock_mod.Payout.list.return_value = mock_payout_list

        mock_mod.StripeError = Exception

        yield mock_mod


# ---------------------------------------------------------------------------
# Webhook handler mock
# ---------------------------------------------------------------------------

@pytest.fixture(autouse=True)
def mock_webhook_handler():
    """Mock the Stripe webhook handler."""
    mock_result = MagicMock()
    mock_result.event_type = "payment_intent.succeeded"
    mock_result.processed = True
    mock_result.message = "Payment processed successfully"

    with patch(
        "src.api.routes.payments.handle_webhook",
        new_callable=AsyncMock,
        return_value=mock_result,
    ):
        yield


# ---------------------------------------------------------------------------
# Helper: create a job via the API
# ---------------------------------------------------------------------------

async def create_job_via_api(
    client: AsyncClient,
    *,
    task_id: uuid.UUID = TASK_L1_ID,
    customer_id: uuid.UUID = CUSTOMER_USER_ID,
    is_emergency: bool = False,
    priority: str = "standard",
) -> dict[str, Any]:
    """POST to /api/v1/jobs and return the response JSON."""
    payload = {
        "customer_id": str(customer_id),
        "task_id": str(task_id),
        "location": {
            "latitude": "43.6532168",
            "longitude": "-79.3831523",
            "address": "100 Queen St W, Toronto, ON",
            "city": "Toronto",
            "province_state": "ON",
            "postal_zip": "M5H 2N2",
            "country": "CA",
        },
        "schedule": {
            "requested_date": "2026-03-15",
            "requested_time_start": "10:00",
            "requested_time_end": "14:00",
            "flexible_schedule": False,
        },
        "priority": priority,
        "is_emergency": is_emergency,
        "customer_notes_json": [],
    }
    resp = await client.post("/api/v1/jobs", json=payload)
    return resp


async def transition_job(
    client: AsyncClient,
    job_id: str,
    new_status: str,
    actor_id: uuid.UUID,
    actor_type: str = "system",
) -> dict[str, Any]:
    """PATCH /api/v1/jobs/{job_id}/status and return response."""
    payload = {
        "new_status": new_status,
        "actor_id": str(actor_id),
        "actor_type": actor_type,
    }
    resp = await client.patch(f"/api/v1/jobs/{job_id}/status", json=payload)
    return resp
