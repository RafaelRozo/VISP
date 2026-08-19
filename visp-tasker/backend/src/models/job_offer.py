"""
SQLAlchemy models para el modelo de ofertas v2 y los materiales.
Corresponden a las migraciones 042_job_offers.sql y 043_service_materials.sql.

El customer postea el trabajo y los proveedores ofertan; el customer elige entre las
ofertas que recibe. Ver docs/plan-ofertas-v2.md.
"""

import uuid
from datetime import datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import (
    BigInteger,
    DateTime,
    Enum,
    ForeignKey,
    Integer,
    Numeric,
    String,
    Text,
)
from sqlalchemy.dialects.postgresql import UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from .base import Base, TimestampMixin, UUIDPrimaryKeyMixin
from .taxonomy import PricingUnit


class OfferStatus(str):
    """Estados de una oferta. Cadenas y no enum de Postgres: la columna es VARCHAR con
    CHECK, así que añadir un estado es un ALTER del CHECK y no la migración aislada que
    exige ALTER TYPE ADD VALUE."""

    PENDING = "pending"
    ACCEPTED = "accepted"
    REJECTED = "rejected"
    WITHDRAWN = "withdrawn"
    EXPIRED = "expired"

    LIVE = ("pending", "accepted")


class MagnitudeSource(str):
    """Quién puso la magnitud de la oferta.

    PROVIDER — la estima el proveedor al ofertar (horas en HOURLY, m² en PER_AREA).
    CUSTOMER — la declaró el cliente al reservar (unidades en PER_UNIT).
    FLAT     — unidad plana (PER_VISIT, FLAT_PACKAGE): siempre 1.
    """

    PROVIDER = "PROVIDER"
    CUSTOMER = "CUSTOMER"
    FLAT = "FLAT"


class JobOffer(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """La puja de un proveedor sobre un trabajo posteado.

    El proveedor NO negocia precio: `rate_cents` es una copia de su tarifa de perfil,
    ya validada contra el rango del catálogo. Lo único que aporta es la magnitud.
    """

    __tablename__ = "job_offers"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    provider_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True),
        ForeignKey("provider_profiles.id", ondelete="CASCADE"),
        nullable=False,
    )

    # Snapshot de la tarifa al ofertar: si el proveedor la sube mañana, la oferta que el
    # cliente está mirando no puede cambiar de precio bajo sus pies.
    unit: Mapped[PricingUnit] = mapped_column(
        Enum(PricingUnit, name="pricing_unit", create_type=False), nullable=False
    )
    rate_cents: Mapped[int] = mapped_column(Integer, nullable=False)

    magnitude: Mapped[Decimal] = mapped_column(Numeric(10, 2), nullable=False)
    magnitude_source: Mapped[str] = mapped_column(String(10), nullable=False)

    subtotal_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    # Impuesto y fee son PARA MOSTRAR ("+tax" real en la tarjeta de la oferta). El
    # importe contable definitivo lo sella el job al aceptar, vía
    # provider_rate_service.reprice_job_to_provider_rate.
    service_tax_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    tax_rate: Mapped[Optional[Decimal]] = mapped_column(Numeric(6, 5), nullable=True)
    service_fee_cents: Mapped[int] = mapped_column(
        BigInteger, nullable=False, server_default="0"
    )
    total_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)

    message: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    status: Mapped[str] = mapped_column(
        String(20), nullable=False, server_default="pending"
    )
    expires_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    responded_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )

    job: Mapped["Job"] = relationship(
        "Job", back_populates="offers", foreign_keys=[job_id]
    )
    provider: Mapped["ProviderProfile"] = relationship(
        "ProviderProfile", lazy="select"
    )

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<JobOffer(job={self.job_id}, provider={self.provider_id}, "
            f"{self.magnitude}×{self.rate_cents}={self.total_cents}, {self.status})>"
        )


class JobMaterialReceipt(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    """Factura de material que sube el proveedor al terminar.

    Una fila por compra: la pintura en una tienda y los rodillos en otra es el caso
    normal. La suma de las no anuladas es `jobs.materials_spent_cents` y se le reembolsa
    íntegra — sin comisión de VISP y sin impuesto encima, porque la tienda ya cobró el
    suyo dentro del importe.
    """

    __tablename__ = "job_material_receipts"

    job_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("jobs.id", ondelete="CASCADE"), nullable=False
    )
    uploaded_by: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("users.id", ondelete="RESTRICT"), nullable=False
    )

    amount_cents: Mapped[int] = mapped_column(BigInteger, nullable=False)
    # Sin foto no hay reembolso: es lo único que separa un gasto real de un número
    # escrito a mano.
    file_url: Mapped[str] = mapped_column(Text, nullable=False)
    merchant: Mapped[Optional[str]] = mapped_column(String(120), nullable=True)
    note: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    # Anulación por el admin en una disputa. No se borra la fila: el importe pudo haber
    # entrado ya en un cobro y el rastro tiene que quedar.
    voided_at: Mapped[Optional[datetime]] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    void_reason: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    job: Mapped["Job"] = relationship("Job", back_populates="material_receipts")

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<JobMaterialReceipt(job={self.job_id}, "
            f"{self.amount_cents}, voided={self.voided_at is not None})>"
        )
