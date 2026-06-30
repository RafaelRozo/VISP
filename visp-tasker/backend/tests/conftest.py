"""
Shared pytest fixtures for VISP backend unit tests.

Provides mock database sessions and sample domain objects that mirror
production ORM models without requiring a live database connection.
"""

import uuid
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any
from unittest.mock import AsyncMock, MagicMock

import pytest

from src.models.job import (
    AssignmentStatus,
    EscalationType,
    Job,
    JobAssignment,
    JobEscalation,
    JobPriority,
    JobStatus,
)
from src.models.provider import (
    BackgroundCheckStatus,
    ProviderLevel,
    ProviderProfile,
    ProviderProfileStatus,
)
from src.models.sla import OnCallShift, OnCallStatus, SLAProfile, SLARegionType
from src.models.taxonomy import ServiceTask
from src.models.user import AuthProvider, User, UserStatus
from src.models.verification import (
    ConsentType,
    CredentialStatus,
    CredentialType,
    InsuranceStatus,
    LegalConsent,
    ProviderCredential,
    ProviderInsurancePolicy,
)


# ---------------------------------------------------------------------------
# Database session mock
# ---------------------------------------------------------------------------


@pytest.fixture
def mock_db() -> AsyncMock:
    """Async mock of ``AsyncSession``.

    Provides a mock that supports ``db.execute()``, ``db.add()``,
    ``db.flush()``, and ``db.commit()`` out of the box.  Individual tests
    can configure ``mock_db.execute.return_value`` to control query results.
    """
    session = AsyncMock()
    session.add = MagicMock()
    session.flush = AsyncMock()
    session.commit = AsyncMock()
    session.rollback = AsyncMock()
    return session


# ---------------------------------------------------------------------------
# User fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_customer() -> User:
    """A verified customer user."""
    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.email = "customer@example.com"
    user.first_name = "Jane"
    user.last_name = "Doe"
    user.display_name = "Jane D."
    user.phone = "+14165551234"
    user.auth_provider = AuthProvider.EMAIL
    user.role_customer = True
    user.role_provider = False
    user.role_admin = False
    user.status = UserStatus.ACTIVE
    user.email_verified = True
    user.phone_verified = True
    user.last_latitude = Decimal("43.6532168")
    user.last_longitude = Decimal("-79.3831523")
    user.timezone = "America/Toronto"
    user.locale = "en"
    user.created_at = datetime(2025, 1, 15, tzinfo=timezone.utc)
    user.updated_at = datetime(2025, 1, 15, tzinfo=timezone.utc)
    return user


@pytest.fixture
def sample_provider_user() -> User:
    """A verified provider user."""
    user = MagicMock(spec=User)
    user.id = uuid.uuid4()
    user.email = "provider@example.com"
    user.first_name = "John"
    user.last_name = "Smith"
    user.display_name = "John S."
    user.phone = "+14165559876"
    user.auth_provider = AuthProvider.EMAIL
    user.role_customer = False
    user.role_provider = True
    user.role_admin = False
    user.status = UserStatus.ACTIVE
    user.email_verified = True
    user.phone_verified = True
    user.timezone = "America/Toronto"
    user.locale = "en"
    user.created_at = datetime(2025, 1, 10, tzinfo=timezone.utc)
    user.updated_at = datetime(2025, 1, 10, tzinfo=timezone.utc)
    return user


# ---------------------------------------------------------------------------
# Provider profile fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_provider(sample_provider_user: User) -> ProviderProfile:
    """An active Level 1 provider with cleared background check."""
    profile = MagicMock(spec=ProviderProfile)
    profile.id = uuid.uuid4()
    profile.user_id = sample_provider_user.id
    profile.user = sample_provider_user
    profile.status = ProviderProfileStatus.ACTIVE
    profile.current_level = ProviderLevel.LEVEL_1
    profile.background_check_status = BackgroundCheckStatus.CLEARED
    profile.background_check_date = date(2025, 1, 15)
    profile.background_check_expiry = date(2026, 1, 15)
    profile.background_check_ref = "BG-REF-001"
    profile.internal_score = Decimal("70.00")
    profile.service_radius_km = Decimal("25.00")
    profile.home_latitude = Decimal("43.6532168")
    profile.home_longitude = Decimal("-79.3831523")
    profile.home_address = "100 Queen St W, Toronto, ON"
    profile.home_city = "Toronto"
    profile.home_province_state = "ON"
    profile.home_postal_zip = "M5H 2N2"
    profile.home_country = "CA"
    profile.max_concurrent_jobs = 1
    profile.available_for_emergency = False
    profile.years_experience = 2
    profile.stripe_account_id = "acct_test_provider_1"
    profile.activated_at = datetime(2025, 1, 16, tzinfo=timezone.utc)
    profile.created_at = datetime(2025, 1, 10, tzinfo=timezone.utc)
    profile.updated_at = datetime(2025, 1, 16, tzinfo=timezone.utc)
    profile.credentials = []
    profile.insurance_policies = []
    profile.levels = []
    return profile


