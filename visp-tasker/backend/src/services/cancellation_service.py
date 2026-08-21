"""Cancelación con motivo, sin penalización (decisiones de Ricardo, 2026-08-13).

Se usa cuando el trabajo ya está asignado y alguien llegó: el proveedor a la
puerta del cliente, o el cliente esperándolo. Ejemplos que dio el cliente:
"llegó alcoholizado, no quiero que entre a mi casa" y "el servicio era pasear 3
perros y querían que paseara 10".

Tres reglas que definen el comportamiento:

  1. **La cancelación es gratis.** Nadie paga y nadie cobra. Nadie debería
     quedarse discutiendo de dinero mientras se siente inseguro. En la práctica
     eso significa LIBERAR el hold de Stripe: si no, el dinero del cliente se
     queda retenido en su tarjeta aunque el trabajo no exista.

  2. **El impacto en la calificación NO es automático.** El reporte entra en una
     cola de revisión. Cancelación gratis + daño automático desde un texto sin
     verificar es un arma: quien se arrepiente escribe "llegó borracho" y hunde a
     un proveedor honesto que no puede defenderse.

  3. **Motivo cerrado + texto.** Los códigos hacen visibles los patrones; el
     texto da el detalle. Un reporte es ruido, tres iguales son un patrón.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.job import Job, JobCancellationReport, JobStatus

logger = logging.getLogger(__name__)


class CancellationNotAllowedError(Exception):
    """El trabajo no está en un estado donde esta cancelación tenga sentido."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class InvalidReasonCodeError(Exception):
    def __init__(self, code: str) -> None:
        super().__init__(f"Unknown cancellation reason '{code}'.")


# Motivos que puede alegar cada parte. Cerrados a propósito: con texto libre no se
# pueden contar patrones, y detectar al reincidente es el valor real de todo esto.
#
# Añadir uno nuevo aquí es suficiente — no hace falta migración, porque la columna
# es VARCHAR con CHECK sobre el rol, no sobre el código.
CUSTOMER_REASONS: dict[str, str] = {
    "PROVIDER_INTOXICATED": "The provider appeared intoxicated",
    "PROVIDER_UNPROFESSIONAL": "The provider behaved unprofessionally",
    "PROVIDER_NO_SHOW": "The provider never arrived",
    "PROVIDER_REFUSED_SCOPE": "The provider refused the agreed work",
    "FELT_UNSAFE": "I did not feel safe",
    "OTHER": "Another reason",
}

PROVIDER_REASONS: dict[str, str] = {
    "SCOPE_LARGER": "The job is much larger than what was booked",
    "UNSAFE_CONDITIONS": "The site is unsafe to work in",
    "CUSTOMER_ABSENT": "Nobody was there to let me in",
    "CUSTOMER_UNPROFESSIONAL": "The customer behaved unprofessionally",
    "PROPERTY_NOT_AS_DESCRIBED": "The property is not what was described",
    "OTHER": "Another reason",
}

# Estados en los que esta cancelación aplica: el trabajo ya está asignado. Antes
# de eso no hay a quién reportar, y la cancelación normal (sin motivo) ya existe.
CANCELLABLE_STATUSES = {
    JobStatus.SCHEDULED,
    JobStatus.PROVIDER_ACCEPTED,
    JobStatus.PROVIDER_EN_ROUTE,
    JobStatus.IN_PROGRESS,
}


def reasons_for(role: str) -> dict[str, str]:
    return CUSTOMER_REASONS if role == "customer" else PROVIDER_REASONS


