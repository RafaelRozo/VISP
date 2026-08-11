"""
SQLAlchemy models for service_categories, service_tasks, and provider_task_qualifications.
Corresponds to migration 003_create_taxonomy.sql.
"""

import enum
import uuid
from datetime import datetime
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import (
    Boolean,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
    text,
)
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .provider import ProviderLevel


class PricingUnit(str, enum.Enum):
    """How a task is charged. Property of the TASK (closed catalog rule) —
    the provider sets the rate, never the unit. DB labels are the UPPERCASE
    member names (see migration 021)."""

    HOURLY = "hourly"
    PER_UNIT = "per_unit"
    PER_AREA = "per_area"
    PER_LINEAR_M = "per_linear_m"
    PER_VISIT = "per_visit"
    FLAT_PACKAGE = "flat_package"
    CUSTOM_QUOTE = "custom_quote"


class ServiceCategory(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_categories"

    slug: Mapped[str] = mapped_column(String(100), unique=True, nullable=False)
    name: Mapped[str] = mapped_column(String(200), nullable=False)
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    icon_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    display_order: Mapped[int] = mapped_column(Integer, nullable=False, server_default="0")
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, default=True)

    # Section-level gating (migration 029). When TRUE the whole section is gated:
    # only providers who have had a section document approved (LEVEL_2+) can offer
    # or be matched to its services. Services themselves are plain checkboxes.
    requires_credential: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # Bilingual (EN/FR) help pop-up shown in-app before uploading this section's
    # document (e.g. "You need a valid Ontario municipal plumber licence, e.g. G-185237").
    help_message_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    help_message_fr: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

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

    # How this task is charged (PP1). The provider sets the rate against this
    # unit; the unit itself is fixed by the catalog.
    pricing_unit: Mapped[PricingUnit] = mapped_column(
        Enum(PricingUnit, name="pricing_unit", create_type=False),
        nullable=False,
        server_default="HOURLY",
    )
    allows_quantity: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("true")
    )
    min_quantity: Mapped[Decimal] = mapped_column(
        Numeric(10, 2), nullable=False, server_default=text("1")
    )

    # Requisitos de ENTRADA DE LA RESERVA (migración 038). Dos flags y no uno
    # porque son independientes: en un paseo de perros los detalles no aportan
    # pero la nota sí, y en un daño la foto vale más que la prosa.
    # No confundir con `service_credential_requirements`, que es lo que debe tener
    # el PROVEEDOR; esto es lo que debe aportar el CLIENTE al reservar.
    requires_details: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    requires_evidence: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default=text("false")
    )
    # Placeholder del campo de detalles para ESTE servicio, editable en el admin.
    # Es la pieza que mantiene el campo dentro de la regla del catálogo cerrado:
    # guía a describir escala y acceso del servicio ya elegido, no a pedir tareas
    # nuevas. Un placeholder genérico invita a pedir lo que no está cotizado.
    details_prompt_en: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    details_prompt_fr: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Auto-escalation keywords (JSON array of strings)
    escalation_keywords: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
    )

    # Curated search synonyms/aliases (JSON array of strings) — boosts
    # natural-language matching in search_tasks. See migration 023.
    search_aliases: Mapped[Any] = mapped_column(
        JSONB, server_default=text("'[]'::jsonb"), nullable=False
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


class CredentialRequirement(Base):
    """Catálogo de códigos de credencial (306A, ESA_LEC, TSSA_G2, SMART_SERVE...).

    Migración 032. La clave primaria es el propio código para que las tablas que
    lo referencian sean legibles sin hacer join.
    """

    __tablename__ = "credential_requirements"

    code: Mapped[str] = mapped_column(String(40), primary_key=True)
    # Dónde verifica el motor este requisito (migración 034):
    #   CREDENTIAL -> provider_credentials + provider_credential_codes
    #   INSURANCE  -> provider_insurance_policies (NO es una credencial)
    #   PERMIT     -> ligado al TRABAJO, no al proveedor; se exige por reserva
    kind: Mapped[str] = mapped_column(
        Enum(
            "CREDENTIAL",
            "INSURANCE",
            "PERMIT",
            name="credential_requirement_kind",
            create_type=False,
        ),
        nullable=False,
        server_default=text("'CREDENTIAL'"),
    )
    label_en: Mapped[str] = mapped_column(String(200), nullable=False)
    label_fr: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    authority: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    registry_name: Mapped[Optional[str]] = mapped_column(String(200), nullable=True)
    registry_url: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    verification_method: Mapped[str] = mapped_column(
        Enum(
            "REGISTRY",
            "DOCUMENT",
            "SELF_DECLARED",
            name="credential_verification_method",
            create_type=False,
        ),
        nullable=False,
        server_default=text("'DOCUMENT'"),
    )
    description: Mapped[Optional[str]] = mapped_column(Text, nullable=True)
    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), nullable=False, server_default=text("NOW()")
    )

    def __repr__(self) -> str:
        return f"<CredentialRequirement({self.code})>"


class ServiceCredentialRequirement(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Qué códigos de credencial exige un SERVICIO concreto (migración 032).

    Es la pieza que hace que el gate de L2/L3 sea por servicio y no por sección.

    ``mandatory=True``  -> obligatorio siempre.
    ``mandatory=False`` -> condicional o alternativo (los casos "306A y/o 309A"
    del PDF). Regla del motor: si un servicio no tiene NINGÚN requisito
    obligatorio, se exige al menos UNO de los marcados como no obligatorios.
    """

    __tablename__ = "service_credential_requirements"

    task_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("service_tasks.id", ondelete="CASCADE"),
        nullable=False,
    )
    code: Mapped[str] = mapped_column(
        String(40), ForeignKey("credential_requirements.code"), nullable=False
    )
    mandatory: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default=text("true"))
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    requirement: Mapped["CredentialRequirement"] = relationship("CredentialRequirement")

    def __repr__(self) -> str:
        return f"<ServiceCredentialRequirement(task={self.task_id}, code={self.code})>"
