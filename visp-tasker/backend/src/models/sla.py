"""
SQLAlchemy models for sla_profiles and on_call_shifts.
Corresponds to migration 006_create_sla.sql.
"""

import enum
import uuid
from datetime import date, datetime
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider import ProviderLevel


class SLARegionType(str, enum.Enum):
    COUNTRY = "country"
    PROVINCE_STATE = "province_state"
    CITY = "city"
    POSTAL_PREFIX = "postal_prefix"
    CUSTOM_ZONE = "custom_zone"


class OnCallStatus(str, enum.Enum):
    SCHEDULED = "scheduled"
    ACTIVE = "active"
    COMPLETED = "completed"
    CANCELLED = "cancelled"
    NO_SHOW = "no_show"


class SLAProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "sla_profiles"

    # Scope
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Which level this SLA applies to
    level: Mapped[ProviderLevel] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=False,
    )

    # Region targeting
    region_type: Mapped[SLARegionType] = mapped_column(
        Enum(SLARegionType, name="sla_region_type", create_type=False),
        nullable=False,
        server_default="PROVINCE_STATE",
    )
    region_value: Mapped[str] = mapped_column(String(200), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False, server_default="CA")

    # Task scope (NULL = applies to all tasks at this level)
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )

    # SLA targets (in minutes)
    response_time_min: Mapped[int] = mapped_column(Integer, nullable=False)
    arrival_time_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    completion_time_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Penalties
    penalty_enabled: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    penalty_per_min_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    penalty_cap_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Activation
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Priority (higher wins when multiple SLAs match)
    priority_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    # Relationships
    task: Mapped[Optional["ServiceTask"]] = relationship(
        "ServiceTask", back_populates="sla_profiles"
    )

    def __repr__(self) -> str:
        return (
            f"<SLAProfile(id={self.id}, name={self.name}, "
            f"level={self.level}, region={self.region_value})>"
        )


class OnCallShift(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "on_call_shifts"

    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Shift window
    shift_start: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )
    shift_end: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False
    )

    # Region coverage
    region_type: Mapped[SLARegionType] = mapped_column(
        Enum(SLARegionType, name="sla_region_type", create_type=False),
        nullable=False,
        server_default="CITY",
    )
    region_value: Mapped[str] = mapped_column(String(200), nullable=False)
    country: Mapped[str] = mapped_column(String(2), nullable=False, server_default="CA")

    # Status
    status: Mapped[OnCallStatus] = mapped_column(
        Enum(OnCallStatus, name="on_call_status", create_type=False),
        nullable=False,
        server_default="SCHEDULED",
    )

    # Check-in tracking
    checked_in_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    checked_out_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Compensation
    shift_rate_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Relationships
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="on_call_shifts"
    )

    def __repr__(self) -> str:
        return (
            f"<OnCallShift(id={self.id}, provider={self.provider_id}, "
            f"start={self.shift_start}, status={self.status})>"
        )
