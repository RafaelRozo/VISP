"""
Notification API Routes -- VISP-INT-NOTIFICATIONS-003
======================================================

REST endpoints for push notification management:

  POST   /api/v1/notifications/register-device          -- Register device token
  DELETE /api/v1/notifications/unregister-device         -- Remove device token
  GET    /api/v1/notifications/history/{user_id}         -- Notification history (paginated)
  PATCH  /api/v1/notifications/read/{notification_id}    -- Mark one as read
  PATCH  /api/v1/notifications/read-all/{user_id}        -- Mark all as read
  GET    /api/v1/notifications/unread-count/{user_id}    -- Unread count
  POST   /api/v1/notifications/preferences/{user_id}     -- Update preferences
  GET    /api/v1/notifications/preferences/{user_id}     -- Get preferences
"""

from __future__ import annotations

import logging
import math
import uuid
from datetime import datetime, timezone

from fastapi import APIRouter, HTTPException, Query, status
from sqlalchemy import delete, func, select, update
from sqlalchemy.dialects.postgresql import insert as pg_insert

from src.api.deps import DBSession
from src.api.schemas.notification import (
    DeviceRegisterRequest,
    DeviceRegisterResponse,
    DeviceUnregisterRequest,
    NotificationHistoryResponse,
    NotificationOut,
    NotificationPreferencesOut,
    NotificationPreferencesRequest,
    NotificationReadResponse,
    PaginationMeta,
    UnreadCountResponse,
)
from src.core.config import settings
from src.models.notification import (
    DeviceToken,
    Notification,
    NotificationPreference,
)

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/notifications", tags=["Notifications"])


# ---------------------------------------------------------------------------
# POST /api/v1/notifications/register-device
# ---------------------------------------------------------------------------

@router.post(
    "/register-device",
    response_model=DeviceRegisterResponse,
    status_code=status.HTTP_201_CREATED,
    summary="Register device for push notifications",
    description=(
        "Registers an FCM device token for a user. If the same user/token "
        "pair already exists, the record is updated (re-activated if previously "
        "deactivated, app_version refreshed)."
    ),
)
async def register_device(
    db: DBSession,
    body: DeviceRegisterRequest,
) -> DeviceRegisterResponse:
    # Upsert: insert or update on conflict (user_id, device_token)
    stmt = (
        pg_insert(DeviceToken)
        .values(
            user_id=body.user_id,
            device_token=body.device_token,
            platform=body.platform,
            app_version=body.app_version,
            is_active=True,
        )
        .on_conflict_do_update(
            index_elements=["user_id", "device_token"],
            set_={
                "platform": body.platform,
                "app_version": body.app_version,
                "is_active": True,
                "updated_at": datetime.now(timezone.utc),
            },
        )
        .returning(DeviceToken.__table__.c)
    )

    result = await db.execute(stmt)
    row = result.one()
    await db.flush()

    logger.info(
        "Device token registered: user=%s, platform=%s",
        body.user_id,
        body.platform,
    )

    return DeviceRegisterResponse(
        id=row.id,
        user_id=row.user_id,
        device_token=row.device_token,
        platform=row.platform,
        app_version=row.app_version,
        is_active=row.is_active,
        created_at=row.created_at,
    )


# ---------------------------------------------------------------------------
# DELETE /api/v1/notifications/unregister-device
# ---------------------------------------------------------------------------

@router.delete(
    "/unregister-device",
    status_code=status.HTTP_204_NO_CONTENT,
    summary="Unregister device token",
    description=(
        "Removes (deactivates) an FCM device token so the user no longer "
        "receives push notifications on that device."
    ),
)
async def unregister_device(
    db: DBSession,
    body: DeviceUnregisterRequest,
) -> None:
    result = await db.execute(
        update(DeviceToken)
        .where(
            DeviceToken.user_id == body.user_id,
            DeviceToken.device_token == body.device_token,
        )
        .values(is_active=False, updated_at=datetime.now(timezone.utc))
    )

    if result.rowcount == 0:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail="Device token not found for this user.",
        )

    await db.flush()

    logger.info(
        "Device token unregistered: user=%s", body.user_id
    )


