"""
Notification Service -- VISP-INT-NOTIFICATIONS-003
====================================================

High-level notification orchestration layer that sits between business
logic (job service, payment service, SLA checks, etc.) and the low-level
FCM push service. Each public method:

  1. Builds the appropriate notification payload (title, body, deep link
     data, sound, priority).
  2. Resolves the target user's active device tokens.
  3. Checks user notification preferences before sending.
  4. Sends the push notification via the FCM integration.
  5. Stores a persistent ``Notification`` record for in-app history.
  6. Handles invalid token cleanup when FCM reports stale tokens.

Emergency alerts (Level 4) bypass preference checks -- they are always
delivered with the critical alert sound.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone

from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from src.integrations.fcm import pushService
from src.models.job import Job
from src.models.notification import (
    DeviceToken,
    Notification,
    NotificationPreference,
    NotificationType,
)

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Internal helpers
# ---------------------------------------------------------------------------

async def _get_user_device_tokens(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> list[str]:
    """Fetch all active FCM device tokens for a user.

    Args:
        user_id: The UUID of the target user.
        db: Async database session.

    Returns:
        List of active device token strings. May be empty if the user has
        no registered devices.
    """
    result = await db.execute(
        select(DeviceToken.device_token).where(
            DeviceToken.user_id == user_id,
            DeviceToken.is_active.is_(True),
        )
    )
    tokens = [row[0] for row in result.all()]
    if not tokens:
        logger.warning("No active device tokens found for user %s", user_id)
    return tokens


async def _get_notification_preferences(
    user_id: uuid.UUID,
    db: AsyncSession,
) -> NotificationPreference | None:
    """Load notification preferences for a user.

    Returns None if the user has not configured preferences (meaning
    all defaults apply -- i.e. all enabled).
    """
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id
        )
    )
    return result.scalar_one_or_none()


def _should_send(
    prefs: NotificationPreference | None,
    notification_type: NotificationType,
) -> bool:
    """Determine whether a notification should be sent based on user preferences.

    Emergency alerts always bypass preference checks.

    Args:
        prefs: The user's NotificationPreference record, or None for defaults.
        notification_type: The type of notification being sent.

    Returns:
        True if the notification should be sent.
    """
    # Emergency alerts are never suppressed
    if notification_type == NotificationType.EMERGENCY_ALERT:
        return True

    # If no preferences are configured, all defaults are True
    if prefs is None:
        return True

    # Map notification types to preference fields
    job_types = {
        NotificationType.JOB_OFFERED,
        NotificationType.JOB_ACCEPTED,
        NotificationType.JOB_STARTED,
        NotificationType.JOB_COMPLETED,
        NotificationType.JOB_CANCELLED,
        NotificationType.PROVIDER_EN_ROUTE,
    }
    payment_types = {
        NotificationType.PAYMENT_RECEIVED,
        NotificationType.PAYOUT_SENT,
    }
    sla_types = {
        NotificationType.SLA_WARNING,
        NotificationType.CREDENTIAL_EXPIRY,
    }

    if notification_type in job_types:
        return prefs.job_updates
    if notification_type in payment_types:
        return prefs.payment_updates
    if notification_type in sla_types:
        return prefs.sla_warnings

    # System, chat, and unclassified notifications are always sent
    return True


async def _store_notification(
    user_id: uuid.UUID,
    title: str,
    body: str,
    notification_type: NotificationType,
    data: dict | None,
    db: AsyncSession,
    sent: bool = True,
) -> Notification:
    """Persist a notification record for in-app notification history.

    Args:
        user_id: Target user UUID.
        title: Notification title.
        body: Notification body text.
        notification_type: Classification of this notification.
        data: Deep link and metadata payload.
        db: Async database session.
        sent: Whether the push was actually sent (may be False if suppressed
              by preferences or no device tokens).

    Returns:
        The created Notification ORM instance.
    """
    notification = Notification(
        user_id=user_id,
        title=title,
        body=body,
        notification_type=notification_type,
        data_json=data,
        read=False,
        sent_at=datetime.now(timezone.utc) if sent else None,
    )
    db.add(notification)
    await db.flush()
    return notification


async def _deactivate_invalid_tokens(
    invalid_tokens: list[str],
    db: AsyncSession,
) -> None:
    """Mark invalid device tokens as inactive in the database.

    Called after FCM reports tokens as unregistered/invalid.

    Args:
        invalid_tokens: List of token strings reported as invalid by FCM.
        db: Async database session.
    """
    if not invalid_tokens:
        return

    logger.info("Deactivating %d invalid device tokens", len(invalid_tokens))

    await db.execute(
        update(DeviceToken)
        .where(DeviceToken.device_token.in_(invalid_tokens))
        .values(is_active=False, updated_at=datetime.now(timezone.utc))
    )
    await db.flush()


async def _send_to_user(
    user_id: uuid.UUID,
    title: str,
    body: str,
    notification_type: NotificationType,
    data: dict | None,
    db: AsyncSession,
    sound: str = "default",
    priority: str = "high",
    badge: int | None = None,
) -> bool:
    """Core helper that sends a notification to a single user.

    Handles preference checking, token resolution, push delivery, invalid
    token cleanup, and notification persistence.

    Args:
        user_id: Target user UUID.
        title: Notification title.
        body: Notification body text.
        notification_type: Notification classification.
        data: Deep link and metadata payload.
        db: Async database session.
        sound: Sound file name for the push.
        priority: FCM message priority.
        badge: iOS badge count.

    Returns:
        True if the push was sent successfully to at least one device, or
        if it was suppressed by user preferences (still stored in history).
        False on delivery failure.
    """
    # Check preferences
    prefs = await _get_notification_preferences(user_id, db)
    if not _should_send(prefs, notification_type):
        logger.info(
            "Notification suppressed by user preferences: user=%s, type=%s",
            user_id,
            notification_type.value,
        )
        # Still store in history so it appears in the notification center
        await _store_notification(
            user_id, title, body, notification_type, data, db, sent=False
        )
        return True

    # Get device tokens
    tokens = await _get_user_device_tokens(user_id, db)

    # Store notification in history regardless of token availability
    await _store_notification(
        user_id, title, body, notification_type, data, db, sent=bool(tokens)
    )

    if not tokens:
        logger.warning(
            "No device tokens for user %s; notification stored but not pushed",
            user_id,
        )
        return True  # Not a failure -- user just has no devices

    # Send push
    if len(tokens) == 1:
        result = await pushService.send_notification(
            device_token=tokens[0],
            title=title,
            body=body,
            data={k: str(v) for k, v in data.items()} if data else None,
            badge=badge,
            sound=sound,
            priority=priority,
        )
        if result.invalid_token:
            await _deactivate_invalid_tokens([tokens[0]], db)
        return result.success
    else:
        batch_result = await pushService.send_to_multiple(
            device_tokens=tokens,
            title=title,
            body=body,
            data={k: str(v) for k, v in data.items()} if data else None,
            badge=badge,
            sound=sound,
            priority=priority,
        )
        if batch_result.invalid_tokens:
            await _deactivate_invalid_tokens(batch_result.invalid_tokens, db)
        return batch_result.success_count > 0


def _format_price(amount_cents: int) -> str:
    """Format a price in cents to a human-readable dollar string.

    Args:
        amount_cents: Price in cents (e.g. 1550 for $15.50).

    Returns:
        Formatted string like "$15.50".
    """
    dollars = amount_cents / 100
    return f"${dollars:,.2f}"


# ---------------------------------------------------------------------------
# Public API -- Job lifecycle notifications
# ---------------------------------------------------------------------------

async def notify_job_offered(
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
    db: AsyncSession,
) -> bool:
    """Notify a provider that a new job has been offered to them.

    Args:
        job_id: The UUID of the offered job.
        provider_id: The UUID of the provider user to notify.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    # Load job for context
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_job_offered: Job %s not found", job_id)
        return False

    title = "New Job Offer"
    body = (
        f"You have a new job offer (#{job.reference_number}). "
        f"Tap to review and accept."
    )
    data = {
        "type": NotificationType.JOB_OFFERED.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "provider/job-offer",
        "is_emergency": str(job.is_emergency),
    }

    sound = "emergency_alert.caf" if job.is_emergency else "default"
    priority = "high"

    logger.info(
        "Sending job offered notification: job=%s, provider=%s",
        job_id,
        provider_id,
    )

    return await _send_to_user(
        user_id=provider_id,
        title=title,
        body=body,
        notification_type=NotificationType.JOB_OFFERED,
        data=data,
        db=db,
        sound=sound,
        priority=priority,
    )


