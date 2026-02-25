"""
SQLAlchemy models for jobs, job_assignments, and job_escalations.
Corresponds to migration 005_create_jobs.sql.
"""

import enum
import uuid
from datetime import date, datetime, time
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
    Time,
    func,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider import ProviderLevel


class JobStatus(str, enum.Enum):
    DRAFT = "draft"
    PENDING_MATCH = "pending_match"
    MATCHED = "matched"
    PENDING_APPROVAL = "pending_approval"      # provider interested, customer reviewing
    PENDING_PRICE_AGREEMENT = "pending_price_agreement"  # L3/L4 price negotiation
    SCHEDULED = "scheduled"                    # customer approved, waiting for job day
    PROVIDER_ACCEPTED = "provider_accepted"    # legacy / direct accept
    PROVIDER_EN_ROUTE = "provider_en_route"
    IN_PROGRESS = "in_progress"
    COMPLETED = "completed"
    CANCELLED_BY_CUSTOMER = "cancelled_by_customer"
    CANCELLED_BY_PROVIDER = "cancelled_by_provider"
    CANCELLED_BY_SYSTEM = "cancelled_by_system"
    DISPUTED = "disputed"
    REFUNDED = "refunded"


class JobPriority(str, enum.Enum):
    STANDARD = "standard"
    PRIORITY = "priority"
    URGENT = "urgent"
    EMERGENCY = "emergency"


class AssignmentStatus(str, enum.Enum):
    OFFERED = "offered"
    ACCEPTED = "accepted"
    DECLINED = "declined"
    EXPIRED = "expired"
    CANCELLED = "cancelled"
    COMPLETED = "completed"


class EscalationType(str, enum.Enum):
    KEYWORD_DETECTED = "keyword_detected"
    MANUAL_ESCALATION = "manual_escalation"
    SAFETY_CONCERN = "safety_concern"
    SLA_BREACH = "sla_breach"
    CUSTOMER_REQUEST = "customer_request"
    SYSTEM_AUTO = "system_auto"


class Job(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "jobs"

    # Reference number (human-readable)
    reference_number: Mapped[str] = mapped_column(
        String(20), unique=True, nullable=False
    )

    # Parties
    customer_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Task from closed catalog (business rule: no free text)
    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_tasks.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Job details
    status: Mapped[JobStatus] = mapped_column(
        Enum(JobStatus, name="job_status", create_type=False),
        nullable=False,
        server_default="DRAFT",
    )
    priority: Mapped[JobPriority] = mapped_column(
        Enum(JobPriority, name="job_priority", create_type=False),
        nullable=False,
        server_default="STANDARD",
    )
    is_emergency: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)

    # Location
    service_latitude: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    service_longitude: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    service_address: Mapped[str] = mapped_column(Text, nullable=False)
    service_unit: Mapped[Optional[str]] = mapped_column(String(50), nullable=True)
    service_city: Mapped[Optional[str]] = mapped_column(String(100), nullable=True)
    service_province_state: Mapped[Optional[str]] = mapped_column(
        String(100), nullable=True
    )
    service_postal_zip: Mapped[Optional[str]] = mapped_column(String(20), nullable=True)
    service_country: Mapped[str] = mapped_column(
        String(2), nullable=False, server_default="CA"
    )

    # Scheduling
    requested_date: Mapped[Optional[date]] = mapped_column(Date, nullable=True)
    requested_time_start: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    requested_time_end: Mapped[Optional[time]] = mapped_column(Time, nullable=True)
    flexible_schedule: Mapped[bool] = mapped_column(
        Boolean, nullable=False, default=False
    )

    # SLA snapshot (immutable copy from sla_profiles at job creation)
    sla_response_time_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sla_arrival_time_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sla_completion_time_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    sla_profile_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), nullable=True
    )
    sla_snapshot_json: Mapped[Optional[Any]] = mapped_column(JSONB, nullable=True)

    # Pricing snapshot
    quoted_price_cents: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    final_price_cents: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    commission_rate: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 4), nullable=True
    )
    commission_amount_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    provider_payout_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    currency: Mapped[str] = mapped_column(String(3), nullable=False, server_default="CAD")

    # Pricing model v2
    pricing_model: Mapped[Optional[str]] = mapped_column(
        Enum('TIME_BASED', 'NEGOTIATED', 'EMERGENCY_NEGOTIATED',
             name='pricing_model', create_type=False),
        nullable=True,
    )
    hourly_rate_cents: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    actual_duration_minutes: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)
    proposed_price_cents: Mapped[Optional[int]] = mapped_column(BigInteger, nullable=True)
    price_agreed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    tip_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, server_default="0", nullable=True
    )
    tip_paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Payment
    stripe_payment_intent_id: Mapped[Optional[str]] = mapped_column(
        String(255), nullable=True
    )
    paid_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Customer notes (selected from predefined options, NOT free text)
    customer_notes_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )

    # Photos
    photos_before_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )
    photos_after_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )

    # Completion
    started_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancelled_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    cancellation_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    customer: Mapped["User"] = relationship(
        "User", back_populates="customer_jobs", foreign_keys=[customer_id]
    )
    task: Mapped["ServiceTask"] = relationship("ServiceTask", back_populates="jobs")
    assignments: Mapped[list["JobAssignment"]] = relationship(
        "JobAssignment", back_populates="job", cascade="all, delete-orphan"
    )
    escalations: Mapped[list["JobEscalation"]] = relationship(
        "JobEscalation", back_populates="job", cascade="all, delete-orphan"
    )
    pricing_events: Mapped[list["PricingEvent"]] = relationship(
        "PricingEvent", back_populates="job"
    )
    price_proposals: Mapped[list["PriceProposal"]] = relationship(
        "PriceProposal", back_populates="job", cascade="all, delete-orphan"
    )
    tips: Mapped[list["Tip"]] = relationship("Tip", back_populates="job")
    reviews: Mapped[list["Review"]] = relationship("Review", back_populates="job")

    def __repr__(self) -> str:
        return (
            f"<Job(id={self.id}, ref={self.reference_number}, "
            f"status={self.status}, emergency={self.is_emergency})>"
        )


