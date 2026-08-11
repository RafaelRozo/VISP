"""Zonas de operación de VISP (migración 036).

VISP se lanza área por área, al estilo Uber. La zona NO es la provincia: Ontario
mide más de 1.000 km (Toronto-Thunder Bay son 1.400 km), así que un filtro por
provincia permite exactamente el registro aislado lejísimo del resto que el
modelo de zonas existe para evitar.

El gate se aplica sobre la DIRECCIÓN donde ocurre el trabajo y sobre la dirección
base del proveedor. NO sobre el GPS del dispositivo: el GPS bloquea el testeo
propio desde fuera del país y se falsea trivialmente, así que no controla nada.

Para expandir cobertura no hace falta deploy — ver CLAUDE.md § Service Zones.
"""

from __future__ import annotations

from decimal import Decimal
from typing import Optional

from sqlalchemy import Boolean, CHAR, Numeric, String, Text
from sqlalchemy.orm import Mapped, mapped_column

from src.models.base import Base, TimestampMixin, UUIDPrimaryKeyMixin


class ServiceZone(UUIDPrimaryKeyMixin, TimestampMixin, Base):
    __tablename__ = "service_zones"

    code: Mapped[str] = mapped_column(String(40), nullable=False, unique=True)
    name_en: Mapped[str] = mapped_column(String(120), nullable=False)
    name_fr: Mapped[str] = mapped_column(String(120), nullable=False)

    center_latitude: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    center_longitude: Mapped[Decimal] = mapped_column(Numeric(10, 7), nullable=False)
    radius_km: Mapped[Decimal] = mapped_column(Numeric(6, 2), nullable=False)

    # Jurisdicción informativa/fiscal. El gate geográfico es centro+radio, NO esta
    # columna: no filtrar por aquí o se pierde el sentido de la zona.
    country: Mapped[str] = mapped_column(CHAR(2), nullable=False, server_default="CA")
    province_state: Mapped[str] = mapped_column(String(10), nullable=False)

    is_active: Mapped[bool] = mapped_column(Boolean, nullable=False, server_default="true")
    notes: Mapped[Optional[str]] = mapped_column(Text, nullable=True)

    def __repr__(self) -> str:  # pragma: no cover - debug helper
        return (
            f"<ServiceZone {self.code} "
            f"({self.center_latitude},{self.center_longitude}) r={self.radius_km}km>"
        )
