"""
Credential & Insurance Expiry Checker -- Daily Scheduled Job.

This module provides a daily cron job that:

1. Detects verified credentials past their expiry date and marks them as ``expired``.
2. Detects verified insurance policies past their expiry date and marks them as ``expired``.
3. Detects background checks past their expiry date and marks them as ``expired``.
4. Suspends Level 3/4 providers whose mandatory credentials are no longer valid.
5. Sends 30-day advance warning notifications for upcoming expirations.

Intended to run once per day via Celery Beat, AWS EventBridge, or a similar scheduler.

Usage with Celery::

    from src.jobs.expiryChecker import run_daily_expiry_check

    @celery_app.task
    def daily_expiry_check():
        import asyncio
        asyncio.run(run_daily_expiry_check())

Usage with a simple cron runner::

    python -m src.jobs.expiryChecker
"""

from __future__ import annotations

import asyncio
import logging
from datetime import date, timedelta
from typing import Optional

from sqlalchemy import and_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models import (
    BackgroundCheckStatus,
    CredentialStatus,
    InsuranceStatus,
    ProviderCredential,
    ProviderInsurancePolicy,
    ProviderProfile,
    ProviderProfileStatus,
)
from src.services.verificationService import (
    EXPIRY_WARNING_DAYS,
    ExpiryCheckResult,
    auto_expire_check,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Notification stubs
# ---------------------------------------------------------------------------

async def _send_expiry_warning_notification(
    provider_id: str,
    item_type: str,
    item_name: str,
    expiry_date: date,
    days_remaining: int,
) -> None:
    """Send a push notification / email warning about upcoming credential expiry.

    This is a stub.  In production, this would integrate with the notification
    service (Firebase Cloud Messaging for push, SES for email).

    Args:
        provider_id: The provider profile UUID as string.
        item_type: "credential", "insurance", or "background_check".
        item_name: Human-readable name of the expiring item.
        expiry_date: The date the item expires.
        days_remaining: Number of days until expiry.
    """
    logger.info(
        "NOTIFICATION STUB: %s expiry warning for provider %s -- "
        "'%s' expires on %s (%d days remaining)",
        item_type,
        provider_id,
        item_name,
        expiry_date.isoformat(),
        days_remaining,
    )


async def _send_suspension_notification(
    provider_id: str,
    reasons: list[str],
) -> None:
    """Send a notification that a provider account has been suspended.

    This is a stub.  In production, this would send a push notification,
    email, and in-app alert.

    Args:
        provider_id: The provider profile UUID as string.
        reasons: List of reasons for the suspension.
    """
    logger.warning(
        "NOTIFICATION STUB: Provider %s has been SUSPENDED. Reasons: %s",
        provider_id,
        "; ".join(reasons),
    )


# ---------------------------------------------------------------------------
# Warning notification sender
# ---------------------------------------------------------------------------

async def send_expiry_warnings(
    db: AsyncSession,
    reference_date: Optional[date] = None,
) -> dict[str, int]:
    """Send warning notifications for credentials and insurance policies
    expiring within the next 30 days.

    Args:
        db: Async database session.
        reference_date: The date to check against (defaults to today).

    Returns:
        Dictionary with counts of warnings sent by type.
    """
    today = reference_date or date.today()
    warning_date = today + timedelta(days=EXPIRY_WARNING_DAYS)
    counts = {
        "credential_warnings": 0,
        "insurance_warnings": 0,
        "background_check_warnings": 0,
    }

    # ---- Credential warnings ----
    cred_stmt = select(ProviderCredential).where(
        and_(
            ProviderCredential.status == CredentialStatus.VERIFIED,
            ProviderCredential.expiry_date.isnot(None),
            ProviderCredential.expiry_date >= today,
            ProviderCredential.expiry_date <= warning_date,
        )
    )
    result = await db.execute(cred_stmt)
    expiring_creds = result.scalars().all()
    for cred in expiring_creds:
        days_remaining = (cred.expiry_date - today).days
        await _send_expiry_warning_notification(
            provider_id=str(cred.provider_id),
            item_type="credential",
            item_name=cred.name,
            expiry_date=cred.expiry_date,
            days_remaining=days_remaining,
        )
        counts["credential_warnings"] += 1

    # ---- Insurance warnings ----
    ins_stmt = select(ProviderInsurancePolicy).where(
        and_(
            ProviderInsurancePolicy.status == InsuranceStatus.VERIFIED,
            ProviderInsurancePolicy.expiry_date >= today,
            ProviderInsurancePolicy.expiry_date <= warning_date,
        )
    )
    result = await db.execute(ins_stmt)
    expiring_policies = result.scalars().all()
    for policy in expiring_policies:
        days_remaining = (policy.expiry_date - today).days
        await _send_expiry_warning_notification(
            provider_id=str(policy.provider_id),
            item_type="insurance",
            item_name=f"{policy.insurer_name} - {policy.policy_number}",
            expiry_date=policy.expiry_date,
            days_remaining=days_remaining,
        )
        counts["insurance_warnings"] += 1

    # ---- Background check warnings ----
    bg_stmt = select(ProviderProfile).where(
        and_(
            ProviderProfile.background_check_status == BackgroundCheckStatus.CLEARED,
            ProviderProfile.background_check_expiry.isnot(None),
            ProviderProfile.background_check_expiry >= today,
            ProviderProfile.background_check_expiry <= warning_date,
        )
    )
    result = await db.execute(bg_stmt)
    bg_expiring = result.scalars().all()
    for profile in bg_expiring:
        days_remaining = (profile.background_check_expiry - today).days
        await _send_expiry_warning_notification(
            provider_id=str(profile.id),
            item_type="background_check",
            item_name=f"Background Check (ref: {profile.background_check_ref or 'N/A'})",
            expiry_date=profile.background_check_expiry,
            days_remaining=days_remaining,
        )
        counts["background_check_warnings"] += 1

    logger.info(
        "Expiry warnings sent: creds=%d, insurance=%d, bg_checks=%d",
        counts["credential_warnings"],
        counts["insurance_warnings"],
        counts["background_check_warnings"],
    )

    return counts


# ---------------------------------------------------------------------------
# Main daily job
# ---------------------------------------------------------------------------

async def run_daily_expiry_check(
    db: AsyncSession,
    reference_date: Optional[date] = None,
) -> dict[str, int | ExpiryCheckResult]:
    """Execute the full daily expiry check workflow.

    Steps:
    1. Run auto_expire_check to expire outdated credentials and suspend providers.
    2. Send warning notifications for items expiring within 30 days.

    Args:
        db: Async database session.
        reference_date: Optional date override (for testing).

    Returns:
        Dictionary with expiry results and warning counts.
    """
    today = reference_date or date.today()

    logger.info("Starting daily expiry check for date: %s", today.isoformat())

    # Step 1: Expire and suspend
    expiry_result = await auto_expire_check(db, reference_date=today)

    # Step 2: Send warnings for items approaching expiry
    warning_counts = await send_expiry_warnings(db, reference_date=today)

    logger.info(
        "Daily expiry check completed. Expired: creds=%d, ins=%d, bg=%d. "
        "Suspended: %d. Warnings: creds=%d, ins=%d, bg=%d.",
        expiry_result.credentials_expired,
        expiry_result.insurance_expired,
        expiry_result.background_checks_expired,
        expiry_result.providers_suspended,
        warning_counts["credential_warnings"],
        warning_counts["insurance_warnings"],
        warning_counts["background_check_warnings"],
    )

    return {
        "expiry_result": expiry_result,
        "warning_counts": warning_counts,
    }


# ---------------------------------------------------------------------------
# CLI entry point (for manual runs / simple cron)
# ---------------------------------------------------------------------------

async def _cli_main() -> None:
    """Entry point for running the expiry checker from the command line.

    Creates its own database session via the application session factory.
    """
    from src.api.deps import async_session_factory

    async with async_session_factory() as session:
        try:
            result = await run_daily_expiry_check(session)
            await session.commit()
            print(f"Expiry check completed: {result}")  # noqa: T201
        except Exception:
            await session.rollback()
            logger.exception("Expiry check failed")
            raise
        finally:
            await session.close()


if __name__ == "__main__":
    logging.basicConfig(level=logging.INFO)
    asyncio.run(_cli_main())
