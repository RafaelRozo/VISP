"""¿Está el entorno de Stripe listo para operar? SOLO LECTURA.

No crea cuentas, cobros ni objetos: en live eso es dinero y entidades reales.
Se corre cada vez que se toca algo en el dashboard, porque la guía de
configuración de Stripe marca pasos como hechos que no son los que nos
bloquean — la fuente de verdad es lo que responde la API.

    ./venv/bin/python scripts/check_stripe_live.py
"""

from __future__ import annotations

import os
import sys
from pathlib import Path

# Los scripts se lanzan desde `backend/`, pero el import de `src` necesita que
# esa carpeta esté en el path — igual que hacen los smokes.
_RAIZ = Path(__file__).resolve().parent.parent
if str(_RAIZ) not in sys.path:
    sys.path.insert(0, str(_RAIZ))

from dotenv import load_dotenv

load_dotenv(".env", override=True)

import stripe  # noqa: E402

CLAVE = os.environ.get("STRIPE_SECRET_KEY", "")
stripe.api_key = CLAVE


def linea(ok: bool | None, texto: str) -> None:
    marca = {True: "OK  ", False: "FALLA", None: "?   "}[ok]
    print(f"  [{marca}] {texto}")


def main() -> int:
    if not CLAVE:
        print("No hay STRIPE_SECRET_KEY en el entorno.", file=sys.stderr)
        return 2
    modo = "LIVE" if "_live_" in CLAVE or CLAVE.startswith("rk_live") else "TEST"
    print(f"=== Stripe en modo {modo} ===\n")

    fallos = 0

    # 1. La plataforma puede cobrar y pagar.
    print("PLATAFORMA")
    try:
        a = stripe.Account.retrieve()
        req = getattr(a, "requirements", None)
        due = list(getattr(req, "currently_due", None) or []) if req else []
        linea(bool(a.charges_enabled), f"charges_enabled  ({a.id}, {a.country}, "
                                       f"{getattr(a, 'default_currency', '?')})")
        linea(bool(a.payouts_enabled), "payouts_enabled")
        linea(not due, f"sin requisitos pendientes ({len(due)})")
        if due:
            print(f"          -> {due[:8]}")
        fallos += (not a.charges_enabled) + (not a.payouts_enabled) + bool(due)
    except stripe.StripeError as e:
        linea(False, f"no se pudo leer la cuenta: {e}")
        fallos += 1

    # 2. Connect: es lo que permite dar de alta proveedores.
    print("\nCONNECT")
    try:
        stripe.Account.list(limit=1)
        linea(True, "Connect v1 responde")
    except stripe.StripeError as e:
        linea(False, f"Connect v1: {getattr(e, 'code', e)}")
        fallos += 1

    try:
        stripe.StripeClient(CLAVE).v2.core.accounts.list(params={"limit": 1})
        linea(True, "Accounts v2 responde — el alta de cobros funcionará")
    except Exception as e:  # noqa: BLE001
        codigo = getattr(e, "code", type(e).__name__)
        linea(False, f"Accounts v2 BLOQUEADO ({codigo})")
        print("          -> sin esto, POST /payouts/v2/init falla y ningún")
        print("             proveedor puede cobrar, así que ninguna oferta")
        print("             se puede aceptar.")
        fallos += 1

    # 3. El webhook, con los 9 eventos que el backend sabe procesar.
    from src.integrations.stripe.webhookHandler import _EVENT_HANDLERS

    esperados = set(_EVENT_HANDLERS)
    print(f"\nWEBHOOK (el backend procesa {len(esperados)} eventos)")
    try:
        puntos = stripe.WebhookEndpoint.list(limit=10).data
        if not puntos:
            linea(False, "no hay ningún endpoint configurado")
            fallos += 1
        for p in puntos:
            activos = set(p.enabled_events)
            faltan = esperados - activos
            sobran = activos - esperados
            linea(p.status == "enabled" and not faltan, f"{p.url}  [{p.status}]")
            print(f"          api={getattr(p, 'api_version', '?')}  "
                  f"{len(activos)} eventos")
            if faltan:
                print(f"          -> FALTAN: {sorted(faltan)}")
                fallos += 1
            if sobran:
                print(f"          -> de más (inofensivos): {sorted(sobran)}")
    except stripe.StripeError as e:
        linea(False, f"no se pudieron listar: {e}")
        fallos += 1

    print("\n" + ("TODO LISTO" if not fallos else f"{fallos} punto(s) pendiente(s)"))
    return 0 if not fallos else 1


if __name__ == "__main__":
    sys.exit(main())
