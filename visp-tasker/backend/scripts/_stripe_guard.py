"""Guardarraíl: ningún smoke puede correr con las claves de Stripe en live.

Estos smokes crean PaymentIntents de verdad, los capturan y reparten el dinero.
Con `sk_test_...` eso es gratis y desechable. Con `sk_live_...` es un cobro real
a una tarjeta real y una transferencia real a un proveedor — y desde el paso a
live del 24-09-2026 las claves de `.env` son precisamente las de live, así que
basta ejecutar el smoke de siempre para mover dinero de verdad.

La comprobación va por la clave, no por un flag que haya que acordarse de poner:
lo que decide si el dinero es real es la clave, y solo ella.
"""

from __future__ import annotations

import sys

_AVISO = """
{linea}
  ABORTADO — Stripe está en LIVE
{linea}
  La clave de .env es `{prefijo}...`, no una de test.

  Este smoke cobra y transfiere de verdad: con esta clave el cargo sale de una
  tarjeta real y el payout llega a un proveedor real.

  Para ejecutarlo, apunta STRIPE_SECRET_KEY / STRIPE_PUBLISHABLE_KEY a las
  claves de test (`sk_test_...` / `pk_test_...`) en un .env aparte. La base con
  los datos de prueba de Stripe es `visp_demo`, no `visp_prod`.
{linea}
"""


def exigir_stripe_test() -> None:
    """Corta la ejecución si la clave configurada es de live."""
    from src.core.config import settings

    clave = settings.stripe_secret_key or ""
    if clave.startswith("sk_live") or clave.startswith("rk_live"):
        print(_AVISO.format(linea="=" * 72, prefijo=clave[:8]))
        raise SystemExit(2)
