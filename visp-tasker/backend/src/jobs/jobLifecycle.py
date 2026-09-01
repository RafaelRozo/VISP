"""Los trabajos en curso: avisar de que se pasaron de hora y, en último
término, cerrarlos antes de que se pierda el cobro.

Plan: ``docs/plan-cierre-y-agenda.md``.

**El agujero que tapa.** Hasta el 2026-09-01 la transición
``in_progress -> completed`` nacía en un único sitio: el proveedor pulsando
"Complete Job". Si no lo pulsaba, no pasaba nada, nunca. `TSK-BD00BM` —contrato
de 8 h empezado a las 09:12— llevaba 28 h en curso con $268.16 retenidos.

Y eso no es un estado feo, es dinero: **Stripe libera las autorizaciones sin
capturar a los 7 días**. Un trabajo que no se cierra a tiempo es un cobro
perdido y una tarjeta que hay que volver a pedir.

**La política (decisión de Ricardo, 2026-09-01): avisar, y cerrar solo como
red de seguridad.** Cerrar en cuanto vence la hora sería cobrar sin que nadie
confirme que el trabajo se hizo; no cerrar nunca es lo que ya nos pasó. Así que:

1. Al pasar la hora de fin, se avisa al proveedor. Se repite cada
   :data:`NUDGE_EVERY` hasta :data:`MAX_NOTICES` veces — a partir de ahí el push
   deja de ser recordatorio y es spam.
2. Si aun así nadie cierra, el sistema cierra y captura a los
   :data:`AUTH_SAFETY_DAYS` días de la autorización, **un día antes** de que
   Stripe la suelte.

**Dónde corre.** Tarea `asyncio` arrancada desde el `lifespan` de la app. El
contenedor levanta UN uvicorn sin ``--workers`` (ver `entrypoint.sh`), así que no
hay dos procesos mandando el mismo push. Además se cuelga de las lecturas
perezosas del proveedor: si el worker se cae o alguien despliega con otra
configuración, abrir la app sigue poniendo los trabajos al día. Ese doble camino
no es paranoia — el `reminderScheduler` anterior llevaba meses sin arrancarse y
nadie se enteró, porque nada dependía de que arrancara.

Todo el barrido es idempotente: se apoya en `overdue_notified_at` y en el estado
del trabajo, así que correrlo dos veces no manda dos avisos ni cobra dos veces.
"""

from __future__ import annotations

import asyncio
import logging
from datetime import datetime, timedelta, timezone

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.job import AssignmentStatus, Job, JobAssignment, JobStatus
from src.models.provider import ProviderProfile
from src.models.taxonomy import ServiceTask
from src.services import jobSchedule, notificationService

logger = logging.getLogger(__name__)


# Cada cuánto se revisa. Los eventos que busca son de escala horaria, así que un
# ciclo de 5 minutos llega de sobra y no castiga a la base.
CHECK_INTERVAL_SECONDS: int = 300

# Cadencia y tope de los avisos al proveedor.
NUDGE_EVERY = timedelta(hours=6)
MAX_NOTICES = 3

# Stripe suelta la autorización a los 7 días. Se cierra en el 6 para dejar un día
# de margen: si el cierre falla —Stripe caído, la tarjeta rechazada— todavía
# queda tiempo de reintentarlo en el siguiente ciclo.
AUTH_SAFETY_DAYS = 6


async def _provider_user_id(db: AsyncSession, job_id) -> object | None:
    """El `user_id` del proveedor asignado, que es a quien se le manda el push.

    El proveedor de un trabajo no vive en `jobs`: vive en `job_assignments` con
    estado ACCEPTED.
    """
    assignment = (
        await db.execute(
            select(JobAssignment)
            .where(
                JobAssignment.job_id == job_id,
                JobAssignment.status == AssignmentStatus.ACCEPTED,
            )
            .limit(1)
        )
    ).scalars().first()
    if assignment is None:
        return None
    provider = await db.get(ProviderProfile, assignment.provider_id)
    return provider.user_id if provider is not None else None


def _authorization_deadline(job: Job) -> datetime | None:
    """Cuándo hay que haber cerrado sí o sí para no perder la retención.

    None cuando no hay retención viva: sin dinero bloqueado no hay prisa, y
    cerrar por nuestra cuenta un trabajo que nadie está pagando sería inventarnos
    que se hizo.
    """
    if not job.stripe_payment_intent_id or not job.authorized_amount_cents:
        return None
    # `authorized_at` lo escribe `authorize_job`. `price_agreed_at` es el respaldo
    # para los trabajos anteriores a la migración 051, donde ambos coincidían
    # porque la autorización se lanza dentro de `accept_offer`.
    anchor = job.authorized_at or job.price_agreed_at
    if anchor is None:
        return None
    if anchor.tzinfo is None:
        anchor = anchor.replace(tzinfo=timezone.utc)
    return anchor + timedelta(days=AUTH_SAFETY_DAYS)