# ---------------------------------------------------------------------------
# GET /api/v1/notifications/history/{user_id}
# ---------------------------------------------------------------------------

@router.get(
    "/history/{user_id}",
    response_model=NotificationHistoryResponse,
    summary="Get notification history",
    description=(
        "Returns a paginated list of notifications for a user, ordered by "
        "most recent first. Includes both read and unread notifications."
    ),
)
async def get_notification_history(
    db: DBSession,
    user_id: uuid.UUID,
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
    notification_type: str | None = Query(
        default=None,
        alias="type",
        description="Filter by notification type",
    ),
    unread_only: bool = Query(
        default=False,
        description="Only return unread notifications",
    ),
) -> NotificationHistoryResponse:
    # Build base query
    base_filter = [Notification.user_id == user_id]

    if notification_type:
        base_filter.append(Notification.notification_type == notification_type)
    if unread_only:
        base_filter.append(Notification.read.is_(False))

    # Count total
    count_stmt = select(func.count()).select_from(Notification).where(*base_filter)
    total_items = (await db.execute(count_stmt)).scalar_one()

    total_pages = math.ceil(total_items / page_size) if total_items > 0 else 0

    # Fetch page
    offset = (page - 1) * page_size
    data_stmt = (
        select(Notification)
        .where(*base_filter)
        .order_by(Notification.created_at.desc())
        .offset(offset)
        .limit(page_size)
    )
    result = await db.execute(data_stmt)
    notifications = result.scalars().all()

    return NotificationHistoryResponse(
        data=[NotificationOut.model_validate(n) for n in notifications],
        meta=PaginationMeta(
            page=page,
            page_size=page_size,
            total_items=total_items,
            total_pages=total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# PATCH /api/v1/notifications/read/{notification_id}
# ---------------------------------------------------------------------------

@router.patch(
    "/read/{notification_id}",
    response_model=NotificationReadResponse,
    summary="Mark notification as read",
    description="Marks a single notification as read and records the read timestamp.",
)
async def mark_notification_read(
    db: DBSession,
    notification_id: uuid.UUID,
) -> NotificationReadResponse:
    now = datetime.now(timezone.utc)

    result = await db.execute(
        update(Notification)
        .where(
            Notification.id == notification_id,
            Notification.read.is_(False),
        )
        .values(read=True, read_at=now, updated_at=now)
    )
    await db.flush()

    if result.rowcount == 0:
        # Check if it exists at all
        exists_result = await db.execute(
            select(Notification.id).where(Notification.id == notification_id)
        )
        if exists_result.scalar_one_or_none() is None:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=f"Notification with id '{notification_id}' not found.",
            )
        # Already read
        return NotificationReadResponse(success=True, updated_count=0)

    return NotificationReadResponse(success=True, updated_count=result.rowcount)


# ---------------------------------------------------------------------------
# PATCH /api/v1/notifications/read-all/{user_id}
# ---------------------------------------------------------------------------

@router.patch(
    "/read-all/{user_id}",
    response_model=NotificationReadResponse,
    summary="Mark all notifications as read",
    description="Marks all unread notifications for a user as read.",
)
async def mark_all_notifications_read(
    db: DBSession,
    user_id: uuid.UUID,
) -> NotificationReadResponse:
    now = datetime.now(timezone.utc)

    result = await db.execute(
        update(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.read.is_(False),
        )
        .values(read=True, read_at=now, updated_at=now)
    )
    await db.flush()

    logger.info(
        "Marked %d notifications as read for user %s",
        result.rowcount,
        user_id,
    )

    return NotificationReadResponse(success=True, updated_count=result.rowcount)


# ---------------------------------------------------------------------------
# GET /api/v1/notifications/unread-count/{user_id}
# ---------------------------------------------------------------------------

@router.get(
    "/unread-count/{user_id}",
    response_model=UnreadCountResponse,
    summary="Get unread notification count",
    description="Returns the number of unread notifications for a user.",
)
async def get_unread_count(
    db: DBSession,
    user_id: uuid.UUID,
) -> UnreadCountResponse:
    result = await db.execute(
        select(func.count())
        .select_from(Notification)
        .where(
            Notification.user_id == user_id,
            Notification.read.is_(False),
        )
    )
    count = result.scalar_one()

    return UnreadCountResponse(user_id=user_id, unread_count=count)


# ---------------------------------------------------------------------------
# POST /api/v1/notifications/preferences/{user_id}
# ---------------------------------------------------------------------------

@router.post(
    "/preferences/{user_id}",
    response_model=NotificationPreferencesOut,
    summary="Update notification preferences",
    description=(
        "Creates or updates notification preferences for a user. Only "
        "fields provided in the request body are updated; omitted fields "
        "retain their current values."
    ),
)
async def update_notification_preferences(
    db: DBSession,
    user_id: uuid.UUID,
    body: NotificationPreferencesRequest,
) -> NotificationPreferencesOut:
    # Check if preferences exist
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id
        )
    )
    prefs = result.scalar_one_or_none()

    if prefs is None:
        # Create with defaults, then apply any provided overrides
        prefs = NotificationPreference(
            user_id=user_id,
            job_updates=body.job_updates if body.job_updates is not None else True,
            payment_updates=body.payment_updates if body.payment_updates is not None else True,
            marketing=body.marketing if body.marketing is not None else False,
            sla_warnings=body.sla_warnings if body.sla_warnings is not None else True,
            emergency_alerts=body.emergency_alerts if body.emergency_alerts is not None else True,
        )
        db.add(prefs)
        await db.flush()
        await db.refresh(prefs)
    else:
        # Update only provided fields
        update_fields: dict = {}
        if body.job_updates is not None:
            update_fields["job_updates"] = body.job_updates
        if body.payment_updates is not None:
            update_fields["payment_updates"] = body.payment_updates
        if body.marketing is not None:
            update_fields["marketing"] = body.marketing
        if body.sla_warnings is not None:
            update_fields["sla_warnings"] = body.sla_warnings
        if body.emergency_alerts is not None:
            update_fields["emergency_alerts"] = body.emergency_alerts

        if update_fields:
            update_fields["updated_at"] = datetime.now(timezone.utc)
            await db.execute(
                update(NotificationPreference)
                .where(NotificationPreference.user_id == user_id)
                .values(**update_fields)
            )
            await db.flush()
            await db.refresh(prefs)

    logger.info("Notification preferences updated for user %s", user_id)

    return NotificationPreferencesOut.model_validate(prefs)


# ---------------------------------------------------------------------------
# GET /api/v1/notifications/preferences/{user_id}
# ---------------------------------------------------------------------------

@router.get(
    "/preferences/{user_id}",
    response_model=NotificationPreferencesOut,
    summary="Get notification preferences",
    description=(
        "Returns the current notification preferences for a user. If the "
        "user has not configured preferences, returns defaults (all enabled "
        "except marketing)."
    ),
)
async def get_notification_preferences(
    db: DBSession,
    user_id: uuid.UUID,
) -> NotificationPreferencesOut:
    result = await db.execute(
        select(NotificationPreference).where(
            NotificationPreference.user_id == user_id
        )
    )
    prefs = result.scalar_one_or_none()

    if prefs is None:
        # Create default preferences
        prefs = NotificationPreference(
            user_id=user_id,
            job_updates=True,
            payment_updates=True,
            marketing=False,
            sla_warnings=True,
            emergency_alerts=True,
        )
        db.add(prefs)
        await db.flush()
        await db.refresh(prefs)

        logger.info(
            "Created default notification preferences for user %s", user_id
        )

    return NotificationPreferencesOut.model_validate(prefs)
