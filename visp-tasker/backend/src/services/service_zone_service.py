"""Gate de zona de servicio: ¿este punto cae dentro de un área donde operamos?

Reglas de negocio (cliente + Ricardo, 2026-08-10):
  * VISP arranca en un área controlada y se expande añadiendo/ampliando zonas.
  * Se valida la DIRECCIÓN DEL TRABAJO y la dirección base del proveedor.
  * NO se valida el GPS del dispositivo. Un cliente de viaje debe poder reservar
    para su casa dentro de la zona, y el GPS se falsea en dos toques.
  * Si NO hay ninguna zona activa, no se bloquea nada (fail-open). Una tabla
    vacía significa "todavía no configuramos zonas", no "cerrado al mundo": lo
    contrario dejaría la plataforma muerta por un dato ausente.

Ver CLAUDE.md § Service Zones para cómo expandir cobertura sin deploy.
"""

from __future__ import annotations

import math
from dataclasses import dataclass
from decimal import Decimal
from typing import Optional, Sequence

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.service_zone import ServiceZone

EARTH_RADIUS_KM = 6371.0088


class OutsideServiceAreaError(Exception):
    """El punto queda fuera de toda zona activa.

    La ruta la traduce a 4xx, nunca 5xx: `api.richieyanez.com` está detrás de
    Cloudflare, que envuelve los 5xx en su propia página de error y el usuario
    nunca vería nuestro mensaje.
    """

    def __init__(
        self,
        *,
        latitude: float,
        longitude: float,
        nearest_zone: Optional[str] = None,
        nearest_distance_km: Optional[float] = None,
        subject: str = "address",
    ) -> None:
        self.latitude = latitude
        self.longitude = longitude
        self.nearest_zone = nearest_zone
        self.nearest_distance_km = nearest_distance_km
        self.subject = subject

        if nearest_zone and nearest_distance_km is not None:
            msg = (
                f"This {subject} is outside our service area. The closest area we "
                f"cover is {nearest_zone}, about {nearest_distance_km:.0f} km away. "
                f"VISP is expanding area by area — we are not there yet."
            )
        else:
            msg = (
                f"This {subject} is outside our service area. VISP is expanding "
                f"area by area."
            )
        super().__init__(msg)


@dataclass(frozen=True)
class ZoneMatch:
    """Resultado de evaluar un punto contra las zonas activas."""

    zone: Optional[ServiceZone]
    distance_km: float
    inside: bool


def haversine_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """Distancia sobre la superficie terrestre, en km."""
    phi1, phi2 = math.radians(lat1), math.radians(lat2)
    d_phi = phi2 - phi1
    d_lambda = math.radians(lon2 - lon1)
    a = (
        math.sin(d_phi / 2) ** 2
        + math.cos(phi1) * math.cos(phi2) * math.sin(d_lambda / 2) ** 2
    )
    return 2 * EARTH_RADIUS_KM * math.asin(math.sqrt(a))


async def get_active_zones(db: AsyncSession) -> Sequence[ServiceZone]:
    result = await db.execute(
        select(ServiceZone).where(ServiceZone.is_active.is_(True)).order_by(ServiceZone.code)
    )
    return result.scalars().all()


async def locate_point(
    db: AsyncSession, latitude: float, longitude: float
) -> ZoneMatch:
    """Evalúa un punto contra las zonas activas.

    Devuelve la zona que lo CONTIENE si hay alguna; si no, la más cercana con su
    distancia, para poder decirle al usuario cuánto le falta en vez de un "no"
    sin contexto.
    """
    zones = await get_active_zones(db)
    if not zones:
        # Fail-open deliberado: sin zonas configuradas no se bloquea nada.
        return ZoneMatch(zone=None, distance_km=0.0, inside=True)

    best: Optional[ServiceZone] = None
    best_distance = math.inf
    for zone in zones:
        distance = haversine_km(
            latitude,
            longitude,
            float(zone.center_latitude),
            float(zone.center_longitude),
        )
        if distance <= float(zone.radius_km):
            return ZoneMatch(zone=zone, distance_km=distance, inside=True)
        # Distancia al BORDE, no al centro: es lo que el usuario percibe como
        # "me falta tanto para entrar".
        edge_distance = distance - float(zone.radius_km)
        if edge_distance < best_distance:
            best_distance = edge_distance
            best = zone

    return ZoneMatch(zone=best, distance_km=best_distance, inside=False)


async def assert_in_service_area(
    db: AsyncSession,
    latitude: Optional[float | Decimal],
    longitude: Optional[float | Decimal],
    *,
    subject: str = "address",
) -> Optional[ServiceZone]:
    """Lanza ``OutsideServiceAreaError`` si el punto no cae en ninguna zona activa.

    Coordenadas ausentes NO bloquean: hay flujos legítimos sin geocodificar aún.
    Quien exija coordenadas debe validarlo por su cuenta antes de llamar aquí.
    """
    if latitude is None or longitude is None:
        return None

    match = await locate_point(db, float(latitude), float(longitude))
    if match.inside:
        return match.zone

    raise OutsideServiceAreaError(
        latitude=float(latitude),
        longitude=float(longitude),
        nearest_zone=match.zone.name_en if match.zone else None,
        nearest_distance_km=match.distance_km if match.zone else None,
        subject=subject,
    )
