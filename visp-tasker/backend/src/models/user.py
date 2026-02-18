"""
SQLAlchemy models for the users table.
Corresponds to migration 001_create_users.sql.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, DateTime, Enum, Numeric, String, Text, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class UserStatus(str, enum.Enum):
    PENDING_VERIFICATION = "pending_verification"
    ACTIVE = "active"
    SUSPENDED = "suspended"
    DEACTIVATED = "deactivated"
    BANNED = "banned"


class AuthProvider(str, enum.Enum):
    EMAIL = "email"
    APPLE = "apple"
    GOOGLE = "google"
    PHONE = "phone"


class User(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "users"

    # Authentication
    email: Mapped[str] = mapped_column(String(320), unique=True, nullable=False)
    phone: Mapped[Optional[str]] = mapped_column(String(20), unique=True, nullable=True)
    password_hash: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    auth_provider: Mapped[AuthProvider] = mapped_column(
        Enum(AuthProvider, name="auth_provider", create_type=False),
        nullable=False,
        server_default="EMAIL",
    )
    auth_provider_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Profile
    first_name: Mapped[str] = mapped_column(String(100), nullable=False)
    last_name: Mapped[str] = mapped_column(String(100), nullable=False)
    display_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    avatar_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Roles
    role_customer: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    role_provider: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    role_admin: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Status
    status: Mapped[UserStatus] = mapped_column(
        Enum(UserStatus, name="user_status", create_type=False),
        nullable=False,
        server_default="PENDING_VERIFICATION",
    )
    email_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    phone_verified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Default address (saved from profile for booking auto-fill)
    default_address_street: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)
    default_address_city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    default_address_province: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    default_address_postal_code: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    default_address_country: Mapped[Optional[str]] = mapped_column(String(5), nullable=True, server_default="CA")
    default_address_latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    default_address_longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    default_address_formatted: Mapped[Optional[str]] = mapped_column(String(500), nullable=True)

    # Stripe
    stripe_customer_id: Mapped[Optional[str]] = mapped_column(String(255), nullable=True)

    # Location
    last_latitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    last_longitude: Mapped[Optional[Decimal]] = mapped_column(Numeric(10, 7), nullable=True)
    timezone: Mapped[Optional[str]] = mapped_column(String(50), server_default="America/Toronto")
    locale: Mapped[Optional[str]] = mapped_column(String(10), server_default="en")

    # Metadata
    last_login_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    deleted_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Relationships
    provider_profile: Mapped[Optional["ProviderProfile"]] = relationship(
        "ProviderProfile", back_populates="user", uselist=False
    )
    legal_consents: Mapped[list["LegalConsent"]] = relationship(
        "LegalConsent", back_populates="user"
    )
    customer_jobs: Mapped[list["Job"]] = relationship(
        "Job", back_populates="customer", foreign_keys="[Job.customer_id]"
    )
    reviews_given: Mapped[list["Review"]] = relationship(
        "Review", back_populates="reviewer", foreign_keys="[Review.reviewer_id]"
    )
    reviews_received: Mapped[list["Review"]] = relationship(
        "Review", back_populates="reviewee", foreign_keys="[Review.reviewee_id]"
    )

    def __repr__(self) -> str:
        return f"<User(id={self.id}, email={self.email}, status={self.status})>"
