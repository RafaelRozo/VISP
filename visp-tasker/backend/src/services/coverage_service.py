"""
Cobertura: qué servicios tienen proveedores y dónde están esos proveedores.

Lo pide el cliente para decidir dónde poner anuncios: no tiene sentido anunciar
"Dog Walking" en una ciudad donde nadie lo ofrece. Alimenta la página Coverage
del admin, que lo muestra por servicio y por ciudad.

Un proveedor cuenta en un servicio de dos formas distintas, y se muestran las dos:
- **seleccionado**: lo marcó en My Services (`provider_task_qualifications`).
- **con precio**: además fijó su tarifa (`provider_service_rates`). Sin precio no
  puede ofertar, así que un servicio seleccionado por varios pero sin ningún
  precio sigue sin cobertura real.

La ubicación es la de la dirección BASE del proveedor (`home_*`), la misma que usa
el matching y el gate de zonas; nunca el GPS. Solo ciudad y provincia: la
dirección completa ya está en Users para quien la necesite.

No se usa `provider_can_bid`: ese predicado evalúa un trabajo concreto (agenda,
bloqueos, cliente). Aquí no hay trabajo; es una foto de la oferta.
"""

from __future__ import annotations

from typing import Any

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.provider import ProviderProfile, ProviderProfileStatus
from src.models.provider_rate import ProviderServiceRate
from src.models.taxonomy import ProviderTaskQualification, ServiceCategory, ServiceTask
from src.models.user import User, UserStatus
from src.services import service_zone_service

# Las mismas cuentas que el matching deja fuera (matchingEngine._BLOCKED_*):
# un proveedor suspendido no es oferta real.
_BLOCKED_USER_STATUSES = (UserStatus.SUSPENDED, UserStatus.DEACTIVATED, UserStatus.BANNED)
_BLOCKED_PROFILE_STATUSES = (ProviderProfileStatus.SUSPENDED, ProviderProfileStatus.INACTIVE)


def _enum_value(v: Any) -> Any:
    return v.value if hasattr(v, "value") else v


def _clean_city(city: str | None) -> str | None:
    """'  burlington ' -> 'Burlington', para que la misma ciudad no salga dos veces."""
    if not city or not city.strip():
        return None
    return " ".join(w.capitalize() for w in city.strip().split())


async def get_coverage(db: AsyncSession) -> dict[str, Any]:
    rows = (
        await db.execute(
            select(ProviderProfile, User)
            .join(User, User.id == ProviderProfile.user_id)
            .where(
                User.deleted_at.is_(None),
                User.status.notin_(_BLOCKED_USER_STATUSES),
                ProviderProfile.status.notin_(_BLOCKED_PROFILE_STATUSES),
            )
        )
    ).all()

    zones = await service_zone_service.get_active_zones(db)
    providers: dict[Any, dict[str, Any]] = {}
    for p, u in rows:
        in_zone = None
        zone_name = None
        distance_km = None
        if p.home_latitude is not None and p.home_longitude is not None:
            match = await service_zone_service.locate_point(
                db, float(p.home_latitude), float(p.home_longitude), zones=zones
            )
            in_zone = match.inside
            zone_name = match.zone.name_en if match.zone else None
            # Fuera de zona: lo que le falta para entrar (distancia al borde).
            distance_km = None if match.inside else round(match.distance_km, 1)
        name = " ".join(x for x in (u.first_name, u.last_name) if x).strip()
        providers[p.id] = {
            "id": str(p.id),
            "name": u.display_name or name or u.email,
            "email": u.email,
            "city": _clean_city(p.home_city),
            "province": (p.home_province_state or "").strip().upper() or None,
            "online": bool(p.is_online),
            "inZone": in_zone,
            "zoneName": zone_name,
            "kmOutsideZone": distance_km,
            "servicesSelected": 0,
            "servicesPriced": 0,
        }

    ids = list(providers)
    qualified: dict[Any, set] = {}
    priced: dict[Any, dict[Any, ProviderServiceRate]] = {}
    if ids:
        for q in (
            await db.execute(
                select(ProviderTaskQualification).where(
                    ProviderTaskQualification.provider_id.in_(ids),
                    ProviderTaskQualification.qualified.is_(True),
                )
            )
        ).scalars():
            qualified.setdefault(q.task_id, set()).add(q.provider_id)
        for r in (
            await db.execute(
                select(ProviderServiceRate).where(
                    ProviderServiceRate.provider_id.in_(ids),
                    ProviderServiceRate.is_active.is_(True),
                    ProviderServiceRate.rate_cents.is_not(None),
                )
            )
        ).scalars():
            priced.setdefault(r.task_id, {})[r.provider_id] = r

    tasks = (
        await db.execute(
            select(ServiceTask, ServiceCategory.name)
            .join(ServiceCategory, ServiceCategory.id == ServiceTask.category_id)
            .where(ServiceTask.is_active.is_(True), ServiceCategory.is_active.is_(True))
            .order_by(ServiceCategory.display_order, ServiceCategory.name, ServiceTask.name)
        )
    ).all()

    services: list[dict[str, Any]] = []
    for t, category in tasks:
        sel = qualified.get(t.id, set())
        rates = priced.get(t.id, {})
        # Un precio sin el servicio seleccionado no cuenta: no puede ofertar.
        entries = []
        for pid in sel:
            rate = rates.get(pid)
            entries.append(
                {
                    "providerId": str(pid),
                    "rateCents": rate.rate_cents if rate else None,
                    "unit": _enum_value(rate.unit) if rate else None,
                }
            )
            providers[pid]["servicesSelected"] += 1
            if rate:
                providers[pid]["servicesPriced"] += 1
        services.append(
            {
                "id": str(t.id),
                "name": t.name,
                "category": category,
                "level": _enum_value(t.level),
                "isTopJob": bool(t.is_top_job),
                "providers": entries,
            }
        )

    return {
        "providers": list(providers.values()),
        "services": services,
        "zones": [
            {
                "code": z.code,
                "name": z.name_en,
                "radiusKm": float(z.radius_km),
            }
            for z in zones
        ],
    }
