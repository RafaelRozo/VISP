"""
SQLAlchemy model for province_tax_rates (Provider-Set Pricing · PP3).

One row per Canadian province/territory. ``combined_rate`` is the single rate
applied to a job subtotal; the gst/pst/hst breakdown is retained for receipts
and future per-component remittance. Place of supply for a service = where it
is performed, so callers key the lookup on ``jobs.service_province_state``.
Corresponds to migration 024_tax_engine.sql.
"""

from datetime import date, datetime
from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, Date, DateTime, Numeric, String, func
from sqlalchemy.orm import Mapped, mapped_column

from .base import Base


class ProvinceTaxRate(Base):
    """Sales-tax rate for a single Canadian jurisdiction."""

    __tablename__ = "province_tax_rates"

    province_code: Mapped[str] = mapped_column(String(2), primary_key=True)
    country_code: Mapped[str] = mapped_column(
        String(2), nullable=False, server_default="CA"
    )
    province_name: Mapped[str] = mapped_column(String(60), nullable=False)
    tax_type: Mapped[str] = mapped_column(String(20), nullable=False)
    gst_rate: Mapped[Decimal] = mapped_column(
        Numeric(6, 5), nullable=False, server_default="0"
    )
    pst_rate: Mapped[Decimal] = mapped_column(
        Numeric(6, 5), nullable=False, server_default="0"
    )
    hst_rate: Mapped[Decimal] = mapped_column(
        Numeric(6, 5), nullable=False, server_default="0"
    )
    combined_rate: Mapped[Decimal] = mapped_column(Numeric(6, 5), nullable=False)
    label: Mapped[str] = mapped_column(String(40), nullable=False)
    is_active: Mapped[bool] = mapped_column(
        Boolean, nullable=False, server_default="true"
    )
    effective_date: Mapped[date] = mapped_column(
        Date, nullable=False, server_default="2025-01-01"
    )
    created_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), nullable=False
    )

    def __repr__(self) -> str:
        return (
            f"<ProvinceTaxRate {self.province_code} "
            f"{self.tax_type} {self.combined_rate}>"
        )
