"""Smoke del gate de zona de servicio (WP3, migración 036).

Corre en proceso contra la app ASGI real y la BD real, sin necesitar un device.
Se auto-limpia: cada job creado se borra al final.

    ./venv/bin/python scripts/smoke_service_zone.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid

import httpx

sys.path.insert(0, ".")

from src.api.deps import async_session_factory  # noqa: E402
from src.main import app  # noqa: E402
from src.services import service_zone_service as zone  # noqa: E402

# lat, lng, dentro?, etiqueta
PUNTOS = [
    ("Toronto downtown", 43.6532, -79.3832, True),
    ("Mississauga", 43.5890, -79.6441, True),
    ("Hamilton", 43.2557, -79.8711, True),
    ("Barrie", 44.3894, -79.6903, False),
    ("Ottawa", 45.4215, -75.6972, False),
    ("Thunder Bay (SÍ es Ontario)", 48.3809, -89.2477, False),
    ("Vancouver", 49.2827, -123.1207, False),
    ("Chihuahua, MX", 28.6330, -106.0691, False),
]

passed = 0
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        failed.append(name)
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


async def main() -> int:
    print("=" * 72)
    print("SMOKE — gate de zona de servicio")
    print("=" * 72)

    # ---------------------------------------------------------------- capa servicio
    print("\n[1] locate_point contra las zonas activas de la BD")
    async with async_session_factory() as db:
        zones = await zone.get_active_zones(db)
        check("hay al menos una zona activa", len(zones) > 0, f"{len(zones)} zona(s)")
        for z in zones:
            print(f"        zona {z.code}: centro ({z.center_latitude},{z.center_longitude}) r={z.radius_km}km")

        for label, lat, lng, expected_inside in PUNTOS:
            m = await zone.locate_point(db, lat, lng)
            detail = (
                f"dentro de {m.zone.code}" if m.inside and m.zone
                else f"fuera, faltan {m.distance_km:.0f} km"
            )
            check(f"{label} -> {'dentro' if expected_inside else 'fuera'}",
                  m.inside == expected_inside, detail)

        # Regla clave: coordenadas ausentes NO bloquean.
        r = await zone.assert_in_service_area(db, None, None)
        check("sin coordenadas no bloquea", r is None)

    # ------------------------------------------------------------------- capa HTTP
    print("\n[2] GET /api/v1/geo/service-area (consulta no bloqueante para la UI)")
    transport = httpx.ASGITransport(app=app)
    async with httpx.AsyncClient(transport=transport, base_url="http://test") as client:
        r = await client.get("/api/v1/geo/service-area", params={"lat": 43.6532, "lng": -79.3832})
        check("Toronto -> 200 inside=true", r.status_code == 200 and r.json()["inside"] is True,
              f"{r.status_code} {r.json() if r.status_code == 200 else r.text[:80]}")

        r = await client.get("/api/v1/geo/service-area", params={"lat": 48.3809, "lng": -89.2477})
        body = r.json() if r.status_code == 200 else {}
        check("Thunder Bay -> 200 inside=false con distancia",
              r.status_code == 200 and body.get("inside") is False and body.get("distanceKm", 0) > 800,
              f"distanceKm={body.get('distanceKm')}")

        r = await client.get("/api/v1/geo/service-area", params={"lat": 999, "lng": 0})
        check("latitud inválida -> 422", r.status_code == 422, str(r.status_code))

    # -------------------------------------------------------- gate en creación de job
    print("\n[3] Gate duro en la creación de job (debe ser 400, NUNCA 5xx)")
    created: list[uuid.UUID] = []
    async with async_session_factory() as db:
        from sqlalchemy import select
        from src.models.taxonomy import ServiceTask
        from src.models.user import User
        from src.services import jobService

        # Sin entradas obligatorias: lo que se prueba es la ZONA, no el formulario
        # de reserva, y el catálogo cambia cada vez que el cliente lo toca.
        from src.models.taxonomy import ServiceTaskQuestion as _Q

        task = (await db.execute(
            select(ServiceTask).where(
                ServiceTask.is_active.is_(True),
                ServiceTask.requires_details.is_(False),
                ServiceTask.requires_evidence.is_(False),
                ~select(_Q.id).where(
                    _Q.task_id == ServiceTask.id,
                    _Q.is_active.is_(True),
                    _Q.is_required.is_(True),
                ).exists(),
            ).limit(1)
        )).scalar_one_or_none()
        customer = (await db.execute(
            select(User).where(User.role_customer.is_(True)).limit(1)
        )).scalar_one_or_none()

        if task is None or customer is None:
            check("hay task activa y customer para probar", False,
                  "faltan datos base en la BD")
        else:
            def loc(lat: float, lng: float) -> dict:
                return {
                    "latitude": lat, "longitude": lng,
                    "address": "Smoke test address", "city": "Toronto",
                    "province_state": "ON", "postal_zip": "M5H 2N2", "country": "CA",
                }

            # Dentro -> crea
            try:
                job = await jobService.create_job(
                    db, customer_id=customer.id, task_id=task.id,
                    location=loc(43.6532, -79.3832), priority="standard",
                )
                created.append(job.id)
                check("dentro de la zona -> job creado", True, str(job.reference_number))
            except Exception as exc:  # noqa: BLE001
                check("dentro de la zona -> job creado", False, f"{type(exc).__name__}: {exc}")

            # Fuera -> bloquea con el error de dominio
            try:
                job = await jobService.create_job(
                    db, customer_id=customer.id, task_id=task.id,
                    location=loc(48.3809, -89.2477), priority="standard",
                )
                created.append(job.id)
                check("Thunder Bay -> bloqueado", False, "se creó el job, NO debía")
            except zone.OutsideServiceAreaError as exc:
                check("Thunder Bay -> bloqueado", True, str(exc)[:70] + "...")
            except Exception as exc:  # noqa: BLE001
                check("Thunder Bay -> bloqueado", False,
                      f"excepción equivocada {type(exc).__name__}: {exc}")

        # Limpieza
        if created:
            from sqlalchemy import delete
            from src.models.job import Job
            await db.execute(delete(Job).where(Job.id.in_(created)))
            await db.commit()
            print(f"\n  limpieza: {len(created)} job(s) de prueba borrado(s)")
        else:
            await db.rollback()

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    if failed:
        print("FALLARON:")
        for name in failed:
            print(f"  - {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