class JobAssignment(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "job_assignments"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="RESTRICT"),
        nullable=False,
    )

    # Status
    status: Mapped[AssignmentStatus] = mapped_column(
        Enum(AssignmentStatus, name="assignment_status", create_type=False),
        nullable=False,
        server_default="OFFERED",
    )

    # Offer details
    offered_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True),
        nullable=False,
        server_default=func.now(),
    )
    offer_expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Response
    responded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    decline_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # SLA tracking
    sla_response_deadline: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sla_arrival_deadline: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sla_completion_deadline: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    sla_response_met: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    sla_arrival_met: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)
    sla_completion_met: Mapped[Optional[bool]] = mapped_column(Boolean, nullable=True)

    # Provider location at accept
    accept_latitude: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 7), nullable=True
    )
    accept_longitude: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 7), nullable=True
    )
    estimated_arrival_min: Mapped[Optional[int]] = mapped_column(Integer, nullable=True)

    # Actual timestamps
    en_route_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    arrived_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    started_work_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    completed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Scoring input
    match_score: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(5, 2), nullable=True
    )

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="assignments")
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", back_populates="job_assignments"
    )

    def __repr__(self) -> str:
        return (
            f"<JobAssignment(id={self.id}, job={self.job_id}, "
            f"provider={self.provider_id}, status={self.status})>"
        )


class JobEscalation(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "job_escalations"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("jobs.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Escalation details
    escalation_type: Mapped[EscalationType] = mapped_column(
        Enum(EscalationType, name="escalation_type", create_type=False),
        nullable=False,
    )
    from_level: Mapped[Optional[ProviderLevel]] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=True,
    )
    to_level: Mapped[Optional[ProviderLevel]] = mapped_column(
        Enum(ProviderLevel, name="provider_level", create_type=False),
        nullable=True,
    )

    # What triggered it
    trigger_keyword: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    trigger_description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Resolution
    resolved: Mapped[bool] = mapped_column(Boolean, nullable=False, default=False)
    resolved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    resolved_by: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("users.id"),
        nullable=True,
    )
    resolution_notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Relationships
    job: Mapped["Job"] = relationship("Job", back_populates="escalations")
    resolver: Mapped[Optional["User"]] = relationship(
        "User", foreign_keys=[resolved_by]
    )

    def __repr__(self) -> str:
        return (
            f"<JobEscalation(id={self.id}, job={self.job_id}, "
            f"type={self.escalation_type}, resolved={self.resolved})>"
        )