async def cancel_with_report(
    db: AsyncSession,
    *,
    job: Job,
    reported_by: uuid.UUID,
    reporter_role: str,
    reason_code: str,
    note: Optional[str] = None,
) -> JobCancellationReport:
    """Cancela el trabajo sin coste y deja el reporte para revisión.

    NO toca la calificación de nadie: eso lo decide el admin al revisar.
    """
    if reporter_role not in ("customer", "provider"):
        raise CancellationNotAllowedError(f"Unknown role '{reporter_role}'.")

    if job.status not in CANCELLABLE_STATUSES:
        raise CancellationNotAllowedError(
            f"A job in status '{job.status.value}' cannot be cancelled this way."
        )

    if reason_code not in reasons_for(reporter_role):
        raise InvalidReasonCodeError(reason_code)

    texto = (note or "").strip() or None
    # En "otro motivo" el texto es lo único que explica qué pasó; sin él, el
    # reporte llega a la cola sin nada que revisar.
    if reason_code == "OTHER" and not texto:
        raise CancellationNotAllowedError(
            "Tell us what happened — with 'another reason' the note is what "
            "explains the cancellation."
        )

    # 1. El dinero.
    #
    # LA REGLA GENERAL SIGUE SIENDO QUE CANCELAR ES GRATIS (migración 041): se
    # suelta el hold entero y nadie paga. Nadie debería estar discutiendo de dinero
    # mientras se siente inseguro.
    #
    # LA EXCEPCIÓN, Y ES UNA SOLA: en los contratos por horas (PER_CONTRACT), si el
    # trabajo YA EMPEZÓ se cobran las horas trabajadas. No es una vuelta atrás de
    # aquella decisión: es que aquí parte del trabajo ya se hizo. El helper puso 4
    # horas de su vida y nadie se las devuelve. Cancelar ANTES de empezar sigue
    # siendo gratis también en esta unidad.
    cobro = await _bill_contract_time(db, job)
    if cobro is None:
        await _release_hold(job)

    # 2. Cancelar el trabajo.
    job.status = (
        JobStatus.CANCELLED_BY_CUSTOMER
        if reporter_role == "customer"
        else JobStatus.CANCELLED_BY_PROVIDER
    )
    job.cancellation_reason = f"{reason_code}: {texto}" if texto else reason_code
    job.cancelled_at = datetime.now(timezone.utc)

    # 3. Guardar el reporte, PENDIENTE de revisión.
    report = JobCancellationReport(
        job_id=job.id,
        reported_by=reported_by,
        reporter_role=reporter_role,
        reason_code=reason_code,
        note=texto,
        status="PENDING",
        rating_impact=False,
    )
    db.add(report)
    await db.flush()

    logger.info(
        "Job %s cancelled by %s (%s). Report %s pending review.",
        job.id, reporter_role, reason_code, report.id,
    )
    return report