async def notify_job_accepted(
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    provider_name: str,
    eta_minutes: int,
    db: AsyncSession,
) -> bool:
    """Notify a customer that their job has been accepted by a provider.

    Args:
        job_id: The UUID of the accepted job.
        customer_id: The UUID of the customer to notify.
        provider_name: Display name of the accepting provider.
        eta_minutes: Estimated time of arrival in minutes.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_job_accepted: Job %s not found", job_id)
        return False

    title = "Provider Accepted"
    body = (
        f"{provider_name} has accepted your job (#{job.reference_number}). "
        f"Estimated arrival: {eta_minutes} minutes."
    )
    data = {
        "type": NotificationType.JOB_ACCEPTED.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "customer/job-tracking",
        "provider_name": provider_name,
        "eta_minutes": str(eta_minutes),
    }

    logger.info(
        "Sending job accepted notification: job=%s, customer=%s",
        job_id,
        customer_id,
    )

    return await _send_to_user(
        user_id=customer_id,
        title=title,
        body=body,
        notification_type=NotificationType.JOB_ACCEPTED,
        data=data,
        db=db,
        sound="default",
        priority="high",
    )


async def notify_provider_en_route(
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    eta_minutes: int,
    db: AsyncSession,
) -> bool:
    """Notify a customer that the provider is on their way.

    Args:
        job_id: The UUID of the job.
        customer_id: The UUID of the customer to notify.
        eta_minutes: Updated ETA in minutes.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_provider_en_route: Job %s not found", job_id)
        return False

    title = "Provider En Route"
    body = (
        f"Your provider is on the way for job #{job.reference_number}. "
        f"Estimated arrival: {eta_minutes} minutes."
    )
    data = {
        "type": NotificationType.PROVIDER_EN_ROUTE.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "customer/job-tracking",
        "eta_minutes": str(eta_minutes),
    }

    logger.info(
        "Sending provider en route notification: job=%s, customer=%s, eta=%d",
        job_id,
        customer_id,
        eta_minutes,
    )

    return await _send_to_user(
        user_id=customer_id,
        title=title,
        body=body,
        notification_type=NotificationType.PROVIDER_EN_ROUTE,
        data=data,
        db=db,
        sound="default",
        priority="high",
    )


