"""
SQLAlchemy model for company job assignments (VISP for Business, SP4 Stage 1).

Corresponds to migration 020_company_job_assignments.sql.

This is ADDITIVE to the provider matching/offer flow. A job is "claimed by a
company" iff a ``CompanyJobAssignment`` row references it. The provider path
(``Job`` / ``JobAssignment``) does not read this table, so the two flows do not
interfere.

Enum members are stored UPPERCASE (native PG enum persists the member NAME),
matching the rest of the codebase (see ``CredentialStatus``, ``JobStatus``).
"""

import enum
import uuid
from datetime import datetime
from typing import Optional

from sqlalchemy import DateTime, Enum, ForeignKey, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class CompanyJobStatus(str, enum.Enum):
    CLAIMED = "claimed"        # supervisor claimed the job for the company
    ASSIGNED = "assigned"      # assigned to a specific collaborator
    ACCEPTED = "accepted"      # collaborator accepted
    DECLINED = "declined"      # collaborator declined
    COMPLETED = "completed"    # work finished
    CANCELLED = "cancelled"    # claim/assignment cancelled


class CompanyPayoutTarget(str, enum.Enum):
    COMPANY = "company"        # payout routed to the company's Stripe account
    INDIVIDUAL = "individual"  # payout routed to the individual (unused for now)


class CompanyJobAssignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "company_job_assignments"
    __table_args__ = (UniqueConstraint("job_id", name="uq_company_job"),)

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    company_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("companies.id", ondelete="CASCADE"),
        nullable=False,
    )
    # The supervisor (or admin) who claimed the job on behalf of the company.
    claimed_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=False,
    )
    # The collaborator the job is assigned to; null until the supervisor assigns.
    assigned_collaborator_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    status: Mapped[CompanyJobStatus] = mapped_column(
        Enum(CompanyJobStatus, name="company_job_status", create_type=False),
        nullable=False,
        server_default="CLAIMED",
    )
    # Payout routing for this job. Company-claimed jobs pay the company account.
    payout_target: Mapped[CompanyPayoutTarget] = mapped_column(
        Enum(CompanyPayoutTarget, name="company_payout_target", create_type=False),
        nullable=False,
        server_default="COMPANY",
    )

    claimed_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("now()")
    )
    assigned_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    responded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decline_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships — kept simple to avoid back_populates churn on existing
    # models. Use selectinload in any async route that serializes these.
    company: Mapped["Company"] = relationship("Company", lazy="selectin")  # noqa: F821
    job: Mapped["Job"] = relationship("Job", lazy="selectin")  # noqa: F821

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<CompanyJobAssignment(id={self.id}, job={self.job_id}, "
            f"company={self.company_id}, status={self.status})>"
        )
