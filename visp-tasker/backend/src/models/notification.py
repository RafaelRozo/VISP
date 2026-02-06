"""
SQLAlchemy models for device_tokens, notifications, and notification_preferences.
Corresponds to the push notification integration module (VISP-INT-NOTIFICATIONS-003).
"""

from __future__ import annotations

import enum
import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Index, String, Text, func
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


# ---------------------------------------------------------------------------
# Enums
# ---------------------------------------------------------------------------

class DevicePlatform(str, enum.Enum):
    """Supported mobile platforms for push notifications."""
    IOS = "ios"
    ANDROID = "android"


class NotificationType(str, enum.Enum):
    """Classification of notification events.

    Each notification stored in the database has a type that determines
    its presentation in the notification center and controls preference-
    based filtering.
    """
    JOB_OFFERED = "job_offered"
    JOB_ACCEPTED = "job_accepted"
    JOB_STARTED = "job_started"
    JOB_COMPLETED = "job_completed"
    JOB_CANCELLED = "job_cancelled"
    PROVIDER_EN_ROUTE = "provider_en_route"
    SLA_WARNING = "sla_warning"
    EMERGENCY_ALERT = "emergency_alert"
    CREDENTIAL_EXPIRY = "credential_expiry"
    PAYMENT_RECEIVED = "payment_received"
    PAYOUT_SENT = "payout_sent"
    CHAT_MESSAGE = "chat_message"
    SYSTEM = "system"


# ---------------------------------------------------------------------------
# DeviceToken
# ---------------------------------------------------------------------------

class DeviceToken(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Stores FCM device tokens for each user/device pair.

    A single user can have multiple active tokens (e.g. iPhone + iPad).
    Tokens are deactivated when the FCM service reports them as invalid
    or when the user explicitly unregisters.
    """
    __tablename__ = "device_tokens"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    device_token: Mapped[str] = mapped_column(
        String(512),
        nullable=False,
    )
    platform: Mapped[DevicePlatform] = mapped_column(
        Enum(DevicePlatform, name="device_platform", create_type=False),
        nullable=False,
    )
    app_version: Mapped[Optional[str]] = mapped_column(
        String(50),
        nullable=True,
    )
    is_active: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="device_tokens")

    __table_args__ = (
        Index("ix_device_tokens_user_id", "user_id"),
        Index(
            "uq_device_tokens_user_token",
            "user_id",
            "device_token",
            unique=True,
        ),
        Index("ix_device_tokens_active", "user_id", "is_active"),
    )

    def __repr__(self) -> str:
        return (
            f"<DeviceToken(id={self.id}, user_id={self.user_id}, "
            f"platform={self.platform}, active={self.is_active})>"
        )


# ---------------------------------------------------------------------------
# Notification
# ---------------------------------------------------------------------------

class Notification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Persistent notification record for in-app notification history.

    Every push notification sent through the platform is also stored here
    so that users can view their notification history in the app, even if
    they missed the push.
    """
    __tablename__ = "notifications"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        nullable=False,
    )
    title: Mapped[str] = mapped_column(
        String(255),
        nullable=False,
    )
    body: Mapped[str] = mapped_column(
        Text,
        nullable=False,
    )
    notification_type: Mapped[NotificationType] = mapped_column(
        Enum(NotificationType, name="notification_type", create_type=False),
        nullable=False,
    )
    data_json: Mapped[Optional[Any]] = mapped_column(
        JSONB,
        nullable=True,
    )
    read: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    read_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )
    sent_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True),
        nullable=True,
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="notifications")

    __table_args__ = (
        Index("ix_notifications_user_id", "user_id"),
        Index("ix_notifications_user_unread", "user_id", "read"),
        Index("ix_notifications_user_created", "user_id", "created_at"),
        Index("ix_notifications_type", "notification_type"),
    )

    def __repr__(self) -> str:
        return (
            f"<Notification(id={self.id}, user_id={self.user_id}, "
            f"type={self.notification_type}, read={self.read})>"
        )


# ---------------------------------------------------------------------------
# NotificationPreference
# ---------------------------------------------------------------------------

class NotificationPreference(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Per-user notification preference toggles.

    Each user has at most one row. All preferences default to True so that
    users receive all notifications by default and can opt out selectively.
    """
    __tablename__ = "notification_preferences"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )
    job_updates: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    payment_updates: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    marketing: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=False,
        server_default="false",
    )
    sla_warnings: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )
    emergency_alerts: Mapped[bool] = mapped_column(
        Boolean,
        nullable=False,
        default=True,
        server_default="true",
    )

    # Relationships
    user: Mapped["User"] = relationship("User", backref="notification_preference")

    __table_args__ = (
        Index("ix_notification_preferences_user_id", "user_id", unique=True),
    )

    def __repr__(self) -> str:
        return (
            f"<NotificationPreference(id={self.id}, user_id={self.user_id}, "
            f"job={self.job_updates}, pay={self.payment_updates}, "
            f"sla={self.sla_warnings}, emergency={self.emergency_alerts})>"
        )
