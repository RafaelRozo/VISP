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

    # Customer-confirmed booking quantity (PP4a) — multiplier applied to the
    # provider's rate at reprice. NULL → fall back to the catalog estimate.
    quantity: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(10, 2), nullable=True
    )

    # Tax snapshot (PP3). service_tax_cents = subtotal × rate, 0 when the
    # provider is not tax-registered. total_charged = subtotal + tax + tip.
    service_tax_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    tax_rate_applied: Mapped[Optional[Decimal]] = mapped_column(
        Numeric(6, 5), nullable=True
    )
    tax_jurisdiction: Mapped[Optional[str]] = mapped_column(String(40), nullable=True)
    total_charged_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )

    # Service fee + overage (PP4c). service_fee = grossed-up Stripe fee the
    # customer covers (Model C). authorized_amount = the held ceiling
    # (total_charged × (1+capture_buffer)); actual_total reconciled at close;
    # overage_approved_at set when the customer OKs charging above the ceiling.
    service_fee_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    authorized_amount_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    capture_buffer_pct: Mapped[Decimal] = mapped_column(
        Numeric(4, 3), nullable=False, server_default="0.300"
    )
    actual_total_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    overage_approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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

    # Detalles y evidencia que aporta el CLIENTE al reservar (migración 038).
    #
    # `customer_details` es CONTEXTO DE EJECUCIÓN del servicio ya elegido y
    # cotizado ("2 habitaciones, 2 baños"), NO un cambio de alcance: no altera
    # precio, nivel ni SLA, que salen del catálogo. Si el trabajo resulta mayor de
    # lo previsto, el camino correcto es accept+reprice del proveedor, no este
    # texto. Mantener esa frontera es lo que conserva la regla del catálogo
    # cerrado y la de "el proveedor no decide el alcance".
    customer_details: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    customer_extra_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    # Respuestas a las preguntas del servicio (migración 039). Cada entrada es
    # {questionId, question, answer}: se guarda el TEXTO de la pregunta además del
    # id para que el job siga siendo legible si el admin la reescribe o la
    # desactiva — hace falta para resolver una disputa meses después.
    customer_answers_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )

    # Photos
    #
    # OJO: `customer_evidence_json` son las fotos del CLIENTE al reservar;
    # `photos_before_json` son las del PROVEEDOR al iniciar. Mezclarlas haría
    # imposible saber quién aportó qué en una disputa.
    customer_evidence_json: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )
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

    # Ofertas (migración 042). El trabajo se postea y los proveedores ofertan; el
    # customer elige entre las que recibe. `accepted_offer_id` queda NULL mientras el
    # trabajo sigue abierto.
    accepted_offer_id: Mapped[Optional[uuid.UUID]] = mapped_column(
        UUID(as_uuid=True), ForeignKey("job_offers.id", ondelete="SET NULL"),
        nullable=True,
    )
    offers_close_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    # Materiales (migración 043). Lo decide el CLIENTE al reservar aunque el servicio lo
    # permita: si no los pide, la reserva se comporta igual que siempre.
    #
    # El material se reembolsa ÍNTEGRO al proveedor: no paga comisión y no se le aplica
    # impuesto encima, porque la tienda ya cobró el suyo dentro del importe de la
    # factura. Ver docs/plan-ofertas-v2.md §9.
    materials_requested: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # Lo que dijo el CLIENTE al reservar. Informativo: le indica al proveedor que hay
    # que comprar material y cuánto tenía pensado. NO es el techo del cobro.
    materials_budget_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    # Lo que cotizó el PROVEEDOR en la oferta aceptada (migración 045). Este sí es el
    # techo acordado: es contra este número contra el que se mide el exceso.
    materials_estimate_cents: Mapped[Optional[int]] = mapped_column(
        BigInteger, nullable=True
    )
    materials_spent_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    # Aprobación del exceso sobre el presupuesto de MATERIAL. Distinta de
    # `overage_approved_at`, que es el exceso de la mano de obra: son dos excesos y el
    # cliente puede aceptar uno y rechazar el otro.
    materials_overage_approved_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

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
    # foreign_keys explícito: hay DOS caminos entre jobs y job_offers (la lista de
    # ofertas y la que ganó), y sin esto SQLAlchemy no sabe cuál usar en cada lado.
    offers: Mapped[list["JobOffer"]] = relationship(
        "JobOffer",
        back_populates="job",
        cascade="all, delete-orphan",
        foreign_keys="JobOffer.job_id",
    )
    accepted_offer: Mapped[Optional["JobOffer"]] = relationship(
        "JobOffer", foreign_keys=[accepted_offer_id], post_update=True
    )
    material_receipts: Mapped[list["JobMaterialReceipt"]] = relationship(
        "JobMaterialReceipt", back_populates="job", cascade="all, delete-orphan"
    )

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


class JobCancellationReport(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Cancelación con motivo tras la llegada (migración 041).

    La cancelación en sí es GRATIS e inmediata. Lo que se guarda aquí es el
    reporte, y lo que el admin decide al revisarlo es si debe afectar la
    calificación del otro — nunca automáticamente.
    """

    __tablename__ = "job_cancellation_reports"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    reported_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )
    # 'customer' | 'provider'. El mismo código significa cosas distintas según
    # quién lo reporte.
    reporter_role: Mapped[str] = mapped_column(String(10), nullable=False)

    reason_code: Mapped[str] = mapped_column(String(40), nullable=False)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # PENDING | UPHELD | DISMISSED
    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="PENDING"
    )
    # Solo lo pone el admin. Marcarlo automáticamente convertiría el reporte en un
    # arma contra la calificación del otro.
    rating_impact: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    admin_note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    reviewed_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    def __repr__(self) -> str:  # pragma: no cover
        return (
            f"<JobCancellationReport(job={self.job_id}, {self.reporter_role}, "
            f"{self.reason_code}, {self.status})>"
        )
