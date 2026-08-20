"""
materialsService — el proveedor compra material y el cliente se lo reembolsa.
Migración 043. Ver docs/plan-ofertas-v2.md §9.

LAS TRES REGLAS DEL DINERO (decisiones de Ricardo, 2026-08-19), que es lo que hay que
tener claro antes de leer nada más:

1. El material NO lleva impuesto encima. La tienda ya cobró el HST de esa pintura y
   viene dentro del importe de la factura; aplicarlo otra vez es cobrárselo dos veces
   al cliente. El impuesto sale solo de la mano de obra.
2. VISP NO cobra comisión sobre el material. Es un reembolso, no ingreso del proveedor.
3. Pasarse del presupuesto exige aprobación del cliente. Hasta el techo, sin fricción.

De ahí sale el reparto:

    subtotal         = tarifa × magnitud                 (mano de obra)
    impuesto         = f(subtotal)
    comisión         = % × subtotal
    payout proveedor = subtotal − comisión + material     ← se le devuelve íntegro
    total cliente    = subtotal + impuesto + material + propina + fee de servicio

El fee de servicio SÍ se calcula sobre el total con material dentro: es el coste de
Stripe, y Stripe cobra sobre lo que se cobra de verdad. No cobrarlo ahí sería que la
plataforma pusiera de su bolsillo la comisión de pasarela del material.
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from sqlalchemy import func, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.job import AssignmentStatus, Job, JobAssignment, JobStatus
from src.models.job_offer import JobMaterialReceipt
from src.services import fee_service

logger = logging.getLogger(__name__)

# Estados en los que tiene sentido subir una factura: desde que el trabajo está
# agendado (el proveedor puede comprar el día antes) hasta que se cierra.
_RECEIPT_OK_STATES = frozenset({
    JobStatus.SCHEDULED,
    JobStatus.PROVIDER_ACCEPTED,
    JobStatus.PROVIDER_EN_ROUTE,
    JobStatus.IN_PROGRESS,
    JobStatus.COMPLETED,
})


class MaterialsError(Exception):
    """Base."""


class JobNotFoundError(MaterialsError):
    pass


class MaterialsNotRequestedError(MaterialsError):
    """El cliente no pidió material en este trabajo."""


class NotAssignedProviderError(MaterialsError):
    pass


class WrongStateError(MaterialsError):
    pass


class InvalidAmountError(MaterialsError):
    pass


class ReceiptNotFoundError(MaterialsError):
    pass


# ---------------------------------------------------------------------------

async def _assigned_provider_id(db: AsyncSession, job_id: uuid.UUID) -> Optional[uuid.UUID]:
    """Quién hace el trabajo. Vive en `job_assignments`, no en `jobs`."""
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


async def spent_cents(db: AsyncSession, job_id: uuid.UUID) -> int:
    """Suma de las facturas NO anuladas."""
    total = (
        await db.execute(
            select(func.coalesce(func.sum(JobMaterialReceipt.amount_cents), 0)).where(
                JobMaterialReceipt.job_id == job_id,
                JobMaterialReceipt.voided_at.is_(None),
            )
        )
    ).scalar_one()
    return int(total or 0)


def agreed_cents(job: Job) -> int:
    """El techo acordado para el material.

    Es lo que el PROVEEDOR cotizó en la oferta que el cliente aceptó (migración 045),
    no lo que el cliente escribió al reservar. El cliente vio ese importe con su
    justificación antes de elegir, así que aceptarlo fue aprobarlo; su presupuesto
    inicial era solo una indicación para que el proveedor supiera a qué atenerse.

    Se cae al presupuesto del cliente en los trabajos anteriores a la 045, que no
    tienen estimación de oferta.
    """
    if not job.materials_requested:
        return 0
    if job.materials_estimate_cents is not None:
        return job.materials_estimate_cents
    return job.materials_budget_cents or 0


def overage_cents(job: Job) -> int:
    """Cuánto se ha pasado de lo acordado. 0 si va dentro."""
    if not job.materials_requested:
        return 0
    return max(0, (job.materials_spent_cents or 0) - agreed_cents(job))


def needs_customer_approval(job: Job) -> bool:
    """El gasto se pasó del techo y el cliente aún no ha dicho que sí."""
    return overage_cents(job) > 0 and job.materials_overage_approved_at is None


async def recompute_totals(db: AsyncSession, job: Job) -> dict[str, Any]:
    """Vuelve a cuadrar el job con el material gastado.

    Es idempotente y se reconstruye SIEMPRE desde las partes (subtotal, impuesto,
    propina, material) en vez de sumar el incremento sobre el total anterior: sumar
    deltas es lo que hace que dos llamadas seguidas cobren el material dos veces.
    """
    gastado = await spent_cents(db, job.id)
    job.materials_spent_cents = gastado

    subtotal = job.quoted_price_cents or 0
    impuesto = job.service_tax_cents or 0
    propina = job.tip_cents or 0

    # El material entra en el neto pero NO en la base del impuesto ni de la comisión:
    # esas dos ya quedaron calculadas sobre el subtotal de mano de obra y no se tocan.
    neto = subtotal + impuesto + propina + gastado
    job.service_fee_cents = fee_service.compute_service_fee_cents(neto)
    job.total_charged_cents = neto + job.service_fee_cents

    # Al proveedor se le devuelve el material íntegro, encima de su payout de trabajo.
    comision = job.commission_amount_cents or 0
    job.provider_payout_cents = subtotal - comision + gastado

    await db.flush()
    return {
        "materials_spent_cents": gastado,
        # `budget` = lo que dijo el cliente (referencia). `agreed` = lo que cotizó el
        # proveedor y el cliente aceptó, que es el techo real.
        "materials_budget_cents": job.materials_budget_cents,
        "materials_agreed_cents": agreed_cents(job),
        "materials_overage_cents": overage_cents(job),
        "needs_customer_approval": needs_customer_approval(job),
        "subtotal_cents": subtotal,
        "service_tax_cents": impuesto,
        "service_fee_cents": job.service_fee_cents,
        "total_charged_cents": job.total_charged_cents,
        "provider_payout_cents": job.provider_payout_cents,
    }


async def add_receipt(
    db: AsyncSession,
    *,
    job_id: uuid.UUID,
    provider_user_id: uuid.UUID,
    provider_id: uuid.UUID,
    amount_cents: int,
    file_url: str,
    merchant: Optional[str] = None,
    note: Optional[str] = None,
) -> dict[str, Any]:
    """El proveedor sube una factura de material."""
    job = await db.get(Job, job_id)
    if job is None:
        raise JobNotFoundError(str(job_id))
    if not job.materials_requested:
        raise MaterialsNotRequestedError(str(job_id))
    if job.status not in _RECEIPT_OK_STATES:
        raise WrongStateError(job.status.value)
    if amount_cents <= 0:
        raise InvalidAmountError(str(amount_cents))

    asignado = await _assigned_provider_id(db, job_id)
    if asignado is None or asignado != provider_id:
        raise NotAssignedProviderError(str(job_id))

    db.add(JobMaterialReceipt(
        job_id=job_id,
        uploaded_by=provider_user_id,
        amount_cents=int(amount_cents),
        file_url=file_url,
        merchant=(merchant or None),
        note=(note or None),
    ))
    await db.flush()

    resumen = await recompute_totals(db, job)
    if resumen["needs_customer_approval"]:
        logger.info(
            "Job %s: material %sc por encima del presupuesto, pendiente de aprobacion",
            job_id, resumen["materials_overage_cents"],
        )
    return resumen


async def list_receipts(db: AsyncSession, job_id: uuid.UUID) -> list[dict[str, Any]]:
    filas = (
        await db.execute(
            select(JobMaterialReceipt)
            .where(JobMaterialReceipt.job_id == job_id)
            .order_by(JobMaterialReceipt.created_at.asc())
        )
    ).scalars().all()
    return [{
        "receiptId": str(r.id),
        "amountCents": r.amount_cents,
        "fileUrl": r.file_url,
        "merchant": r.merchant,
        "note": r.note,
        "voided": r.voided_at is not None,
        "voidReason": r.void_reason,
        "createdAt": r.created_at.isoformat() if r.created_at else None,
    } for r in filas]


async def void_receipt(
    db: AsyncSession, *, receipt_id: uuid.UUID, reason: str
) -> dict[str, Any]:
    """Anulación por el admin en una disputa. La fila se queda: el importe pudo haber
    entrado ya en un cobro y el rastro tiene que quedar."""
    receipt = await db.get(JobMaterialReceipt, receipt_id)
    if receipt is None:
        raise ReceiptNotFoundError(str(receipt_id))
    if receipt.voided_at is None:
        receipt.voided_at = datetime.now(timezone.utc)
        receipt.void_reason = reason
        await db.flush()
    job = await db.get(Job, receipt.job_id)
    return await recompute_totals(db, job)


async def approve_overage(
    db: AsyncSession, *, job_id: uuid.UUID, customer_id: uuid.UUID
) -> dict[str, Any]:
    """El cliente acepta pagar por encima del presupuesto que autorizó."""
    job = await db.get(Job, job_id)
    if job is None or job.customer_id != customer_id:
        raise JobNotFoundError(str(job_id))
    if not job.materials_requested:
        raise MaterialsNotRequestedError(str(job_id))
    if overage_cents(job) <= 0:
        # No hay nada que aprobar; se devuelve el estado en vez de un error, para que
        # la app pueda llamar sin comprobar antes.
        return await recompute_totals(db, job)
    job.materials_overage_approved_at = datetime.now(timezone.utc)
    await db.flush()
    return await recompute_totals(db, job)


def authorization_extra_cents(job: Job) -> int:
    """Lo que hay que reservar de más al autorizar el pago, por el material que
    todavía no se ha comprado.

    La autorización de Stripe se hace al aceptar la oferta, cuando no hay ni una
    factura. Si el techo retenido no incluyera el presupuesto, la captura final se
    quedaría corta y habría que pedirle al cliente una segunda autorización con el
    trabajo ya hecho — que es justo cuando peor sienta.
    """
    if not job.materials_requested:
        return 0
    pendiente = agreed_cents(job) - (job.materials_spent_cents or 0)
    return max(0, pendiente)
