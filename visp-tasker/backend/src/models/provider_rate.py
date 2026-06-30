"""
SQLAlchemy model for provider-set service rates (Provider-Set Pricing · PP2).
Corresponds to migration 022_provider_service_rates.sql.
"""

import uuid
from typing import Optional

from sqlalchemy import Boolean, Enum, ForeignKey, Integer, UniqueConstraint
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .taxonomy import PricingUnit


class ProviderServiceRate(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """A provider's own rate for a service they are qualified for.

    `rate_cents` is clamped (in the service layer) to the task's
    base_price_min_cents..base_price_max_cents guardrail. `unit` is
    snapshotted from the task when the rate is set.
    """

    __tablename__ = "provider_service_rates"
    __table_args__ = (
        UniqueConstraint("provider_id", "task_id", name="uq_provider_service_rate"),
    )

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
    unit: Mapped[PricingUnit] = mapped_column(
        Enum(PricingUnit, name="pricing_unit", create_type=False),
        nullable=False,
    )
    rate_cents: Mapped[int] = mapped_column(Integer, nullable=False)
    min_charge_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    task: Mapped["ServiceTask"] = relationship("ServiceTask", lazy="select")

    def __repr__(self) -> str:
        return (
            f"<ProviderServiceRate(provider={self.provider_id}, "
            f"task={self.task_id}, unit={self.unit}, rate_cents={self.rate_cents})>"
        )
