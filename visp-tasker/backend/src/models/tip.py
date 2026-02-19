"""
SQLAlchemy model for tips.
Corresponds to migration 011_pricing_model_v2.sql.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, func
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, UUIDPrimaryKeyMixin


class Tip(UUIDPrimaryKeyMixin, Base):
    """
    Tip record for a completed job.
    No updated_at column — tips are immutable once created (status transitions only).
    """
    __tablename__ = "tips"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="RESTRICT"),
        nullable=False,
    )
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id"),
        nullable=False,
    )
    amount_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False
    )
    stripe_payment_intent_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        server_default=func.now(),
        nullable=False,
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="tips")
    customer: Mapped["User"] = relationship("User", foreign_keys=[customer_id])
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", foreign_keys=[provider_id]
    )

    def __repr__(self) -> str:
        return (
            f"<Tip(id={self.id}, job={self.job_id}, "
            f"amount={self.amount_cents}, status={self.status})>"
        )