async def notify_job_started(
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    db: AsyncSession,
) -> bool:
    """Notify a customer that work has started on their job.

    Args:
        job_id: The UUID of the job.
        customer_id: The UUID of the customer to notify.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_job_started: Job %s not found", job_id)
        return False

    title = "Job Started"
    body = f"Work has begun on your job #{job.reference_number}."
    data = {
        "type": NotificationType.JOB_STARTED.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "customer/job-tracking",
    }

    logger.info(
        "Sending job started notification: job=%s, customer=%s",
        job_id,
        customer_id,
    )

    return await _send_to_user(
        user_id=customer_id,
        title=title,
        body=body,
        notification_type=NotificationType.JOB_STARTED,
        data=data,
        db=db,
        sound="default",
        priority="normal",
    )


async def notify_job_completed(
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    final_price_cents: int,
    db: AsyncSession,
) -> bool:
    """Notify a customer that their job has been completed.

    Args:
        job_id: The UUID of the completed job.
        customer_id: The UUID of the customer to notify.
        final_price_cents: Final price in cents.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_job_completed: Job %s not found", job_id)
        return False

    formatted_price = _format_price(final_price_cents)

    title = "Job Completed"
    body = (
        f"Your job #{job.reference_number} is complete. "
        f"Final amount: {formatted_price}. Please leave a review."
    )
    data = {
        "type": NotificationType.JOB_COMPLETED.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "customer/job-review",
        "final_price_cents": str(final_price_cents),
    }

    logger.info(
        "Sending job completed notification: job=%s, customer=%s, price=%s",
        job_id,
        customer_id,
        formatted_price,
    )

    return await _send_to_user(
        user_id=customer_id,
        title=title,
        body=body,
        notification_type=NotificationType.JOB_COMPLETED,
        data=data,
        db=db,
        sound="default",
        priority="normal",
    )