async def sweep_in_progress(db: AsyncSession) -> dict[str, int]:
    """Avisa y, si toca, cierra los trabajos en curso que se pasaron de hora.

    Devuelve cuántos de cada, para el log y para los smokes. No hace commit: lo
    hace quien la llama, porque desde una ruta va dentro de su transacción.
    """
    now = datetime.now(timezone.utc)
    avisados = 0
    cerrados = 0

    filas = (
        await db.execute(
            select(Job, ServiceTask)
            .join(ServiceTask, ServiceTask.id == Job.task_id)
            .where(
                Job.status == JobStatus.IN_PROGRESS,
                Job.started_at.isnot(None),
            )
        )
    ).all()

    for job, task in filas:
        ventana = jobSchedule.working_window(job, task)
        if ventana is None or now < ventana[1]:
            continue

        # 1. Red de seguridad primero: si la retención está a punto de morir, ya
        #    no hay nada que recordarle a nadie, hay que cerrar.
        limite = _authorization_deadline(job)
        if limite is not None and now >= limite:
            from src.services import jobService

            try:
                await jobService.update_job_status(
                    db, job.id, "completed", actor_type="system"
                )
            except Exception:  # noqa: BLE001 — un trabajo atascado no puede
                # tumbar el barrido de los demás.
                logger.exception(
                    "Auto-cierre fallido para el trabajo %s; se reintenta en el "
                    "siguiente ciclo", job.id,
                )
                continue

            cerrados += 1
            logger.warning(
                "Trabajo %s (%s) cerrado por el sistema: la autorización de "
                "Stripe vencía el %s y nadie lo cerró",
                job.id, job.reference_number, limite.isoformat(),
            )
            try:
                await notificationService.notify_job_completed(
                    job_id=job.id,
                    customer_id=job.customer_id,
                    final_price_cents=job.actual_total_cents
                    or job.total_charged_cents
                    or 0,
                    db=db,
                )
            except Exception:  # noqa: BLE001 — el push nunca bloquea el cierre.
                logger.exception("Aviso de cierre fallido para %s", job.id)
            continue

        # 2. Recordatorio al proveedor.
        if job.overdue_notice_count >= MAX_NOTICES:
            continue
        ultimo = job.overdue_notified_at
        if ultimo is not None and ultimo.tzinfo is None:
            ultimo = ultimo.replace(tzinfo=timezone.utc)
        if ultimo is not None and now - ultimo < NUDGE_EVERY:
            continue

        user_id = await _provider_user_id(db, job.id)
        if user_id is None:
            logger.warning(
                "Trabajo %s vencido sin proveedor asignado: no hay a quién avisar",
                job.id,
            )
            continue

        try:
            await notificationService.notify_job_overdue(
                job_id=job.id, provider_id=user_id, db=db
            )
        except Exception:  # noqa: BLE001
            logger.exception("Aviso de vencido fallido para %s", job.id)
            continue

        # El contador se sube aunque el push no llegue al teléfono: lo que se
        # controla aquí es la cadencia del intento, no la entrega.
        job.overdue_notified_at = now
        job.overdue_notice_count = (job.overdue_notice_count or 0) + 1
        avisados += 1

    await db.flush()
    return {"nudged": avisados, "auto_closed": cerrados}


# ---------------------------------------------------------------------------
# Tarea de fondo
# ---------------------------------------------------------------------------

_task: asyncio.Task | None = None
_running: bool = False


async def _run_loop() -> None:
    from src.api.deps import async_session_factory

    logger.info("Barrido de trabajos en curso arrancado (cada %ds)", CHECK_INTERVAL_SECONDS)
    while _running:
        try:
            async with async_session_factory() as db:
                resultado = await sweep_in_progress(db)
                await db.commit()
            if resultado["nudged"] or resultado["auto_closed"]:
                logger.info("Barrido de trabajos en curso: %s", resultado)
        except asyncio.CancelledError:
            raise
        except Exception:  # noqa: BLE001 — un ciclo que falla no mata el bucle.
            logger.exception("Error en el barrido de trabajos en curso")
        await asyncio.sleep(CHECK_INTERVAL_SECONDS)


async def start_job_lifecycle_worker() -> None:
    global _task, _running
    if _task is not None:
        logger.warning("El barrido de trabajos en curso ya estaba arrancado")
        return
    _running = True
    _task = asyncio.create_task(_run_loop())


async def stop_job_lifecycle_worker() -> None:
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
    logger.info("Barrido de trabajos en curso detenido")
