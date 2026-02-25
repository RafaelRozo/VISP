"""
SQLAlchemy models for pricing_rules, pricing_events, and commission_schedules.
Corresponds to migration 007_create_pricing.sql.
"""

import enum
import uuid
from datetime import date, datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    BigInteger,
    Boolean,
    Date,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider import ProviderLevel


class PricingRuleType(str, enum.Enum):
    BASE_RATE = "base_rate"
    TIME_MULTIPLIER = "time_multiplier"
    DEMAND_SURGE = "demand_surge"
    EMERGENCY_PREMIUM = "emergency_premium"
    DISTANCE_ADJUSTMENT = "distance_adjustment"
    LEVEL_PREMIUM = "level_premium"
    HOLIDAY_SURCHARGE = "holiday_surcharge"
    OFF_HOURS_SURCHARGE = "off_hours_surcharge"
    LOYALTY_DISCOUNT = "loyalty_discount"
    PROMOTIONAL = "promotional"


class PricingEventType(str, enum.Enum):
    QUOTE_GENERATED = "quote_generated"
    PRICE_CONFIRMED = "price_confirmed"
    PRICE_ADJUSTED = "price_adjusted"
    DISCOUNT_APPLIED = "discount_applied"
    SURCHARGE_APPLIED = "surcharge_applied"
    REFUND_CALCULATED = "refund_calculated"
    PRICE_PROPOSED = "price_proposed"
    PRICE_ACCEPTED = "price_accepted"
    TIP_ADDED = "tip_added"
    TIME_BASED_CALCULATED = "time_based_calculated"


class PricingRule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "pricing_rules"

    # Scope
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    rule_type: Mapped[PricingRuleType] = mapped_column(
        Enum(PricingRuleType, name="pricing_rule_type", create_type=False),
        nullable=False,
    )

    # Targeting (all optional; NULL = applies globally)
    level: Mapped[Optional[ProviderLevel]] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=True,
    )
    task_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_tasks.id", ondelete="SET NULL"),
        nullable=True,
    )
    region_value: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    country: Mapped[Optional[str]] = mapped_column(String(2), nullable=True)

    # Multiplier range
    multiplier_min: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, server_default="1.0000"
    )
    multiplier_max: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, server_default="1.0000"
    )

    # Flat adjustments (in cents)
    flat_adjustment_cents: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    # Conditions (JSON: time ranges, demand thresholds, etc.)
    conditions_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'{}'::jsonb"), nullable=False
    )

    # Priority (higher wins on conflict)
    priority_order: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )

    # Stacking
    stackable: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Activation
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    # Relationships
    task: Mapped[Optional["ServiceTask"]] = relationship(
        "ServiceTask", back_populates="pricing_rules"
    )

    def __repr__(self) -> str:
        return (
            f"<PricingRule(id={self.id}, name={self.name}, "
            f"type={self.rule_type}, active={self.is_active})>"
        )


class PricingEvent(Base):
    """
    Immutable pricing event audit trail.
    No updated_at column by design.
    """
    __tablename__ = "pricing_events"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        primary_key=True,
        default=uuid.uuid4,
        server_default=func.gen_random_uuid(),
    )

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="RESTRICT"),
        nullable=False,
    )
    event_type: Mapped[PricingEventType] = mapped_column(
        Enum(PricingEventType, name="pricing_event_type", create_type=False),
        nullable=False,
    )

    # Calculation breakdown
    base_price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    multiplier_applied: Mapped[Decimal] = mapped_column(
        Numeric(6, 4), nullable=False, server_default="1.0000"
    )
    adjustments_cents: Mapped[int] = mapped_column(
        Integer, nullable=False, server_default="0"
    )
    final_price_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Which rules were applied (array of rule IDs + their values)
    rules_applied_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )

    # Commission calculated
    commission_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4), nullable=True
    )
    commission_cents: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    provider_payout_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="CAD")

    # Context at calculation time
    demand_factor: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(4, 2), nullable=True
    )
    distance_km: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(8, 2), nullable=True
    )

    # Actor
    calculated_by: Mapped[str] = mapped_column(
        String(50), nullable=False, server_default="system"
    )

    # Immutable timestamp -- no updated_at
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="pricing_events")

    def __repr__(self) -> str:
        return (
            f"<PricingEvent(id={self.id}, job={self.job_id}, "
            f"type={self.event_type}, final={self.final_price_cents})>"
        )


class CommissionSchedule(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "commission_schedules"

    level: Mapped[ProviderLevel] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=False,
    )

    # Commission range
    commission_rate_min: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), nullable=False
    )
    commission_rate_max: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), nullable=False
    )
    commission_rate_default: Mapped[Decimal] = mapped_column(
        Numeric(5, 4), nullable=False
    )

    # Applicability
    country: Mapped[str] = mapped_column(String(2), nullable=False, server_default="CA")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)
    effective_from: Mapped[date] = mapped_column(Date, nullable=False)
    effective_until: Mapped[Optional[date]] = mapped_column(Date, nullable=True)

    def __repr__(self) -> str:
        return (
            f"<CommissionSchedule(id={self.id}, level={self.level}, "
            f"rate={self.commission_rate_default})>"
        )