async def notify_job_cancelled(
    job_id: uuid.UUID,
    user_id: uuid.UUID,
    cancelled_by: str,
    db: AsyncSession,
) -> bool:
    """Notify a user that a job has been cancelled.

    Args:
        job_id: The UUID of the cancelled job.
        user_id: The UUID of the user to notify (customer or provider).
        cancelled_by: Who cancelled -- ``"customer"``, ``"provider"``, or ``"system"``.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_job_cancelled: Job %s not found", job_id)
        return False

    canceller_label = {
        "customer": "the customer",
        "provider": "the provider",
        "system": "the system",
        "admin": "an administrator",
    }.get(cancelled_by, cancelled_by)

    title = "Job Cancelled"
    body = (
        f"Job #{job.reference_number} has been cancelled by {canceller_label}."
    )
    data = {
        "type": NotificationType.JOB_CANCELLED.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "job-detail",
        "cancelled_by": cancelled_by,
    }

    logger.info(
        "Sending job cancelled notification: job=%s, user=%s, by=%s",
        job_id,
        user_id,
        cancelled_by,
    )

    return await _send_to_user(
        user_id=user_id,
        title=title,
        body=body,
        notification_type=NotificationType.JOB_CANCELLED,
        data=data,
        db=db,
        sound="default",
        priority="high",
    )


# ---------------------------------------------------------------------------
# Public API -- SLA & compliance notifications
# ---------------------------------------------------------------------------

async def notify_sla_warning(
    job_id: uuid.UUID,
    provider_id: uuid.UUID,
    sla_type: str,
    minutes_remaining: int,
    db: AsyncSession,
) -> bool:
    """Warn a provider about an approaching SLA deadline.

    Args:
        job_id: The UUID of the job with the SLA deadline.
        provider_id: The UUID of the provider to warn.
        sla_type: Type of SLA deadline (``"response"``, ``"arrival"``, ``"completion"``).
        minutes_remaining: Minutes until the SLA deadline.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_sla_warning: Job %s not found", job_id)
        return False

    sla_label = {
        "response": "response",
        "arrival": "arrival",
        "completion": "completion",
    }.get(sla_type, sla_type)

    title = "SLA Deadline Warning"
    body = (
        f"Job #{job.reference_number}: {sla_label} deadline in "
        f"{minutes_remaining} minute{'s' if minutes_remaining != 1 else ''}. "
        f"Please take action immediately."
    )
    data = {
        "type": NotificationType.SLA_WARNING.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "provider/job-detail",
        "sla_type": sla_type,
        "minutes_remaining": str(minutes_remaining),
    }

    logger.info(
        "Sending SLA warning: job=%s, provider=%s, sla_type=%s, minutes=%d",
        job_id,
        provider_id,
        sla_type,
        minutes_remaining,
    )

    return await _send_to_user(
        user_id=provider_id,
        title=title,
        body=body,
        notification_type=NotificationType.SLA_WARNING,
        data=data,
        db=db,
        sound="sla_warning.caf",
        priority="high",
    )