@pytest.fixture
def sample_provider_l4(sample_provider_user: User) -> ProviderProfile:
    """An active Level 4 emergency provider with all required credentials."""
    profile = MagicMock(spec=ProviderProfile)
    profile.id = uuid.uuid4()
    profile.user_id = sample_provider_user.id
    profile.user = sample_provider_user
    profile.status = ProviderProfileStatus.ACTIVE
    profile.current_level = ProviderLevel.LEVEL_4
    profile.background_check_status = BackgroundCheckStatus.CLEARED
    profile.background_check_date = date(2025, 1, 10)
    profile.background_check_expiry = date(2026, 1, 10)
    profile.background_check_ref = "BG-REF-L4-001"
    profile.internal_score = Decimal("85.00")
    profile.service_radius_km = Decimal("50.00")
    profile.home_latitude = Decimal("43.6532168")
    profile.home_longitude = Decimal("-79.3831523")
    profile.home_address = "200 Bay St, Toronto, ON"
    profile.home_city = "Toronto"
    profile.home_province_state = "ON"
    profile.home_postal_zip = "M5J 2J2"
    profile.home_country = "CA"
    profile.max_concurrent_jobs = 3
    profile.available_for_emergency = True
    profile.years_experience = 15
    profile.stripe_account_id = "acct_test_provider_l4"
    profile.activated_at = datetime(2025, 1, 11, tzinfo=timezone.utc)
    profile.created_at = datetime(2025, 1, 5, tzinfo=timezone.utc)
    profile.updated_at = datetime(2025, 1, 11, tzinfo=timezone.utc)
    profile.credentials = []
    profile.insurance_policies = []
    profile.levels = []
    return profile


# ---------------------------------------------------------------------------
# Service task fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_task() -> ServiceTask:
    """A Level 1 service task with pricing configured."""
    task = MagicMock(spec=ServiceTask)
    task.id = uuid.uuid4()
    task.category_id = uuid.uuid4()
    task.slug = "basic-cleaning"
    task.name = "Basic Cleaning"
    task.description = "Standard household cleaning"
    task.level = ProviderLevel.LEVEL_1
    task.regulated = False
    task.license_required = False
    task.hazardous = False
    task.structural = False
    task.emergency_eligible = False
    task.base_price_min_cents = 2500
    task.base_price_max_cents = 4500
    task.estimated_duration_min = 120
    task.escalation_keywords = []
    task.is_active = True
    task.display_order = 1
    task.created_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    task.updated_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return task


@pytest.fixture
def sample_task_l4() -> ServiceTask:
    """A Level 4 emergency service task."""
    task = MagicMock(spec=ServiceTask)
    task.id = uuid.uuid4()
    task.category_id = uuid.uuid4()
    task.slug = "emergency-plumbing"
    task.name = "Emergency Plumbing"
    task.description = "Emergency burst pipe or flood repair"
    task.level = ProviderLevel.LEVEL_4
    task.regulated = True
    task.license_required = True
    task.hazardous = False
    task.structural = False
    task.emergency_eligible = True
    task.base_price_min_cents = 15000
    task.base_price_max_cents = 30000
    task.estimated_duration_min = 180
    task.escalation_keywords = ["flood", "burst", "emergency"]
    task.is_active = True
    task.display_order = 1
    task.created_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    task.updated_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return task


# ---------------------------------------------------------------------------
# Job fixtures
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_job(sample_customer: User, sample_task: ServiceTask) -> Job:
    """A draft job for the sample customer and task."""
    job = MagicMock(spec=Job)
    job.id = uuid.uuid4()
    job.reference_number = "TSK-20250201-0001"
    job.customer_id = sample_customer.id
    job.task_id = sample_task.id
    job.task = sample_task
    job.status = JobStatus.DRAFT
    job.priority = JobPriority.STANDARD
    job.is_emergency = False
    job.service_latitude = Decimal("43.6532168")
    job.service_longitude = Decimal("-79.3831523")
    job.service_address = "100 Queen St W, Toronto, ON"
    job.service_unit = None
    job.service_city = "Toronto"
    job.service_province_state = "ON"
    job.service_postal_zip = "M5H 2N2"
    job.service_country = "CA"
    job.requested_date = date(2025, 2, 10)
    job.requested_time_start = time(10, 0)
    job.requested_time_end = time(14, 0)
    job.flexible_schedule = False
    job.sla_response_time_min = 30
    job.sla_arrival_time_min = 60
    job.sla_completion_time_min = 180
    job.sla_profile_id = None
    job.sla_snapshot_json = None
    job.quoted_price_cents = 3500
    job.final_price_cents = None
    job.commission_rate = Decimal("0.1750")
    job.commission_amount_cents = 613
    job.provider_payout_cents = 2887
    job.currency = "CAD"
    job.customer_notes_json = []
    job.photos_before_json = []
    job.photos_after_json = []
    job.started_at = None
    job.completed_at = None
    job.cancelled_at = None
    job.cancellation_reason = None
    job.created_at = datetime(2025, 2, 1, tzinfo=timezone.utc)
    job.updated_at = datetime(2025, 2, 1, tzinfo=timezone.utc)
    return job


# ---------------------------------------------------------------------------
# SLA profile fixture
# ---------------------------------------------------------------------------


@pytest.fixture
def sample_sla_profile() -> SLAProfile:
    """A standard Level 1 SLA profile for Ontario."""
    sla = MagicMock(spec=SLAProfile)
    sla.id = uuid.uuid4()
    sla.name = "Ontario Level 1 Standard"
    sla.description = "Standard SLA for Level 1 helpers in Ontario"
    sla.level = ProviderLevel.LEVEL_1
    sla.region_type = SLARegionType.PROVINCE_STATE
    sla.region_value = "ON"
    sla.country = "CA"
    sla.task_id = None
    sla.response_time_min = 30
    sla.arrival_time_min = 60
    sla.completion_time_min = 240
    sla.penalty_enabled = False
    sla.penalty_per_min_cents = None
    sla.penalty_cap_cents = None
    sla.is_active = True
    sla.effective_from = date(2025, 1, 1)
    sla.effective_until = None
    sla.priority_order = 0
    sla.created_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    sla.updated_at = datetime(2025, 1, 1, tzinfo=timezone.utc)
    return sla
