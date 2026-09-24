"""Vacía los datos de USUARIO de una base, conservando el catálogo.

Para el paso a live: `visp_prod` se queda limpia y pasa a ser la base real. Los
usuarios de prueba, sus trabajos, sus cuentas de Stripe de test y sus contratos
firmados de mentira no pueden convivir con los reales — entre otras cosas porque
**los ids de Stripe de live y de test son indistinguibles** (`acct_…`, `cus_…`),
así que en cuanto entre el primer alta real ya no hay forma de separarlos.

QUÉ BORRA Y QUÉ NO
------------------
Se borra todo lo que cuelga de `users`, `provider_profiles` o `jobs` por clave
ajena. Se conserva el catálogo y la configuración: servicios, categorías, zonas,
requisitos de credencial, SLA, política de niveles, tarifas, impuestos y los
superusuarios del admin.

Ojo con dos que confunden:
  - `provider_levels` NO es el catálogo de niveles: es la concesión POR
    PROVEEDOR (`provider_id`, `qualified`, `approved_by`). Se borra.
  - `level_policy` SÍ es la configuración de qué exige cada nivel. Se conserva.

POR QUÉ `TRUNCATE` SIN `CASCADE`
--------------------------------
`CASCADE` arrastraría en silencio cualquier tabla que referencie a estas, y ahí
es donde se pierde el catálogo sin enterarse. Sin `CASCADE`, Postgres EXIGE que
la lista incluya a todas las que referencian: si falta una, falla y lo dice. Un
error ruidoso es justo lo que se quiere en un script destructivo.

SIMULACIÓN POR DEFECTO. Para ejecutar de verdad hacen falta las dos cosas:
`--ejecutar` y teclear el nombre de la base cuando lo pida.

    ./venv/bin/python scripts/reset_prod_for_live.py                  # simula
    ./venv/bin/python scripts/reset_prod_for_live.py --ejecutar
"""

from __future__ import annotations

import argparse
import asyncio
import sys
from pathlib import Path

_RAIZ = Path(__file__).resolve().parent.parent
if str(_RAIZ) not in sys.path:
    sys.path.insert(0, str(_RAIZ))

import asyncpg

from src.core.config import settings

# Sale de DATABASE_URL, como los smokes. Nunca credenciales en el repositorio.
_BASE_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")

# Las raíces de "esto es dato de usuario". Todo lo que cuelgue de ellas cae.
RAICES = {"users", "provider_profiles", "jobs"}

# Foto del reparto tomada el 2026-09-24. No es decorativa: si el esquema cambia
# y aparece una tabla nueva colgando de las raíces, el script SE PARA en vez de
# borrar algo que nadie ha revisado.
ESPERADAS = {
    "chat_messages", "companies", "company_documents", "company_invites",
    "company_job_assignments", "company_members", "company_services",
    "device_tokens", "job_assignments", "job_cancellation_reports",
    "job_escalations", "job_material_receipts", "job_offers", "jobs",
    "legal_consents", "notification_preferences", "notifications",
    "on_call_shifts", "price_proposals", "pricing_events",
    "provider_availability", "provider_classification_levels",
    "provider_credential_codes", "provider_credentials", "provider_documents",
    "provider_experience_records", "provider_insurance_policies",
    "provider_levels", "provider_profiles", "provider_service_rates",
    "provider_task_qualifications", "provider_time_off_requests",
    "review_dimension_scores", "reviews", "tips", "users",
}


async def derivar(con) -> set[str]:
    """Las tablas que cuelgan de las raíces, por cierre transitivo de las FK."""
    filas = await con.fetch("""
        SELECT tc.table_name AS hijo, ccu.table_name AS padre
        FROM information_schema.table_constraints tc
        JOIN information_schema.constraint_column_usage ccu
          ON ccu.constraint_name = tc.constraint_name
        WHERE tc.constraint_type = 'FOREIGN KEY' AND tc.table_schema = 'public'
    """)
    hijos: dict[str, set[str]] = {}
    for r in filas:
        hijos.setdefault(r["padre"], set()).add(r["hijo"])

    vistas, pila = set(RAICES), list(RAICES)
    while pila:
        t = pila.pop()
        for h in hijos.get(t, ()):
            if h not in vistas:
                vistas.add(h)
                pila.append(h)
    return vistas


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--base", default="visp_prod")
    p.add_argument("--ejecutar", action="store_true", help="borra de verdad")
    args = p.parse_args()

    raiz, _, _ = _BASE_DSN.rpartition("/")
    con = await asyncpg.connect(f"{raiz}/{args.base}")
    try:
        derivadas = await derivar(con)

        # El guardián: el esquema tiene que ser el que se revisó.
        nuevas = derivadas - ESPERADAS
        idas = ESPERADAS - derivadas
        if nuevas or idas:
            print("EL ESQUEMA NO ES EL QUE SE REVISÓ — no se toca nada.\n", file=sys.stderr)
            for t in sorted(nuevas):
                print(f"   tabla NUEVA colgando de usuarios: {t}", file=sys.stderr)
            for t in sorted(idas):
                print(f"   tabla que ya no existe: {t}", file=sys.stderr)
            print("\nRevisa si es dato de usuario o catálogo y actualiza ESPERADAS.",
                  file=sys.stderr)
            return 2

        objetivo = sorted(derivadas)
        todas = {r["table_name"] for r in await con.fetch(
            "SELECT table_name FROM information_schema.tables "
            "WHERE table_schema='public' AND table_type='BASE TABLE'")}
        intactas = sorted(todas - derivadas)

        antes = {t: await con.fetchval(f'SELECT count(*) FROM "{t}"') for t in objetivo}
        total = sum(antes.values())

        print(f"BASE: {args.base}   ({'EJECUTAR' if args.ejecutar else 'SIMULACIÓN'})\n")
        print(f"Se vaciarían {len(objetivo)} tablas · {total} filas:")
        for t in objetivo:
            if antes[t]:
                print(f"   {t:<36} {antes[t]}")
        print(f"   (y {sum(1 for v in antes.values() if not v)} ya vacías)")

        print(f"\nSe CONSERVAN {len(intactas)} tablas de catálogo/configuración:")
        for t in intactas:
            n = await con.fetchval(f'SELECT count(*) FROM "{t}"')
            print(f"   {t:<36} {n}")

        print("\nRECUERDA: los PDF de contratos y las evidencias viven en "
              "`uploads/`, no en la base. Archívala aparte antes de ejecutar.")

        if not args.ejecutar:
            print("\nSimulación. Nada se ha tocado. Añade --ejecutar para borrar.")
            return 0

        print(f"\nEscribe el nombre de la base para confirmar ({args.base}): ", end="")
        if input().strip() != args.base:
            print("No coincide. Cancelado.")
            return 1

        # Sin CASCADE a propósito: si falta una tabla en la lista, falla y avisa.
        lista = ", ".join(f'"{t}"' for t in objetivo)
        await con.execute(f"TRUNCATE {lista} RESTART IDENTITY")

        despues = {t: await con.fetchval(f'SELECT count(*) FROM "{t}"') for t in objetivo}
        quedan = {t: n for t, n in despues.items() if n}
        print(f"\nHecho. {total} filas borradas.")
        print("Comprobación posterior:", "todo a cero" if not quedan else f"QUEDAN {quedan}")
        return 0 if not quedan else 1
    finally:
        await con.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
