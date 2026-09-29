"""Purga de cuentas borradas: anonimiza las que cumplieron los 30 días.

Arranca desde el `lifespan` de `main.py` y lo DICE en el log al arrancar: el
`reminderScheduler` estuvo meses muerto sin que nadie lo notara. El mismo trabajo
se lanza a mano con `scripts/account_deletion.py purge`.

Un plazo de 30 días no necesita precisión: una pasada cada 6 horas basta, y una
purga que se retrasa unas horas no incumple nada.
"""

from __future__ import annotations

import asyncio
import logging

logger = logging.getLogger(__name__)

CHECK_INTERVAL_SECONDS: int = 6 * 3600

_task: asyncio.Task | None = None
_running: bool = False


async def _run_loop() -> None:
    from src.api.deps import async_session_factory
    from src.services.account_deletion_service import purge_due_accounts

    logger.info(
        "Purga de cuentas borradas arrancada (cada %dh)", CHECK_INTERVAL_SECONDS // 3600
    )
    while _running:
        try:
            async with async_session_factory() as db:
                resultado = await purge_due_accounts(db)
                await db.commit()
            logger.info("Purga de cuentas borradas: %s", resultado)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — un ciclo que falla no mata el bucle.
            logger.exception("Error en la purga de cuentas borradas")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


async def start_account_purge_worker() -> None:
    global _task, _running
    if _task is not None:
        logger.warning("La purga de cuentas borradas ya estaba arrancada")
        return
    _running = True
    _task = asyncio.create_task(_run_loop())


async def stop_account_purge_worker() -> None:
    global _task, _running
    _running = False
    if _task is None:
        return
    _task.cancel()
    try:
        await _task
    except asyncio.CancelledError:
        pass
    _task = None
