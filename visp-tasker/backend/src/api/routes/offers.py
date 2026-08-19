"""Rutas del modelo de ofertas v2 (migración 042). Ver docs/plan-ofertas-v2.md.

El cliente postea el trabajo y los proveedores ofertan; el cliente elige entre las
ofertas que recibe.

Proveedor:
  GET    /api/v1/provider/open-jobs                     -- bolsa de trabajos abiertos
  POST   /api/v1/provider/open-jobs/{job_id}/offer      -- ofertar
  DELETE /api/v1/provider/open-jobs/{job_id}/offer      -- retirar la oferta

Cliente:
  GET    /api/v1/jobs/{job_id}/offers                       -- ofertas recibidas
  POST   /api/v1/jobs/{job_id}/offers/{offer_id}/accept     -- elegir una
  POST   /api/v1/jobs/{job_id}/offers/{offer_id}/reject     -- descartar una

La bolsa del proveedor cuelga de /provider y no de /jobs a propósito: en /jobs
chocaría con `GET /jobs/{job_id}`, que capturaría "open" como si fuera un UUID y
devolvería un 422 sin sentido.
"""

from __future__ import annotations

import logging
import uuid
from typing import Any, Optional

from fastapi import APIRouter, File, Form, HTTPException, UploadFile, status
from pydantic import BaseModel, Field

from src.api.deps import CurrentUser, DBSession
from src.services import (
    file_service,
    materialsService,
    notificationService,
    offerService,
    providerService,
)

logger = logging.getLogger(__name__)

provider_router = APIRouter(prefix="/provider", tags=["Offers · Provider"])
router = APIRouter(prefix="/jobs", tags=["Offers · Customer"])


class CreateOfferIn(BaseModel):
    """Lo ÚNICO que aporta el proveedor. El precio no viaja aquí: sale de su tarifa
    de perfil, ya validada contra el rango del catálogo."""

    magnitude: Optional[float] = Field(
        default=None,
        gt=0,
        description=(
            "Horas (HOURLY), m² (PER_AREA) o metros (PER_LINEAR_M). Se ignora en "
            "PER_UNIT (la cantidad la puso el cliente) y en las unidades planas."
        ),
    )
    message: Optional[str] = Field(default=None, max_length=1000)


async def _provider_id(db: DBSession, user: CurrentUser) -> uuid.UUID:
    try:
        profile = await providerService.get_provider_profile(db, user.id)
    except providerService.ProviderNotFoundError:
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="User does not have a provider profile.",
        )
    return profile.id


# ---------------------------------------------------------------------------
# Proveedor
# ---------------------------------------------------------------------------

@provider_router.get(
    "/open-jobs",
    summary="Trabajos abiertos en los que el proveedor puede ofertar",
)
async def list_open_jobs(db: DBSession, user: CurrentUser) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    items = await offerService.list_open_jobs(db, provider_id)
    return {"data": {"items": items, "count": len(items)}}


@provider_router.post(
    "/open-jobs/{job_id}/offer",
    status_code=status.HTTP_201_CREATED,
    summary="Ofertar por un trabajo",
)
async def create_offer(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID, payload: CreateOfferIn
) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    try:
        offer = await offerService.create_offer(
            db,
            job_id=job_id,
            provider_id=provider_id,
            magnitude=payload.magnitude,
            message=payload.message,
        )
    except offerService.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found.")
    except offerService.JobNotOpenError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "job_not_open",
                "message": "This job is no longer taking offers.",
            },
        )
    except offerService.NotInvitedError:
        raise HTTPException(
            status_code=403,
            detail={
                "code": "not_invited",
                "message": "You are not qualified for this job.",
            },
        )
    except offerService.NoRateError:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "no_rate",
                "message": "Set your price for this service before making an offer.",
            },
        )
    except offerService.MagnitudeRequiredError as exc:
        raise HTTPException(
            status_code=400,
            detail={
                "code": "magnitude_required",
                "message": "Tell the customer how long (or how much) this job takes.",
                "unit": str(exc),
            },
        )
    except offerService.DuplicateOfferError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "duplicate_offer",
                "message": "You already have an offer on this job.",
            },
        )

    await db.commit()
    await db.refresh(offer)

    # La notificación nunca puede tumbar la oferta: ya está guardada y es lo que
    # importa. Si el push falla, el cliente la verá igual al abrir la pantalla.
    try:
        await notificationService.notify_offer_received(
            job_id=job_id, offer_id=offer.id, db=db
        )
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("notify_offer_received failed for offer %s: %s", offer.id, exc)

    return {
        "data": {
            "offerId": str(offer.id),
            "magnitude": float(offer.magnitude),
            "unit": offer.unit.value,
            "rateCents": offer.rate_cents,
            "subtotalCents": offer.subtotal_cents,
            "serviceTaxCents": offer.service_tax_cents,
            "totalCents": offer.total_cents,
            "status": offer.status,
            "expiresAt": offer.expires_at.isoformat() if offer.expires_at else None,
        }
    }