async def _bill_contract_time(db: AsyncSession, job: Job) -> Optional[dict]:
    """Cobra las horas trabajadas al cancelar un contrato a mitad.

    Devuelve ``None`` cuando no aplica —no es un contrato, o el trabajo aún no había
    empezado— y entonces el llamador suelta el hold como siempre.

    EL REDONDEO: horas completas EMPEZADAS (decisión de Ricardo, 2026-08-21).
    4 h 10 min se cobran como 5 h. Es lo que se usa en trabajo por horas y, de paso,
    protege al proveedor al que cancelan a los diez minutos de llegar: cobra 1 hora
    en vez de nada. Nunca se cobra más de las horas contratadas — si el reloj se
    pasó, el trato era ese.

    Da igual QUIÉN cancele. Si el proveedor se va a las 4 h, esas 4 h las trabajó;
    si el cliente lo echa a las 5 h, también. El tiempo trabajado no cambia según de
    quién fuera la decisión, y meter aquí un castigo convertiría el motivo de la
    cancelación en una negociación de dinero.
    """
    from math import ceil

    from src.models.taxonomy import PricingUnit, ServiceTask
    from src.services import job_payment_service, provider_rate_service

    task = await db.get(ServiceTask, job.task_id)
    if task is None or task.pricing_unit != PricingUnit.PER_CONTRACT:
        return None
    if job.started_at is None:
        # Aún no había empezado: no hay tiempo que pagar, cancelar es gratis.
        return None

    ahora = datetime.now(timezone.utc)
    inicio = job.started_at
    if inicio.tzinfo is None:
        inicio = inicio.replace(tzinfo=timezone.utc)

    minutos = max(0, int((ahora - inicio).total_seconds() // 60))
    horas = max(1, ceil(minutos / 60))
    contratadas = int(job.quantity or horas)
    horas = min(horas, contratadas) if contratadas > 0 else horas

    tarifa = job.customer_rate_cents or 0
    if tarifa <= 0:
        logger.warning("Job %s es PER_CONTRACT sin tarifa de cliente; no se cobra.", job.id)
        return None

    # Se recalcula el trabajo como si se hubiera contratado por las horas hechas y
    # se sella con la misma función que el resto del sistema: comisión por nivel,
    # impuesto por provincia, fee de servicio y evento de auditoría.
    job.quantity = Decimal(horas)
    job.actual_duration_minutes = minutos

    asignado = await _assigned_provider_id(db, job.id)
    if asignado is None:
        logger.warning("Job %s cancelado sin proveedor asignado; no se cobra.", job.id)
        return None

    quote = await provider_rate_service.reprice_job_to_provider_rate(db, job, asignado)
    if quote is None:
        return None

    # Capturar SOLO lo trabajado del hold que ya estaba retenido. El resto se
    # libera solo: Stripe suelta la diferencia al capturar por debajo del techo.
    try:
        await job_payment_service.capture_job(
            db, job, final_total_cents=job.total_charged_cents
        )
    except Exception as exc:  # noqa: BLE001
        # Que el cobro falle no puede atrapar a nadie en un trabajo del que se
        # quiere salir. Queda el importe sellado en el job para resolverlo a mano.
        logger.error("Job %s: cobro parcial falló (%s). Sigue la cancelación.", job.id, exc)

    logger.info(
        "Job %s cancelado a mitad: %s min -> %s h cobradas a %sc/h = %sc",
        job.id, minutos, horas, tarifa, job.quoted_price_cents,
    )
    return {
        "billed_hours": horas,
        "worked_minutes": minutos,
        "rate_cents": tarifa,
        "subtotal_cents": job.quoted_price_cents,
        "total_charged_cents": job.total_charged_cents,
    }


async def _assigned_provider_id(db: AsyncSession, job_id) -> Optional[uuid.UUID]:
    """El proveedor que hace el trabajo. Vive en `job_assignments`, no en `jobs`."""
    from src.models.job import AssignmentStatus, JobAssignment

    return (
        await db.execute(
            select(JobAssignment.provider_id)
            .where(
                JobAssignment.job_id == job_id,
                JobAssignment.status.in_(
                    [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]
                ),
            )
            .limit(1)
        )
    ).scalars().first()


async def _release_hold(job: Job) -> None:
    """Suelta la autorización de Stripe si el trabajo tiene una viva."""
    intent_id = getattr(job, "stripe_payment_intent_id", None)
    if not intent_id:
        return
    try:
        import stripe

        pi = stripe.PaymentIntent.retrieve(intent_id)
        if pi.status in ("requires_capture", "requires_confirmation", "requires_payment_method"):
            stripe.PaymentIntent.cancel(intent_id)
            logger.info("Hold %s liberado por cancelación del job %s", intent_id, job.id)
    except Exception as exc:  # noqa: BLE001
        # Que no se pueda liberar el hold no puede impedir la cancelación: la
        # persona necesita salir de la situación ahora. Queda en el log para
        # resolverlo a mano.
        logger.warning(
            "No se pudo liberar el hold %s del job %s: %s", intent_id, job.id, exc
        )


async def repeat_offender_count(
    db: AsyncSession, *, job: Job, reporter_role: str
) -> int:
    """Cuántos reportes CONFIRMADOS acumula ya la parte reportada.

    Es el dato que convierte esto en algo accionable: un reporte es ruido, tres
    iguales son un patrón. Se cuentan solo los UPHELD — los desestimados no deben
    contar contra nadie.
    """
    from src.models.job import AssignmentStatus, JobAssignment

    if reporter_role == "customer":
        # El reportado es el PROVEEDOR, que no está en `jobs`: se llega por la
        # asignación aceptada.
        asignacion = (
            await db.execute(
                select(JobAssignment).where(
                    JobAssignment.job_id == job.id,
                    JobAssignment.status.in_(
                        [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]
                    ),
                )
            )
        ).scalar_one_or_none()
        if asignacion is None:
            return 0
        stmt = (
            select(func.count(JobCancellationReport.id))
            .join(JobAssignment, JobAssignment.job_id == JobCancellationReport.job_id)
            .where(
                JobAssignment.provider_id == asignacion.provider_id,
                JobCancellationReport.reporter_role == "customer",
                JobCancellationReport.status == "UPHELD",
            )
        )
    else:
        stmt = (
            select(func.count(JobCancellationReport.id))
            .join(Job, Job.id == JobCancellationReport.job_id)
            .where(
                Job.customer_id == job.customer_id,
                JobCancellationReport.reporter_role == "provider",
                JobCancellationReport.status == "UPHELD",
            )
        )
    return (await db.execute(stmt)).scalar_one()
