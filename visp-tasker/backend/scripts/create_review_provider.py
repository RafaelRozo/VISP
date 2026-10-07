"""Cuenta demo de PROVEEDOR para la revisión de Apple.

Apple pide credenciales de cada tipo de cuenta. Este script la da de alta por
los MISMOS endpoints que la app (registro, firma del contrato, dirección base,
servicios, precios, bio): nada se escribe a mano en la base, así que la cuenta
queda igual que la de un proveedor real.

Sin cobros de Stripe a propósito: el alta de pagos exige una identidad real.
Puede ver la bolsa y ofertar; lo que no puede es cobrar (se explica en las
notas para Apple).

    cd visp-tasker/backend
    ./venv/bin/python scripts/create_review_provider.py            # usa el .env (visp_prod)

Imprime la contraseña UNA vez. No se guarda en ningún archivo.
"""

from __future__ import annotations

import asyncio
import math
import secrets
import string
import sys
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.main import app  # noqa: E402

API = "/api/v1"
EMAIL = "appreview.provider@droztechnologies.com"

# Servicios L0 (el nivel con el que empieza cualquier proveedor), de varias
# categorías para que el revisor vea trabajos distintos. Precio = punto medio
# del rango del catálogo.
TASKS = {
    "b1000000-0000-4000-8000-000000000001": "Standard Residential Cleaning",
    "b1000000-0000-4000-8000-000000000004": "Move-Out Cleaning",
    "b1000000-0000-4000-8000-000000000020": "Furniture Rearrangement",
    "b1000000-0000-4000-8000-000000000022": "Junk Removal (Light)",
    "b1000000-0000-4000-8000-000000000016": "Leaf Raking & Yard Cleanup",
    "b1000000-0000-4000-8000-000000000029": "Dog Walking (30 min)",
    "b1000000-0000-4000-8000-000000000032": "Pet Feeding Visit",
}
RATES = {
    "b1000000-0000-4000-8000-000000000001": 7000,
    "b1000000-0000-4000-8000-000000000004": 5500,
    "b1000000-0000-4000-8000-000000000020": 5200,
    "b1000000-0000-4000-8000-000000000022": 5700,
    "b1000000-0000-4000-8000-000000000016": 4700,
    "b1000000-0000-4000-8000-000000000029": 2500,
    "b1000000-0000-4000-8000-000000000032": 3000,
}


def _password() -> str:
    alfabeto = string.ascii_letters + string.digits
    cuerpo = "".join(secrets.choice(alfabeto) for _ in range(12))
    return f"Visp-{cuerpo}9!"


def _firma() -> dict:
    trazo = [[20 + i * 2.2, 60 + 22 * math.sin(i / 6.0)] for i in range(120)]
    return {"width": 320, "height": 140, "strokes": [trazo, [[60, 95], [200, 92]]]}


def _ok(r, paso: str) -> dict:
    if r.status_code >= 400:
        sys.exit(f"FALLÓ {paso}: {r.status_code} {r.text[:300]}")
    return r.json()


async def main() -> int:
    password = _password()
    async with AsyncClient(transport=ASGITransport(app=app), base_url="http://visp", timeout=60) as c:
        # 1. Registro como proveedor.
        r = await c.post(f"{API}/auth/register", json={
            "email": EMAIL, "password": password,
            "first_name": "Alex", "last_name": "Provider", "role": "provider",
        })
        data = _ok(r, "registro")["data"]
        tokens = data.get("tokens") or {}
        token = tokens.get("accessToken") or tokens.get("access_token")
        if not token:
            sys.exit(f"Sin token en la respuesta del registro: {list(data)}")
        h = {"Authorization": f"Bearer {token}"}
        print("1. registrado")

        # 2. Contrato de proveedor independiente, firmado por el camino real.
        doc = _ok(await c.get(f"{API}/consents/document/provider_ic_agreement"), "contrato")
        _ok(await c.post(f"{API}/consents/sign", headers=h, json={
            "consent_type": "provider_ic_agreement",
            "signed_full_name": "Alex Provider",
            "document_hash": doc["hash"],
            "signature": _firma(),
            "device_id": "APP-REVIEW-DEMO",
        }), "firma")
        print("2. contrato firmado")

        # 3. Dirección base en el centro de Toronto (dentro de la zona GTA).
        _ok(await c.patch(f"{API}/users/me", headers=h, json={
            "defaultAddress": {
                "street": "200 Bay St", "city": "Toronto", "province": "ON",
                "postalCode": "M5J 2J5", "country": "CA",
                "latitude": 43.6465, "longitude": -79.3790,
                "formattedAddress": "200 Bay St, Toronto, ON M5J 2J5, Canada",
            },
        }), "dirección")
        print("3. dirección base")

        # 4. Servicios y 5. precios.
        _ok(await c.post(f"{API}/provider/services", headers=h,
                         json={"taskIds": list(TASKS)}), "servicios")
        for tid, cents in RATES.items():
            _ok(await c.put(f"{API}/provider/rates/{tid}", headers=h,
                            json={"rate_cents": cents}), f"precio {TASKS[tid]}")
        print(f"4-5. {len(TASKS)} servicios con precio")

        # 6. Bio.
        _ok(await c.patch(f"{API}/provider/profile", headers=h, json={
            "bio": "Reliable help around the house: cleaning, small moves, yard work "
                   "and pet care across downtown Toronto.",
            "yearsExperience": 5,
        }), "bio")
        print("6. bio")

        # Comprobación: la bolsa responde y el checklist no tiene bloqueantes
        # salvo los cobros (que dejamos sin hacer a propósito).
        _ok(await c.get(f"{API}/provider/open-jobs", headers=h), "bolsa")
        rd = _ok(await c.get(f"{API}/users/me/readiness?role=provider", headers=h), "readiness")
        rd = rd.get("data", rd)
        pasos = {s.get("key"): s.get("status") for s in rd.get("steps", [])}
        print("checklist:", pasos)

    print("\nCUENTA DEMO DE PROVEEDOR")
    print(f"  Email:    {EMAIL}")
    print(f"  Password: {password}")
    return 0


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