@provider_router.delete(
    "/open-jobs/{job_id}/offer", summary="Retirar la oferta"
)
async def withdraw_offer(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID
) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    try:
        await offerService.withdraw_offer(
            db, job_id=job_id, provider_id=provider_id
        )
    except offerService.OfferNotFoundError:
        raise HTTPException(status_code=404, detail="You have no live offer here.")
    await db.commit()
    return {"data": {"ok": True}}


# ---------------------------------------------------------------------------
# Cliente
# ---------------------------------------------------------------------------

@router.get("/{job_id}/offers", summary="Ofertas recibidas para el trabajo")
async def list_offers(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID
) -> dict[str, Any]:
    try:
        payload = await offerService.list_offers(
            db, job_id=job_id, customer_id=user.id
        )
    except offerService.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"data": payload}


@router.post("/{job_id}/offers/{offer_id}/accept", summary="Aceptar una oferta")
async def accept_offer(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID, offer_id: uuid.UUID
) -> dict[str, Any]:
    try:
        result = await offerService.accept_offer(
            db, job_id=job_id, offer_id=offer_id, customer_id=user.id
        )
    except offerService.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found.")
    except offerService.OfferNotFoundError:
        raise HTTPException(status_code=404, detail="Offer not found.")
    except offerService.JobNotOpenError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "job_not_open",
                "message": "This job already has a provider.",
            },
        )
    except offerService.OfferNotPendingError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "offer_not_pending",
                "message": "That offer is no longer available.",
            },
        )
    except offerService.NoRateError:
        # El proveedor se quedó sin tarifa entre ofertar y ser elegido. 4xx y no 5xx:
        # Cloudflare envuelve los 5xx y el cliente no vería el motivo.
        raise HTTPException(
            status_code=409,
            detail={
                "code": "provider_rate_gone",
                "message": "That provider is no longer available. Pick another offer.",
            },
        )

    await db.commit()

    try:
        await notificationService.notify_offer_accepted(
            job_id=job_id, offer_id=offer_id, db=db
        )
        await notificationService.notify_offers_closed(job_id=job_id, db=db)
        await db.commit()
    except Exception as exc:  # noqa: BLE001
        logger.warning("offer accept notifications failed for job %s: %s", job_id, exc)

    return {"data": result}


# ---------------------------------------------------------------------------
# Materiales — facturas del proveedor y aprobación del cliente
# ---------------------------------------------------------------------------

def _materials_http(exc: Exception) -> HTTPException:
    """Traduce los errores del servicio a 4xx. Nunca 5xx: Cloudflare envuelve los
    5xx en su propia página y el mensaje no llega al usuario."""
    if isinstance(exc, materialsService.JobNotFoundError):
        return HTTPException(status_code=404, detail="Job not found.")
    if isinstance(exc, materialsService.MaterialsNotRequestedError):
        return HTTPException(status_code=400, detail={
            "code": "materials_not_requested",
            "message": "The customer did not ask for materials on this job.",
        })
    if isinstance(exc, materialsService.NotAssignedProviderError):
        return HTTPException(status_code=403, detail={
            "code": "not_assigned",
            "message": "You are not the provider assigned to this job.",
        })
    if isinstance(exc, materialsService.WrongStateError):
        return HTTPException(status_code=409, detail={
            "code": "wrong_state",
            "message": "This job is not in a state where receipts can be added.",
        })
    if isinstance(exc, materialsService.InvalidAmountError):
        return HTTPException(status_code=400, detail={
            "code": "invalid_amount",
            "message": "The receipt amount must be greater than zero.",
        })
    if isinstance(exc, materialsService.ReceiptNotFoundError):
        return HTTPException(status_code=404, detail="Receipt not found.")
    raise exc