async def notify_emergency_alert(
    job_id: uuid.UUID,
    provider_ids: list[uuid.UUID],
    db: AsyncSession,
) -> int:
    """Send emergency alert to multiple on-call providers (Level 4).

    Emergency alerts bypass all notification preferences and use the
    critical alert sound.

    Args:
        job_id: The UUID of the emergency job.
        provider_ids: List of provider user UUIDs to alert.
        db: Async database session.

    Returns:
        Number of providers successfully notified.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_emergency_alert: Job %s not found", job_id)
        return 0

    title = "EMERGENCY - Immediate Response Required"
    body = (
        f"Emergency job #{job.reference_number} requires immediate response. "
        f"Location: {job.service_address}. Tap to accept."
    )
    data = {
        "type": NotificationType.EMERGENCY_ALERT.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "provider/emergency-response",
        "is_emergency": "true",
        "service_address": job.service_address,
    }

    logger.info(
        "Sending emergency alert: job=%s to %d providers",
        job_id,
        len(provider_ids),
    )

    sent_count = 0
    for provider_id in provider_ids:
        success = await _send_to_user(
            user_id=provider_id,
            title=title,
            body=body,
            notification_type=NotificationType.EMERGENCY_ALERT,
            data=data,
            db=db,
            sound="emergency_alert.caf",
            priority="high",
            badge=1,
        )
        if success:
            sent_count += 1

    logger.info(
        "Emergency alert sent to %d/%d providers for job %s",
        sent_count,
        len(provider_ids),
        job_id,
    )
    return sent_count


async def notify_credential_expiry(
    provider_id: uuid.UUID,
    credential_type: str,
    days_until_expiry: int,
    db: AsyncSession,
) -> bool:
    """Warn a provider about an expiring credential.

    Args:
        provider_id: The UUID of the provider to warn.
        credential_type: Human-readable credential type (e.g. ``"Electrical License"``).
        days_until_expiry: Number of days until the credential expires.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    if days_until_expiry <= 0:
        title = "Credential Expired"
        body = (
            f"Your {credential_type} has expired. Please renew it immediately "
            f"to continue receiving job offers."
        )
    elif days_until_expiry <= 7:
        title = "Credential Expiring Soon"
        body = (
            f"Your {credential_type} expires in {days_until_expiry} "
            f"day{'s' if days_until_expiry != 1 else ''}. "
            f"Renew now to avoid service interruption."
        )
    else:
        title = "Credential Expiry Reminder"
        body = (
            f"Your {credential_type} expires in {days_until_expiry} days. "
            f"Please plan to renew it before expiration."
        )

    data = {
        "type": NotificationType.CREDENTIAL_EXPIRY.value,
        "screen": "provider/credentials",
        "credential_type": credential_type,
        "days_until_expiry": str(days_until_expiry),
    }

    logger.info(
        "Sending credential expiry notification: provider=%s, type=%s, days=%d",
        provider_id,
        credential_type,
        days_until_expiry,
    )

    return await _send_to_user(
        user_id=provider_id,
        title=title,
        body=body,
        notification_type=NotificationType.CREDENTIAL_EXPIRY,
        data=data,
        db=db,
        sound="default",
        priority="high" if days_until_expiry <= 7 else "normal",
    )


# ---------------------------------------------------------------------------
# Public API -- Payment notifications
# ---------------------------------------------------------------------------

async def notify_payment_received(
    job_id: uuid.UUID,
    customer_id: uuid.UUID,
    amount_cents: int,
    db: AsyncSession,
) -> bool:
    """Notify a customer that their payment has been processed.

    Args:
        job_id: The UUID of the job.
        customer_id: The UUID of the customer to notify.
        amount_cents: Payment amount in cents.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    job = await db.get(Job, job_id)
    if not job:
        logger.error("notify_payment_received: Job %s not found", job_id)
        return False

    formatted_amount = _format_price(amount_cents)

    title = "Payment Confirmed"
    body = (
        f"Your payment of {formatted_amount} for job #{job.reference_number} "
        f"has been processed."
    )
    data = {
        "type": NotificationType.PAYMENT_RECEIVED.value,
        "job_id": str(job_id),
        "reference_number": job.reference_number,
        "screen": "customer/payment-receipt",
        "amount_cents": str(amount_cents),
    }

    logger.info(
        "Sending payment received notification: job=%s, customer=%s, amount=%s",
        job_id,
        customer_id,
        formatted_amount,
    )

    return await _send_to_user(
        user_id=customer_id,
        title=title,
        body=body,
        notification_type=NotificationType.PAYMENT_RECEIVED,
        data=data,
        db=db,
        sound="default",
        priority="normal",
    )


async def notify_payout_sent(
    provider_id: uuid.UUID,
    amount_cents: int,
    db: AsyncSession,
) -> bool:
    """Notify a provider that a payout has been sent to their account.

    Args:
        provider_id: The UUID of the provider to notify.
        amount_cents: Payout amount in cents.
        db: Async database session.

    Returns:
        True if the notification was sent or stored successfully.
    """
    formatted_amount = _format_price(amount_cents)

    title = "Payout Sent"
    body = (
        f"A payout of {formatted_amount} has been sent to your bank account. "
        f"Please allow 1-3 business days for the transfer to complete."
    )
    data = {
        "type": NotificationType.PAYOUT_SENT.value,
        "screen": "provider/earnings",
        "amount_cents": str(amount_cents),
    }

    logger.info(
        "Sending payout sent notification: provider=%s, amount=%s",
        provider_id,
        formatted_amount,
    )

    return await _send_to_user(
        user_id=provider_id,
        title=title,
        body=body,
        notification_type=NotificationType.PAYOUT_SENT,
        data=data,
        db=db,
        sound="default",
        priority="normal",
    )
