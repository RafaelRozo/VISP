"""
SQLAlchemy model for price_proposals.
Corresponds to migration 011_pricing_model_v2.sql.
"""

import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import BigInteger, DateTime, ForeignKey, String, Text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class PriceProposal(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "price_proposals"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    proposed_by_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    proposed_by_role: Mapped[str] = mapped_column(
        String(20), nullable=False
    )
    proposed_price_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )
    responded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    response_by_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="price_proposals")
    proposed_by: Mapped["User"] = relationship(
        "User", foreign_keys=[proposed_by_id]
    )
    response_by: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[response_by_id]
    )

    def __repr__(self) -> str:
        return (
            f"<PriceProposal(id={self.id}, job={self.job_id}, "
            f"price={self.proposed_price_cents}, status={self.status})>"
        )
