"""
SQLAlchemy models for service_categories, service_tasks, and provider_task_qualifications.
Corresponds to migration 003_create_taxonomy.sql.
"""

import uuid
from datetime import datetime
from typing import Any, Optional

from sqlalchemy import Boolean, DateTime, Enum, ForeignKey, Integer, String, Text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider import ProviderLevel


class ServiceCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_categories"

    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    icon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Self-referential parent (NULL = root category)
    parent_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_categories.id", ondelete="SET NULL"),
        nullable=True,
    )

    # Relationships
    parent: Mapped[Optional["ServiceCategory"]] = relationship(
        "ServiceCategory",
        remote_side="ServiceCategory.id",
        back_populates="children",
    )
    children: Mapped[list["ServiceCategory"]] = relationship(
        "ServiceCategory", back_populates="parent"
    )
    tasks: Mapped[list["ServiceTask"]] = relationship(
        "ServiceTask", back_populates="category", cascade="all, delete-orphan"
    )

    def __repr__(self) -> str:
        return f"<ServiceCategory(id={self.id}, slug={self.slug}, name={self.name})>"


class ServiceTask(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_tasks"

    category_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_categories.id", ondelete="CASCADE"),
        nullable=False,
    )
    slug: Mapped[str] = mapped_column(String(150), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(300), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Level required -- business rule: must match provider_levels.level
    level: Mapped[ProviderLevel] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=False,
    )

    # Regulatory / safety flags
    regulated: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    license_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    certification_required: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    hazardous: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    structural: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    emergency_eligible: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Pricing guidance
    base_price_min_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    base_price_max_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    estimated_duration_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Auto-escalation keywords (JSON array of strings)
    escalation_keywords: Mapped[Any] = mapped_column(
        JSONB, server_default="'[]'::jsonb", nullable=False
    )

    # Display
    icon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Relationships
    category: Mapped["ServiceCategory"] = relationship(
        "ServiceCategory", back_populates="tasks"
    )
    provider_qualifications: Mapped[list["ProviderTaskQualification"]] = relationship(
        "ProviderTaskQualification", back_populates="task"
    )
    jobs: Mapped[list["Job"]] = relationship("Job", back_populates="task")
    sla_profiles: Mapped[list["SLAProfile"]] = relationship(
        "SLAProfile", back_populates="task"
    )
    pricing_rules: Mapped[list["PricingRule"]] = relationship(
        "PricingRule", back_populates="task"
    )

    def __repr__(self) -> str:
        return (
            f"<ServiceTask(id={self.id}, slug={self.slug}, "
            f"level={self.level}, emergency={self.emergency_eligible})>"
        )


class ProviderTaskQualification(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "provider_task_qualifications"

    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    qualified: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    qualified_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    auto_granted: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    approved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="task_qualifications"
    )
    task: Mapped["ServiceTask"] = relationship(
        "ServiceTask", back_populates="provider_qualifications"
    )
    approver: Mapped[Optional["User"]] = relationship("User", foreign_keys=[approved_by])

    def __repr__(self) -> str:
        return (
            f"<ProviderTaskQualification(provider={self.provider_id}, "
            f"task={self.task_id}, qualified={self.qualified})>"
        )
