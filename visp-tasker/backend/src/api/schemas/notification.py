"""
Pydantic v2 schemas for the Notifications API -- VISP-INT-NOTIFICATIONS-003
============================================================================

Request/response schemas for device registration, notification history,
read status management, and notification preferences.
"""

from __future__ import annotations

import uuid
from datetime import datetime
from typing import Any, Optional

from pydantic import BaseModel, ConfigDict, Field, field_validator


# ---------------------------------------------------------------------------
# Device registration
# ---------------------------------------------------------------------------

class DeviceRegisterRequest(BaseModel):
    """Request body for registering a device token for push notifications."""

    user_id: uuid.UUID = Field(description="UUID of the user registering the device")
    device_token: str = Field(
        min_length=1,
        max_length=512,
        description="FCM registration token from the device",
    )
    platform: str = Field(
        description="Device platform: 'ios' or 'android'",
    )
    app_version: Optional[str] = Field(
        default=None,
        max_length=50,
        description="App version string (e.g. '1.2.3')",
    )

    @field_validator("platform")
    @classmethod
    def validate_platform(cls, v: str) -> str:
        v_lower = v.lower()
        if v_lower not in {"ios", "android"}:
            raise ValueError("Platform must be 'ios' or 'android'")
        return v_lower


class DeviceRegisterResponse(BaseModel):
    """Response after registering a device token."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    device_token: str
    platform: str
    app_version: Optional[str] = None
    is_active: bool
    created_at: datetime


class DeviceUnregisterRequest(BaseModel):
    """Request body for unregistering a device token."""

    user_id: uuid.UUID = Field(description="UUID of the user")
    device_token: str = Field(
        min_length=1,
        max_length=512,
        description="FCM registration token to remove",
    )


# ---------------------------------------------------------------------------
# Notification history
# ---------------------------------------------------------------------------

class NotificationOut(BaseModel):
    """Single notification in the history list."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    title: str
    body: str
    notification_type: str
    data_json: Optional[dict[str, Any]] = None
    read: bool
    read_at: Optional[datetime] = None
    sent_at: Optional[datetime] = None
    created_at: datetime


class NotificationHistoryResponse(BaseModel):
    """Paginated notification history."""

    data: list[NotificationOut]
    meta: PaginationMeta


class PaginationMeta(BaseModel):
    """Pagination metadata for list responses."""

    page: int = Field(ge=1, description="Current page number (1-indexed)")
    page_size: int = Field(ge=1, description="Number of items per page")
    total_items: int = Field(ge=0, description="Total number of matching items")
    total_pages: int = Field(ge=0, description="Total number of pages")


# Fix forward reference: re-define NotificationHistoryResponse after PaginationMeta
NotificationHistoryResponse.model_rebuild()


# ---------------------------------------------------------------------------
# Read status
# ---------------------------------------------------------------------------

class NotificationReadResponse(BaseModel):
    """Response after marking notification(s) as read."""

    success: bool
    updated_count: int = Field(ge=0, description="Number of notifications marked as read")


# ---------------------------------------------------------------------------
# Unread count
# ---------------------------------------------------------------------------

class UnreadCountResponse(BaseModel):
    """Response with the count of unread notifications."""

    user_id: uuid.UUID
    unread_count: int = Field(ge=0)


# ---------------------------------------------------------------------------
# Notification preferences
# ---------------------------------------------------------------------------

class NotificationPreferencesRequest(BaseModel):
    """Request body for updating notification preferences."""

    job_updates: Optional[bool] = Field(
        default=None,
        description="Receive notifications for job status changes",
    )
    payment_updates: Optional[bool] = Field(
        default=None,
        description="Receive notifications for payment events",
    )
    marketing: Optional[bool] = Field(
        default=None,
        description="Receive marketing and promotional notifications",
    )
    sla_warnings: Optional[bool] = Field(
        default=None,
        description="Receive SLA deadline warnings",
    )
    emergency_alerts: Optional[bool] = Field(
        default=None,
        description=(
            "Receive emergency alerts. Note: Level 4 emergency alerts "
            "are always delivered regardless of this setting."
        ),
    )


class NotificationPreferencesOut(BaseModel):
    """Current notification preference settings for a user."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    user_id: uuid.UUID
    job_updates: bool
    payment_updates: bool
    marketing: bool
    sla_warnings: bool
    emergency_alerts: bool
    created_at: datetime
    updated_at: datetime
