"""
SQLAlchemy models for provider_profiles, provider_levels, and provider_availability.
Corresponds to migration 002_create_providers.sql.
"""

import enum
import uuid
from datetime import date, datetime, time
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    SmallInteger,
    String,
    Text,
    Time,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ProviderLevel(str, enum.Enum):
    LEVEL_1 = "1"
    LEVEL_2 = "2"
    LEVEL_3 = "3"
    LEVEL_4 = "4"


class BackgroundCheckStatus(str, enum.Enum):
    NOT_SUBMITTED = "not_submitted"
    PENDING = "pending"
    CLEARED = "cleared"
    FLAGGED = "flagged"
    EXPIRED = "expired"
    REJECTED = "rejected"


class ProviderProfileStatus(str, enum.Enum):
    ONBOARDING = "onboarding"
    PENDING_REVIEW = "pending_review"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    INACTIVE = "inactive"


class ProviderProfile(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "provider_profiles"

    user_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="CASCADE"),
        unique=True,
        nullable=False,
    )

    # Status
    status: Mapped[ProviderProfileStatus] = mapped_column(
        Enum(ProviderProfileStatus, name="provider_profile_status", create_type=False),
        nullable=False,
        server_default="ONBOARDING",
    )

    # Current level
    current_level: Mapped[ProviderLevel] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=False,
        server_default="LEVEL_1",
    )

    # Background check
    background_check_status: Mapped[BackgroundCheckStatus] = mapped_column(
        Enum(BackgroundCheckStatus, name="background_check_status", create_type=False),
        nullable=False,
        server_default="NOT_SUBMITTED",
    )
    background_check_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    background_check_expiry: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    background_check_ref: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Internal scoring
    internal_score: Mapped[Decimal] = mapped_column(
        Numeric(5, 2), nullable=False, server_default="50.00"
    )

    # Service radius
    service_radius_km: Mapped[Decimal] = mapped_column(
        Numeric(6, 2), nullable=False, server_default="25.00"
    )

    # Home base location
    home_latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    home_longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    home_address: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    home_city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    home_province_state: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    home_postal_zip: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    home_country: Mapped[Optional[str]] = mapped_column(String(2), server_default="CA")

    # Work preferences
    max_concurrent_jobs: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="1"
    )
    available_for_emergency: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # Profile content
    bio: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    portfolio_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    years_experience: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Financial
    stripe_account_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Metadata
    activated_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    user: Mapped["User"] = relationship("User", back_populates="provider_profile")
    levels: Mapped[list["ProviderLevelRecord"]] = relationship(
        "ProviderLevelRecord", back_populates="provider", cascade="all, delete-orphan"
    )
    availability: Mapped[list["ProviderAvailability"]] = relationship(
        "ProviderAvailability", back_populates="provider", cascade="all, delete-orphan"
    )
    credentials: Mapped[list["ProviderCredential"]] = relationship(
        "ProviderCredential", back_populates="provider", cascade="all, delete-orphan"
    )
    insurance_policies: Mapped[list["ProviderInsurancePolicy"]] = relationship(
        "ProviderInsurancePolicy", back_populates="provider", cascade="all, delete-orphan"
    )
    task_qualifications: Mapped[list["ProviderTaskQualification"]] = relationship(
        "ProviderTaskQualification", back_populates="provider", cascade="all, delete-orphan"
    )
    job_assignments: Mapped[list["JobAssignment"]] = relationship(
        "JobAssignment", back_populates="provider"
    )
    on_call_shifts: Mapped[list["OnCallShift"]] = relationship(
        "OnCallShift", back_populates="provider", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return (
            f"<ProviderProfile(id={self.id}, user_id={self.user_id}, "
            f"level={self.current_level}, score={self.internal_score})>"
        )


class ProviderLevelRecord(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "provider_levels"

    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    level: Mapped[ProviderLevel] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=False,
    )

    # Qualification status
    qualified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    qualified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    revoked_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Approval
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    # Relationships
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="levels"
    )
    approver: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by])

    def __repr__(self) -> str:
        return (
            f"<ProviderLevelRecord(provider_id={self.provider_id}, "
            f"level={self.level}, qualified={self.qualified})>"
        )


class ProviderAvailability(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "provider_availability"

    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    day_of_week: Mapped[int] = mapped_column(SmallInteger, nullable=False)
    start_time: Mapped[time] = mapped_column(Time, nullable=False)
    end_time: Mapped[time] = mapped_column(Time, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Relationships
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="availability"
    )

    def __repr__(self) -> str:
        return (
            f"<ProviderAvailability(provider_id={self.provider_id}, "
            f"day={self.day_of_week}, {self.start_time}-{self.end_time})>"
        )
