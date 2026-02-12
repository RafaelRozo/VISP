"""
VISP/Tasker Database Seed Script (VISP-DB-SEED-002)
=====================================================

Loads seed data from JSON files in the seeds/ directory and inserts them
into the PostgreSQL database using async SQLAlchemy.

Usage:
    cd backend && python scripts/seed.py

Environment variables:
    DATABASE_URL  -- async PostgreSQL connection string
                     default: postgresql+asyncpg://visp:visp@localhost:5432/visp

Features:
    - Idempotent: skips rows that already exist (matched by primary key)
    - Loads in dependency order: categories -> tasks -> SLA -> pricing -> users
    - Prints progress to stdout
    - Handles UUIDs from JSON files
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import date, datetime
from decimal import Decimal
from pathlib import Path
from typing import Any

from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# ---------------------------------------------------------------------------
# Resolve paths so the script works from anywhere
# ---------------------------------------------------------------------------
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
SEEDS_DIR = BACKEND_DIR / "seeds"
SRC_DIR = BACKEND_DIR / "src"

# Ensure src/ is importable
sys.path.insert(0, str(BACKEND_DIR))

from src.models import (
    Base,
    ProviderLevel,
    ProviderProfile,
    ProviderProfileStatus,
    BackgroundCheckStatus,
    ServiceCategory,
    ServiceTask,
    SLAProfile,
    SLARegionType,
    PricingRule,
    PricingRuleType,
    User,
    User,
    UserStatus,
    AuthProvider,
    ProviderLevelRecord,
    CommissionSchedule,
    ReviewDimension,
    ReviewerRole,
)

# ---------------------------------------------------------------------------
# Configuration
# ---------------------------------------------------------------------------
from src.core.config import settings as _settings  # noqa: E402

DATABASE_URL = _settings.database_url


def _load_json(filename: str) -> Any:
    """Load and parse a JSON seed file."""
    filepath = SEEDS_DIR / filename
    if not filepath.exists():
        print(f"  [SKIP] {filename} not found at {filepath}")
        return None
    with open(filepath, "r", encoding="utf-8") as fh:
        return json.load(fh)


def _to_uuid(value: str | None) -> uuid.UUID | None:
    """Convert a string UUID to a uuid.UUID, or return None."""
    if value is None:
        return None
    return uuid.UUID(value)


def _to_date(value: str | None) -> date | None:
    """Convert an ISO date string to a date object, or return None."""
    if value is None:
        return None
    return date.fromisoformat(value)


def _to_decimal(value: Any) -> Decimal | None:
    """Convert a numeric value to Decimal, or return None."""
    if value is None:
        return None
    return Decimal(str(value))


# ---------------------------------------------------------------------------
# Seed functions for each entity
# ---------------------------------------------------------------------------


async def seed_categories(session: AsyncSession) -> int:
    """Seed service_categories from categories.json."""
    data = _load_json("categories.json")
    if data is None:
        return 0

    inserted = 0
    for item in data:
        cat_id = _to_uuid(item["id"])
        existing = await session.get(ServiceCategory, cat_id)
        if existing is not None:
            continue

        category = ServiceCategory(
            id=cat_id,
            name=item["name"],
            slug=item["slug"],
            description=item.get("description"),
            icon_url=item.get("icon_name"),  # icon_name maps to icon_url column
            display_order=item.get("display_order", 0),
            is_active=True,
            parent_id=None,
        )
        session.add(category)
        inserted += 1

    await session.flush()
    return inserted


async def seed_tasks(session: AsyncSession, filename: str, level_label: str) -> int:
    """Seed service_tasks from a tasks JSON file."""
    data = _load_json(filename)
    if data is None:
        return 0

    inserted = 0
    for item in data:
        task_id = _to_uuid(item["id"])
        existing = await session.get(ServiceTask, task_id)
        if existing is not None:
            continue

        task = ServiceTask(
            id=task_id,
            category_id=_to_uuid(item["category_id"]),
            name=item["name"],
            slug=item["slug"],
            description=item.get("description"),
            level=ProviderLevel(item["level"]),
            regulated=item.get("regulated", False),
            license_required=item.get("license_required", False),
            hazardous=item.get("hazardous", False),
            structural=item.get("structural", False),
            emergency_eligible=item.get("emergency_eligible", False),
            base_price_min_cents=item.get("base_price_min_cents"),
            base_price_max_cents=item.get("base_price_max_cents"),
            estimated_duration_min=item.get("estimated_duration_min"),
            escalation_keywords=item.get("escalation_keywords", []),
            icon_url=item.get("icon_url"),
            display_order=item.get("display_order", 0),
            is_active=True,
        )
        session.add(task)
        inserted += 1

    await session.flush()
    return inserted


async def seed_sla_profiles(session: AsyncSession) -> int:
    """Seed sla_profiles from sla_profiles.json."""
    data = _load_json("sla_profiles.json")
    if data is None:
        return 0

    inserted = 0
    for item in data:
        sla_id = _to_uuid(item["id"])
        existing = await session.get(SLAProfile, sla_id)
        if existing is not None:
            continue

        sla = SLAProfile(
            id=sla_id,
            name=item["name"],
            description=item.get("description"),
            level=ProviderLevel(item["level"]),
            region_type=SLARegionType(item["region_type"]),
            region_value=item["region_value"],
            country=item.get("country", "CA"),
            task_id=_to_uuid(item.get("task_id")),
            response_time_min=item["response_time_min"],
            arrival_time_min=item.get("arrival_time_min"),
            completion_time_min=item.get("completion_time_min"),
            penalty_enabled=item.get("penalty_enabled", False),
            penalty_per_min_cents=item.get("penalty_per_min_cents"),
            penalty_cap_cents=item.get("penalty_cap_cents"),
            is_active=item.get("is_active", True),
            effective_from=_to_date(item["effective_from"]),
            effective_until=_to_date(item.get("effective_until")),
            priority_order=item.get("priority_order", 0),
        )
        session.add(sla)
        inserted += 1

    await session.flush()
    return inserted


async def seed_pricing_rules(session: AsyncSession) -> int:
    """Seed pricing_rules from pricing_rules.json."""
    data = _load_json("pricing_rules.json")
    if data is None:
        return 0

    inserted = 0
    for item in data:
        rule_id = _to_uuid(item["id"])
        existing = await session.get(PricingRule, rule_id)
        if existing is not None:
            continue

        level_value = item.get("level")
        rule = PricingRule(
            id=rule_id,
            name=item["name"],
            description=item.get("description"),
            rule_type=PricingRuleType(item["rule_type"]),
            level=ProviderLevel(level_value) if level_value else None,
            task_id=_to_uuid(item.get("task_id")),
            region_value=item.get("region_value"),
            country=item.get("country"),
            multiplier_min=_to_decimal(item.get("multiplier_min", "1.0000")),
            multiplier_max=_to_decimal(item.get("multiplier_max", "1.0000")),
            flat_adjustment_cents=item.get("flat_adjustment_cents", 0),
            conditions_json=item.get("conditions_json", {}),
            priority_order=item.get("priority_order", 0),
            stackable=item.get("stackable", True),
            is_active=item.get("is_active", True),
            effective_from=_to_date(item["effective_from"]),
            effective_until=_to_date(item.get("effective_until")),
        )
        session.add(rule)
        inserted += 1

    await session.flush()
    return inserted


    await session.flush()
    return inserted


async def seed_commission_schedules(session: AsyncSession) -> int:
    """Seed commission_schedules from commission_schedules.json."""
    data = _load_json("commission_schedules.json")
    if data is None:
        return 0

    inserted = 0
    for item in data:
        sched_id = _to_uuid(item["id"])
        existing = await session.get(CommissionSchedule, sched_id)
        if existing is not None:
            continue

        sched = CommissionSchedule(
            id=sched_id,
            level=ProviderLevel(item["level"]),
            commission_rate_min=_to_decimal(item["commission_rate_min"]),
            commission_rate_max=_to_decimal(item["commission_rate_max"]),
            commission_rate_default=_to_decimal(item["commission_rate_default"]),
            country=item.get("country", "CA"),
            is_active=item.get("is_active", True),
            effective_from=_to_date(item["effective_from"]),
            effective_until=_to_date(item.get("effective_until")),
        )
        session.add(sched)
        inserted += 1

    await session.flush()
    return inserted


async def seed_review_dimensions(session: AsyncSession) -> int:
    """Seed review_dimensions from review_dimensions.json."""
    data = _load_json("review_dimensions.json")
    if data is None:
        return 0

    inserted = 0
    for item in data:
        dim_id = _to_uuid(item["id"])
        existing = await session.get(ReviewDimension, dim_id)
        if existing is not None:
            continue

        dim = ReviewDimension(
            id=dim_id,
            name=item["name"],
            slug=item["slug"],
            description=item.get("description"),
            weight=_to_decimal(item["weight"]),
            applicable_role=ReviewerRole(item["applicable_role"]),
            display_order=item.get("display_order", 0),
            is_active=item.get("is_active", True),
        )
        session.add(dim)
        inserted += 1

    await session.flush()
    return inserted


async def seed_test_users(session: AsyncSession) -> int:
    """Seed test users (customers, providers, admin) from test_users.json."""
    data = _load_json("test_users.json")
    if data is None:
        return 0

    inserted = 0

    # Helper to create a User from a dict
    def _build_user(item: dict) -> User:
        return User(
            id=_to_uuid(item["id"]),
            email=item["email"],
            phone=item.get("phone"),
            password_hash=item.get("password_hash"),
            auth_provider=AuthProvider(item.get("auth_provider", "email")),
            first_name=item["first_name"],
            last_name=item["last_name"],
            display_name=item.get("display_name"),
            role_customer=item.get("role_customer", False),
            role_provider=item.get("role_provider", False),
            role_admin=item.get("role_admin", False),
            status=UserStatus(item.get("status", "active")),
            email_verified=item.get("email_verified", False),
            phone_verified=item.get("phone_verified", False),
            last_latitude=_to_decimal(item.get("last_latitude")),
            last_longitude=_to_decimal(item.get("last_longitude")),
            timezone=item.get("timezone", "America/Toronto"),
            locale=item.get("locale", "en"),
        )

    # --- Customers ---
    for cust_item in data.get("customers", []):
        user_id = _to_uuid(cust_item["id"])
        existing = await session.get(User, user_id)
        if existing is not None:
            continue
        session.add(_build_user(cust_item))
        inserted += 1

    await session.flush()

    # --- Admin ---
    admin_item = data.get("admin")
    if admin_item:
        admin_id = _to_uuid(admin_item["id"])
        existing = await session.get(User, admin_id)
        if existing is None:
            session.add(_build_user(admin_item))
            inserted += 1

    await session.flush()

    # --- Providers (user + profile) ---
    for prov_item in data.get("providers", []):
        user_data = prov_item["user"]
        profile_data = prov_item["profile"]

        user_id = _to_uuid(user_data["id"])
        existing_user = await session.get(User, user_id)
        if existing_user is None:
            session.add(_build_user(user_data))
            inserted += 1

        await session.flush()

        profile_id = _to_uuid(profile_data["id"])
        existing_profile = await session.get(ProviderProfile, profile_id)
        if existing_profile is None:
            profile = ProviderProfile(
                id=profile_id,
                user_id=user_id,
                status=ProviderProfileStatus(profile_data.get("status", "active")),
                current_level=ProviderLevel(profile_data["current_level"]),
                background_check_status=BackgroundCheckStatus(
                    profile_data.get("background_check_status", "not_submitted")
                ),
                background_check_date=_to_date(profile_data.get("background_check_date")),
                background_check_expiry=_to_date(profile_data.get("background_check_expiry")),
                internal_score=_to_decimal(profile_data.get("internal_score", 50.00)),
                service_radius_km=_to_decimal(profile_data.get("service_radius_km", 25.00)),
                home_latitude=_to_decimal(profile_data.get("home_latitude")),
                home_longitude=_to_decimal(profile_data.get("home_longitude")),
                home_address=profile_data.get("home_address"),
                home_city=profile_data.get("home_city"),
                home_province_state=profile_data.get("home_province_state"),
                home_postal_zip=profile_data.get("home_postal_zip"),
                home_country=profile_data.get("home_country", "CA"),
                max_concurrent_jobs=profile_data.get("max_concurrent_jobs", 1),
                available_for_emergency=profile_data.get("available_for_emergency", False),
                bio=profile_data.get("bio"),
                portfolio_url=profile_data.get("portfolio_url"),
                years_experience=profile_data.get("years_experience"),
            )
            session.add(profile)
            inserted += 1
            
            # Also create a ProviderLevelRecord for their current level (qualified)
            level_enum = ProviderLevel(profile_data["current_level"])
            
            # Check if level record exists (it won't if we just created the profile, but safely check)
            # We use a deterministic ID based on provider ID to avoid duplicates if re-run
            # But simpler: just query by provider_id + level
            
            level_record = ProviderLevelRecord(
                provider_id=profile_id,
                level=level_enum,
                qualified=True,
                qualified_at=datetime.utcnow(),
            )
            session.add(level_record)

    await session.flush()
    return inserted


# ---------------------------------------------------------------------------
# Main orchestration
# ---------------------------------------------------------------------------


async def run_seed() -> None:
    """Execute all seed operations in dependency order."""
    print("=" * 60)
    print("VISP/Tasker Seed Script (VISP-DB-SEED-002)")
    print("=" * 60)
    print(f"Database: {DATABASE_URL.split('@')[-1] if '@' in DATABASE_URL else DATABASE_URL}")
    print()

    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        async with session.begin():
            # Verify connectivity
            result = await session.execute(text("SELECT 1"))
            result.scalar()
            print("[OK] Database connection verified.\n")

            # Phase 1: Categories
            print("[1/7] Seeding categories...")
            count = await seed_categories(session)
            print(f"       -> {count} categories inserted.\n")

            # Phase 2: Level 1 tasks
            print("[2/7] Seeding Level 1 (Helper) tasks...")
            count = await seed_tasks(session, "tasks_level_1.json", "Level 1")
            print(f"       -> {count} tasks inserted.\n")

            # Phase 3: Level 2 tasks
            print("[3/7] Seeding Level 2 (Experienced) tasks...")
            count = await seed_tasks(session, "tasks_level_2.json", "Level 2")
            print(f"       -> {count} tasks inserted.\n")

            # Phase 4: Level 3 tasks
            print("[4/7] Seeding Level 3 (Certified Pro) tasks...")
            count = await seed_tasks(session, "tasks_level_3.json", "Level 3")
            print(f"       -> {count} tasks inserted.\n")

            # Phase 5: Level 4 tasks
            print("[5/7] Seeding Level 4 (Emergency) tasks...")
            count = await seed_tasks(session, "tasks_level_4.json", "Level 4")
            print(f"       -> {count} tasks inserted.\n")

            # Phase 6: SLA profiles
            print("[6/7] Seeding SLA profiles...")
            count = await seed_sla_profiles(session)
            print(f"       -> {count} SLA profiles inserted.\n")

            # Phase 7: Pricing rules
            print("[7/7] Seeding pricing rules...")
            count = await seed_pricing_rules(session)
            print(f"       -> {count} pricing rules inserted.\n")

            # Phase 8: Commission schedules
            print("[8/10] Seeding commission schedules...")
            count = await seed_commission_schedules(session)
            print(f"       -> {count} commission schedules inserted.\n")

            # Phase 9: Review dimensions
            print("[9/10] Seeding review dimensions...")
            count = await seed_review_dimensions(session)
            print(f"       -> {count} review dimensions inserted.\n")

            # Phase 8: Test users (bonus)
            print("[BONUS] Seeding test users & provider profiles...")
            count = await seed_test_users(session)
            print(f"         -> {count} user/profile records inserted.\n")

        # Session auto-committed by the context manager

    await engine.dispose()

    print("=" * 60)
    print("Seed complete.")
    print("=" * 60)


def main() -> None:
    """Entry point."""
    try:
        asyncio.run(run_seed())
    except KeyboardInterrupt:
        print("\nSeed interrupted by user.")
        sys.exit(1)
    except Exception as exc:
        print(f"\n[ERROR] Seed failed: {exc}")
        raise


if __name__ == "__main__":
    main()