@provider_router.post(
    "/jobs/{job_id}/materials",
    status_code=status.HTTP_201_CREATED,
    summary="Subir una factura de material",
    description=(
        "El proveedor sube la factura y declara cuánto pagó. El importe se le "
        "reembolsa íntegro: no paga comisión y no se le aplica impuesto encima."
    ),
)
async def upload_material_receipt(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    amount_cents: int = Form(..., alias="amountCents", gt=0),
    file: UploadFile = File(...),
    merchant: Optional[str] = Form(default=None),
    note: Optional[str] = Form(default=None),
) -> dict[str, Any]:
    provider_id = await _provider_id(db, user)
    # El archivo se guarda ANTES de tocar la base: sin factura no hay reembolso, y es
    # lo único que separa un gasto real de un número escrito a mano.
    file_url = await file_service.save_upload_file(file)
    try:
        resumen = await materialsService.add_receipt(
            db,
            job_id=job_id,
            provider_user_id=user.id,
            provider_id=provider_id,
            amount_cents=amount_cents,
            file_url=file_url,
            merchant=merchant,
            note=note,
        )
    except materialsService.MaterialsError as exc:
        raise _materials_http(exc)
    await db.commit()
    return {"data": resumen}


@provider_router.get(
    "/jobs/{job_id}/materials", summary="Facturas de material del trabajo"
)
async def provider_list_materials(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID
) -> dict[str, Any]:
    await _provider_id(db, user)
    return {"data": {"receipts": await materialsService.list_receipts(db, job_id)}}


@router.get("/{job_id}/materials", summary="Material gastado en el trabajo")
async def customer_list_materials(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID
) -> dict[str, Any]:
    from src.models.job import Job

    job = await db.get(Job, job_id)
    if job is None or job.customer_id != user.id:
        raise HTTPException(status_code=404, detail="Job not found.")
    return {"data": {
        "materialsRequested": job.materials_requested,
        "budgetCents": job.materials_budget_cents,
        "spentCents": job.materials_spent_cents,
        "overageCents": materialsService.overage_cents(job),
        "needsApproval": materialsService.needs_customer_approval(job),
        "receipts": await materialsService.list_receipts(db, job_id),
    }}


@router.post(
    "/{job_id}/materials/approve-overage",
    summary="Aprobar el gasto de material por encima del presupuesto",
)
async def approve_materials_overage(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID
) -> dict[str, Any]:
    try:
        resumen = await materialsService.approve_overage(
            db, job_id=job_id, customer_id=user.id
        )
    except materialsService.MaterialsError as exc:
        raise _materials_http(exc)
    await db.commit()
    return {"data": resumen}


@router.post("/{job_id}/offers/{offer_id}/reject", summary="Descartar una oferta")
async def reject_offer(
    db: DBSession, user: CurrentUser, job_id: uuid.UUID, offer_id: uuid.UUID
) -> dict[str, Any]:
    try:
        await offerService.reject_offer(
            db, job_id=job_id, offer_id=offer_id, customer_id=user.id
        )
    except offerService.JobNotFoundError:
        raise HTTPException(status_code=404, detail="Job not found.")
    except offerService.OfferNotFoundError:
        raise HTTPException(status_code=404, detail="Offer not found.")
    except offerService.OfferNotPendingError:
        raise HTTPException(
            status_code=409,
            detail={
                "code": "offer_not_pending",
                "message": "That offer is no longer available.",
            },
        )
    await db.commit()
    return {"data": {"ok": True}}
