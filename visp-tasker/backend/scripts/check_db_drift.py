"""Guardián: ¿tienen `visp_prod` y `visp_demo` el mismo esquema aplicado?

POR QUÉ EXISTE ESTO
-------------------
La vez pasada hubo dos bases —`Visp2026` y `visp_prod`— y la de pruebas se quedó
atrás en las migraciones 031-041. Nadie se enteró hasta que hubo que mudarse
entera. Una base de pruebas con otro esquema es PEOR que no tener ninguna:
pruebas contra algo que no es producción y te da confianza falsa.

"Nos acordaremos de migrar las dos" es exactamente lo que falló. Esto lo
convierte en un error ruidoso: sale distinto de cero si difieren, para poder
engancharlo antes de cada despliegue.

    ./venv/bin/python scripts/check_db_drift.py
    ./venv/bin/python scripts/check_db_drift.py --prod visp_prod --demo visp_demo
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

# La conexión sale de DATABASE_URL, como los smokes. Nunca credenciales en el
# código: este fichero va al repositorio y el `.env` no.
_BASE_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")


def dsn(base: str) -> str:
    """El mismo servidor y credenciales que la base de trabajo, otra base."""
    raiz, _, _ = _BASE_DSN.rpartition("/")
    return f"{raiz}/{base}"


async def aplicadas(base: str) -> set[str] | None:
    """Los ficheros de migración que esa base dice tener. None si no existe."""
    try:
        con = await asyncpg.connect(dsn(base))
    except asyncpg.InvalidCatalogNameError:
        return None
    try:
        filas = await con.fetch("SELECT filename FROM _migrations_applied")
        return {r["filename"] for r in filas}
    finally:
        await con.close()


async def main() -> int:
    p = argparse.ArgumentParser()
    p.add_argument("--prod", default="visp_prod")
    p.add_argument("--demo", default="visp_demo")
    args = p.parse_args()

    a = await aplicadas(args.prod)
    b = await aplicadas(args.demo)

    if a is None:
        print(f"ERROR: la base {args.prod!r} no existe", file=sys.stderr)
        return 2
    if b is None:
        print(f"{args.demo!r} todavía no existe — nada que comparar.")
        print("(Cuando la crees, este guardián empieza a tener sentido.)")
        return 0

    solo_prod = sorted(a - b)
    solo_demo = sorted(b - a)

    print(f"{args.prod}: {len(a)} migraciones · {args.demo}: {len(b)}")
    if not solo_prod and not solo_demo:
        print("OK — las dos bases tienen el mismo esquema aplicado.")
        return 0

    print("\nDESINCRONIZADAS:")
    for f in solo_prod:
        print(f"   falta en {args.demo}: {f}")
    for f in solo_demo:
        print(f"   falta en {args.prod}: {f}")
    print("\nAplica las que faltan antes de fiarte de una prueba hecha en demo.")
    return 1


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
