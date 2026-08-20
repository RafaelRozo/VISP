"""
Job API Routes -- VISP-BE-JOBS-002
====================================

REST endpoints for job lifecycle management.

Routes:
  POST   /api/v1/jobs                         -- Create a new job (internal)
  POST   /api/v1/jobs/book                    -- Create a new job (mobile)
  GET    /api/v1/jobs/active                  -- Active jobs for current user
  GET    /api/v1/jobs/{job_id}                -- Get job detail with assignment
  PATCH  /api/v1/jobs/{job_id}/status          -- Update job status (internal)
  PATCH  /api/v1/jobs/{job_id}/update-status   -- Update job status (mobile)
  POST   /api/v1/jobs/{job_id}/cancel          -- Cancel a job
  GET    /api/v1/jobs/{job_id}/tracking        -- Real-time job tracking
  GET    /api/v1/jobs/customer/{customer_id}   -- Jobs by customer (paginated)
  GET    /api/v1/jobs/provider/{provider_id}   -- Jobs by provider (paginated)
"""

from __future__ import annotations

import logging
import uuid
from datetime import datetime, timezone
from decimal import Decimal
from typing import Any, Optional

from fastapi import APIRouter, File, HTTPException, Query, UploadFile, status
from pydantic import BaseModel, Field

from src.api.deps import CurrentUser, DBSession
from src.api.schemas.job import (
    JobBrief,
    JobCancelRequest,
    JobCreateRequest,
    JobListResponse,
    JobOut,
    JobStatusUpdateRequest,
    PaginationMeta,
)
from src.api.schemas.provider import (
    EstimatedPriceOut,
    JobCreateResponse,
    JobTrackingOut,
    MobileJobCreateRequest,
    MobileJobOut,
    MobileJobStatusUpdateRequest,
)
from src.core.config import settings
from src.services import jobService, service_zone_service

logger = logging.getLogger(__name__)

router = APIRouter(prefix="/jobs", tags=["Jobs"])


# ---------------------------------------------------------------------------
# POST /api/v1/jobs -- Create a new job
# ---------------------------------------------------------------------------

@router.post(
    "",
    response_model=JobOut,
    status_code=status.HTTP_201_CREATED,
    summary="Create a new job",
    description=(
        "Creates a new job from the closed task catalog. The SLA terms from "
        "the matching sla_profiles record are captured as an immutable snapshot "
        "at creation time. The job starts in 'draft' status."
    ),
)
async def create_job(
    db: DBSession,
    body: JobCreateRequest,
) -> JobOut:
    try:
        job = await jobService.create_job(
            db,
            customer_id=body.customer_id,
            task_id=body.task_id,
            location=body.location.model_dump(),
            schedule=body.schedule.model_dump() if body.schedule else None,
            priority=body.priority,
            is_emergency=body.is_emergency,
            customer_notes_json=body.customer_notes_json,
        )
    except jobService.TaskNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.BookingInputRequiredError as exc:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )
    except service_zone_service.OutsideServiceAreaError as exc:
        # 400, no 5xx: Cloudflare envuelve los 5xx en su propia página y el
        # usuario nunca vería este mensaje.
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=str(exc),
        )

    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# Cancelación con motivo (migración 041)
# ---------------------------------------------------------------------------


class CancelWithReasonRequest(BaseModel):
    """Motivo cerrado + texto. El código permite contar patrones; el texto explica."""

    reasonCode: str
    note: Optional[str] = Field(default=None, max_length=2000)


@router.get(
    "/cancel-reasons",
    summary="Cancellation reasons available to the caller",
    description=(
        "Devuelve los motivos según el rol. Son cerrados a propósito: con texto "
        "libre no se pueden contar patrones, y detectar al reincidente es el "
        "valor real de esto."
    ),
)
async def list_cancel_reasons(
    user: CurrentUser,
    role: str = Query("customer", pattern=r"^(customer|provider)$"),
) -> dict[str, Any]:
    from src.services.cancellation_service import reasons_for

    return {
        "data": [
            {"code": c, "label": l} for c, l in reasons_for(role).items()
        ]
    }


@router.post(
    "/{job_id}/cancel-with-reason",
    summary="Cancel an assigned job with a reason, at no cost",
    description=(
        "Cancela sin penalización y deja un reporte para que un admin lo revise.\n\n"
        "NO afecta la calificación de nadie por sí solo: eso lo decide el admin. "
        "Aplicarlo automáticamente convertiría el reporte en un arma contra quien "
        "no puede defenderse."
    ),
)
async def cancel_with_reason(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: CancelWithReasonRequest,
) -> dict[str, Any]:
    from sqlalchemy import select as sa_select

    from src.models.job import Job as JobModel
    from src.models.provider import ProviderProfile
    from src.services import cancellation_service as cancel_svc

    job = (
        await db.execute(sa_select(JobModel).where(JobModel.id == job_id))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=status.HTTP_404_NOT_FOUND, detail="Job not found.")

    # El rol se DERIVA del trabajo, no se acepta del cliente: si viniera en el
    # payload, cualquiera podría reportar como la otra parte.
    #
    # El proveedor NO está en `jobs`: se resuelve por la asignación aceptada.
    if job.customer_id == user.id:
        role = "customer"
    else:
        from src.models.job import AssignmentStatus, JobAssignment

        profile = (
            await db.execute(
                sa_select(ProviderProfile).where(ProviderProfile.user_id == user.id)
            )
        ).scalar_one_or_none()
        asignado = None
        if profile is not None:
            asignado = (
                await db.execute(
                    sa_select(JobAssignment).where(
                        JobAssignment.job_id == job.id,
                        JobAssignment.provider_id == profile.id,
                        JobAssignment.status.in_(
                            [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]
                        ),
                    )
                )
            ).scalar_one_or_none()
        if asignado is None:
            raise HTTPException(
                status_code=status.HTTP_403_FORBIDDEN,
                detail="You are not part of this job.",
            )
        role = "provider"

    try:
        report = await cancel_svc.cancel_with_report(
            db,
            job=job,
            reported_by=user.id,
            reporter_role=role,
            reason_code=body.reasonCode,
            note=body.note,
        )
    except (cancel_svc.CancellationNotAllowedError, cancel_svc.InvalidReasonCodeError) as exc:
        # 400 y no 5xx: Cloudflare envuelve los 5xx y el usuario no vería el motivo.
        raise HTTPException(status_code=status.HTTP_400_BAD_REQUEST, detail=str(exc))

    await db.commit()
    return {
        "data": {
            "jobId": str(job.id),
            "status": job.status.value,
            "reportId": str(report.id),
            # Se dice explícitamente que no hay cargo: es la duda inmediata de
            # quien acaba de cancelar.
            "charged": False,
        }
    }


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/booking-evidence -- subir las fotos ANTES de reservar
# ---------------------------------------------------------------------------
#
# Se sube antes y por separado porque el endpoint de reserva es JSON: convertirlo
# a multipart obligaría a rehacer todo el cuerpo de la petición y el flujo de
# pago que ya funciona. El cliente sube las fotos, recibe las URLs y las manda en
# `evidence` al reservar.
#
# Contrapartida asumida: si el cliente abandona el flujo, los archivos quedan
# huérfanos. Hace falta una limpieza periódica de evidencia sin job asociado
# (junto con la política de retención de `uploads/`, que crece sin límite).

_EVIDENCE_ALLOWED_MIME = {
    "image/jpeg", "image/jpg", "image/png", "image/heic", "image/heif", "image/webp",
}
# 8 MB por foto. La app debe reescalar antes de subir (lado largo ~1600px, JPEG
# 0.7 -> ~300 KB); este tope es la red de seguridad, no el objetivo.
_EVIDENCE_MAX_BYTES = 8 * 1024 * 1024

# Lado largo al que se reescala la evidencia guardada. 1600 px es de sobra para
# que un proveedor juzgue un espacio en el móvil, y deja la foto en ~200-400 KB.
_EVIDENCE_MAX_EDGE = 1600
_EVIDENCE_JPEG_QUALITY = 78


def _downscale_evidence(raw: bytes) -> bytes:
    """Reescala la foto si Pillow está disponible; si no, devuelve el original.

    POR QUÉ EN EL SERVIDOR: `expo-image-picker` comprime por calidad pero NO
    redimensiona (eso exige expo-image-manipulator, un módulo nativo, y añadirlo
    obliga a un prebuild de iOS). Reescalar aquí también protege el
    almacenamiento frente a cualquier cliente que no comprima.

    La dependencia es OPCIONAL a propósito: mientras el servidor no tenga Pillow
    instalado, esta función es un paso-a-través y la subida sigue funcionando.
    Así el código se puede desplegar antes de reconstruir la imagen de Docker.
    """
    try:
        import io

        from PIL import Image, ImageOps
    except ImportError:
        return raw

    try:
        with Image.open(io.BytesIO(raw)) as img:
            # exif_transpose respeta la orientación de la cámara: sin esto las
            # fotos verticales del iPhone se guardan tumbadas.
            img = ImageOps.exif_transpose(img)
            if max(img.size) <= _EVIDENCE_MAX_EDGE and img.format == "JPEG":
                return raw
            img.thumbnail((_EVIDENCE_MAX_EDGE, _EVIDENCE_MAX_EDGE))
            # JPEG no admite canal alfa: convertir evita reventar con PNG/HEIC.
            if img.mode not in ("RGB", "L"):
                img = img.convert("RGB")
            out = io.BytesIO()
            img.save(out, format="JPEG", quality=_EVIDENCE_JPEG_QUALITY, optimize=True)
            return out.getvalue()
    except Exception:  # noqa: BLE001
        # Un archivo que Pillow no entienda no debe tumbar la subida: se guarda
        # tal cual y el admin lo verá igual.
        logger.warning("No se pudo reescalar una foto de evidencia; se guarda el original")
        return raw


@router.post(
    "/booking-evidence",
    status_code=status.HTTP_201_CREATED,
    summary="Upload booking evidence photos",
    description=(
        "Sube hasta 5 fotos y devuelve sus URLs para mandarlas en `evidence` al "
        "reservar. Son SOPORTE DE DECISIÓN para el proveedor: las ve antes de "
        "aceptar. No cambian alcance ni precio."
    ),
)
async def upload_booking_evidence(
    db: DBSession,
    user: CurrentUser,
    files: list[UploadFile] = File(...),
) -> dict[str, Any]:
    import os

    from src.services.jobService import MAX_CUSTOMER_EVIDENCE_PHOTOS

    if len(files) > MAX_CUSTOMER_EVIDENCE_PHOTOS:
        raise HTTPException(
            status_code=status.HTTP_400_BAD_REQUEST,
            detail=(
                f"You can attach at most {MAX_CUSTOMER_EVIDENCE_PHOTOS} photos "
                f"({len(files)} given)."
            ),
        )

    uploads_dir = os.path.join(
        os.path.dirname(os.path.dirname(os.path.dirname(os.path.dirname(__file__)))),
        "uploads",
        "booking-evidence",
        str(user.id),
    )
    os.makedirs(uploads_dir, exist_ok=True)

    urls: list[str] = []
    for f in files:
        if f.content_type and f.content_type.lower() not in _EVIDENCE_ALLOWED_MIME:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=f"'{f.content_type}' is not a supported image format.",
            )
        content = await f.read()
        if not content:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail="One of the photos is empty.",
            )
        if len(content) > _EVIDENCE_MAX_BYTES:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=(
                    f"'{f.filename}' is too large "
                    f"({len(content) // (1024 * 1024)} MB). "
                    f"Maximum is {_EVIDENCE_MAX_BYTES // (1024 * 1024)} MB per photo."
                ),
            )
        safe_filename = f"{uuid.uuid4()}_{f.filename or 'evidence.jpg'}"
        with open(os.path.join(uploads_dir, safe_filename), "wb") as fh:
            fh.write(_downscale_evidence(content))
        urls.append(f"/uploads/booking-evidence/{user.id}/{safe_filename}")

    return {"data": {"urls": urls}}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/book -- Mobile-friendly job booking
# ---------------------------------------------------------------------------

@router.post(
    "/book",
    status_code=status.HTTP_201_CREATED,
    summary="Book a new job (mobile)",
    description=(
        "Mobile-friendly endpoint for booking a job. Uses camelCase request "
        "body and wraps the response in { data: { job, estimatedPrice } }. "
        "Creates the job, snapshots SLA, estimates pricing, and starts matching."
    ),
)
async def book_job(
    db: DBSession,
    user: CurrentUser,
    body: MobileJobCreateRequest,
) -> dict[str, Any]:
    import traceback as tb_mod
    try:
        # Determine priority from emergency flag
        priority = "emergency" if body.is_emergency else "standard"

        # Build schedule from scheduledAt if provided
        schedule = None
        if body.scheduled_at:
            schedule = {
                "requested_date": body.scheduled_at.date(),
                "requested_time_start": body.scheduled_at.time(),
                "requested_time_end": None,
                "flexible_schedule": False,
            }

        try:
            job = await jobService.create_job(
                db,
                customer_id=user.id,
                task_id=body.service_task_id,
                location={
                    "latitude": body.location_lat,
                    "longitude": body.location_lng,
                    "address": body.location_address,
                    "city": body.city,
                    "province_state": body.province_state,
                    "postal_zip": body.postal_zip,
                    "country": body.country,
                    "unit": body.unit,
                },
                schedule=schedule,
                priority=priority,
                is_emergency=body.is_emergency,
                customer_notes_json=body.notes or [],
                quantity=body.quantity,
                customer_details=body.details,
                customer_evidence=body.evidence,
                customer_extra_note=body.extra_note,
                customer_answers=body.answers,
                materials_requested=body.materials_requested,
                materials_budget_cents=body.materials_budget_cents,
            )
        except jobService.TaskNotFoundError as exc:
            raise HTTPException(
                status_code=status.HTTP_404_NOT_FOUND,
                detail=str(exc),
            )
        except jobService.BookingInputRequiredError as exc:
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )
        except service_zone_service.OutsideServiceAreaError as exc:
            # 400, no 5xx: Cloudflare envuelve los 5xx en su propia página y el
            # usuario nunca vería este mensaje.
            raise HTTPException(
                status_code=status.HTTP_400_BAD_REQUEST,
                detail=str(exc),
            )

        # Transition from DRAFT to PENDING_MATCH to kick off matching
        try:
            job = await jobService.update_job_status(
                db,
                job.id,
                "pending_match",
                actor_type="system",
            )
        except (jobService.JobNotFoundError, jobService.InvalidTransitionError):
            pass  # Stay in DRAFT if transition fails

        # El trabajo nace SIN PRECIO (ofertas v2, 2026-08-19).
        #
        # Antes se estampaba aquí el punto medio del rango del catálogo como
        # `quoted_price_cents`. Ya no: bajo el modelo de ofertas nadie sabe todavía
        # cuánto cuesta el trabajo, porque el precio es `tarifa del proveedor ×
        # magnitud` y ninguna de las dos existe hasta que llega una oferta. Dejar un
        # número inventado en el job sería un precio que el cliente puede llegar a ver
        # y que nadie va a cobrar.
        #
        # Lo que sí se devuelve es el RANGO DEL CATÁLOGO con su unidad, que es lo que
        # la app muestra ("70–90 CAD/h"). En los servicios por ítem se multiplica por
        # la cantidad, porque ahí sí es un total de verdad.
        from sqlalchemy import select as _select
        from src.models.taxonomy import PricingUnit, ServiceTask

        task_row = (
            await db.execute(
                _select(ServiceTask).where(ServiceTask.id == job.task_id)
            )
        ).scalar_one_or_none()

        min_cents = task_row.base_price_min_cents if task_row else None
        max_cents = task_row.base_price_max_cents if task_row else None
        if (
            task_row is not None
            and task_row.pricing_unit == PricingUnit.PER_UNIT
            and job.quantity
            and min_cents is not None
            and max_cents is not None
        ):
            min_cents = int(Decimal(min_cents) * job.quantity)
            max_cents = int(Decimal(max_cents) * job.quantity)

        estimated_price = EstimatedPriceOut(
            min_cents=min_cents or 0,
            max_cents=max_cents or 0,
            currency=job.currency,
            is_emergency=job.is_emergency,
            dynamic_multiplier=None,
        )

        # Broadcast OFFERED assignments to ALL qualified providers.
        # The job stays in PENDING_MATCH — it only transitions when a
        # provider manually accepts the offer.
        try:
            from src.services.matchingEngine import find_matching_providers
            from src.models.job import JobAssignment, AssignmentStatus
            from datetime import timedelta

            match_result = await find_matching_providers(db, job, max_results=20)
            now_utc = datetime.now(timezone.utc)
            for m in match_result.get("matches", []):
                # Create OFFERED assignment for each qualified provider
                sla_response_deadline = None
                if job.sla_response_time_min:
                    sla_response_deadline = now_utc + timedelta(
                        minutes=job.sla_response_time_min
                    )
                offer = JobAssignment(
                    job_id=job.id,
                    provider_id=m["provider_id"],
                    status=AssignmentStatus.OFFERED,
                    offered_at=now_utc,
                    match_score=Decimal(str(m["composite_score"])),
                    sla_response_deadline=sla_response_deadline,
                )
                db.add(offer)
            await db.flush()
            logger.info(
                "Broadcast %d offers for job %s",
                len(match_result.get("matches", [])),
                job.id,
            )
        except Exception as exc:
            logger.warning("Offer broadcast failed for job %s: %s", job.id, exc)

        # Build mobile-friendly response
        try:
            job_out = MobileJobOut.model_validate(job)
            response = JobCreateResponse(
                job=job_out,
                estimated_price=estimated_price,
            )
            return {"data": response.model_dump(by_alias=True)}
        except Exception as exc:
            logger.error(
                "Failed to serialise job %s for mobile response: %s",
                job.id,
                exc,
                exc_info=True,
            )
            # Return a minimal success response so the mobile client can navigate
            return {
                "data": {
                    "job": {"id": str(job.id)},
                    "estimatedPrice": {
                        "minCents": estimated_price.min_cents,
                        "maxCents": estimated_price.max_cents,
                        "currency": "CAD",
                        "isEmergency": body.is_emergency,
                        "dynamicMultiplier": None,
                    },
                }
            }

    except HTTPException:
        raise  # Let FastAPI handle HTTP exceptions normally

    except Exception as exc:
        # Catch-all: return the Python error in the response detail
        error_tb = tb_mod.format_exc()
        logger.error("book_job UNHANDLED ERROR: %s\n%s", exc, error_tb)
        raise HTTPException(
            status_code=status.HTTP_500_INTERNAL_SERVER_ERROR,
            detail=f"book_job crashed: {type(exc).__name__}: {exc}",
        )


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/active -- Active jobs for current user
# ---------------------------------------------------------------------------

@router.get(
    "/active",
    summary="Get customer's active jobs",
    description=(
        "Returns active jobs for the authenticated customer. Active means "
        "any status except completed, cancelled, disputed, and refunded."
    ),
)
async def get_active_jobs(
    db: DBSession,
    user: CurrentUser,
) -> dict[str, Any]:
    from sqlalchemy import select
    from sqlalchemy.orm import selectinload

    from src.models.job import Job, JobStatus
    from src.models.taxonomy import ServiceTask

    terminal_statuses = {
        JobStatus.COMPLETED,
        JobStatus.CANCELLED_BY_CUSTOMER,
        JobStatus.CANCELLED_BY_PROVIDER,
        JobStatus.CANCELLED_BY_SYSTEM,
        JobStatus.DISPUTED,
        JobStatus.REFUNDED,
    }

    stmt = (
        select(Job)
        .options(selectinload(Job.assignments))
        .where(
            Job.customer_id == user.id,
            Job.status.not_in(terminal_statuses),
        )
        .order_by(Job.created_at.desc())
    )
    result = await db.execute(stmt)
    jobs = result.scalars().all()

    # Build task name cache
    task_ids = {j.task_id for j in jobs if j.task_id}
    task_map: dict = {}
    if task_ids:
        task_stmt = (
            select(ServiceTask)
            .options(selectinload(ServiceTask.category))
            .where(ServiceTask.id.in_(task_ids))
        )
        tasks = (await db.execute(task_stmt)).scalars().all()
        for t in tasks:
            task_map[t.id] = {
                "name": t.name,
                "categoryName": t.category.name if t.category else None,
            }

    from src.api.routes.providers import _mobile_status

    items = []
    for j in jobs:
        item = MobileJobOut.model_validate(j).model_dump(by_alias=True)
        # Convert backend enum (UPPERCASE) to mobile-friendly lowercase
        item["status"] = _mobile_status(j.status.value)
        task_info = task_map.get(j.task_id, {})
        item["taskName"] = task_info.get("name", j.reference_number)
        item["categoryName"] = task_info.get("categoryName")
        # Scheduled datetime (requested_date + requested_time_start) so the app
        # can flag jobs whose slot passed with no provider as "expired".
        if j.requested_date is not None:
            from datetime import datetime as _dt, time as _time
            item["scheduledAt"] = _dt.combine(
                j.requested_date, j.requested_time_start or _time(0, 0)
            ).isoformat()
        else:
            item["scheduledAt"] = None
        # Cierre de la ventana de ofertas (migración 042). Es lo que de verdad
        # define si un trabajo abierto sigue vivo: pasadas las 48 h sin que nadie
        # oferte, ya no va a pasar nada y el cliente tiene que saberlo.
        item["offersCloseAt"] = (
            j.offers_close_at.isoformat() if j.offers_close_at else None
        )
        items.append(item)

    return {
        "data": {
            "items": items,
            "meta": {
                "page": 1,
                "pageSize": len(items),
                "totalItems": len(items),
                "totalPages": 1,
            },
        },
    }


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/customer/{customer_id} -- Jobs by customer
# ---------------------------------------------------------------------------
# IMPORTANT: These parameterized list routes MUST be defined before
# /{job_id} so FastAPI does not interpret "customer" as a UUID.
# ---------------------------------------------------------------------------

@router.get(
    "/customer/{customer_id}",
    response_model=JobListResponse,
    summary="List jobs by customer",
    description="Returns a paginated list of jobs for a specific customer.",
)
async def list_jobs_by_customer(
    db: DBSession,
    customer_id: uuid.UUID,
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Filter by job status",
    ),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> JobListResponse:
    try:
        result = await jobService.get_jobs_by_customer(
            db,
            customer_id,
            status_filter=status_filter,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return JobListResponse(
        data=[JobBrief.model_validate(job) for job in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/provider/{provider_id} -- Jobs by provider
# ---------------------------------------------------------------------------

@router.get(
    "/provider/{provider_id}",
    response_model=JobListResponse,
    summary="List jobs by provider",
    description=(
        "Returns a paginated list of jobs assigned to a specific provider. "
        "Only includes jobs with active (non-declined/expired) assignments."
    ),
)
async def list_jobs_by_provider(
    db: DBSession,
    provider_id: uuid.UUID,
    status_filter: str | None = Query(
        default=None,
        alias="status",
        description="Filter by job status",
    ),
    page: int = Query(default=1, ge=1, description="Page number (1-indexed)"),
    page_size: int = Query(
        default=settings.default_page_size,
        ge=1,
        le=settings.max_page_size,
        description="Number of items per page",
    ),
) -> JobListResponse:
    try:
        result = await jobService.get_jobs_by_provider(
            db,
            provider_id,
            status_filter=status_filter,
            page=page,
            page_size=page_size,
        )
    except ValueError as exc:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=str(exc),
        )

    return JobListResponse(
        data=[JobBrief.model_validate(job) for job in result.items],
        meta=PaginationMeta(
            page=result.page,
            page_size=result.page_size,
            total_items=result.total_items,
            total_pages=result.total_pages,
        ),
    )


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id} -- Get job by ID
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}",
    summary="Get job detail",
    description=(
        "Returns the full detail for a single job, including SLA snapshot, "
        "pricing, location, and schedule information."
    ),
)
async def get_job(
    db: DBSession,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    job = await jobService.get_job(db, job_id)
    if job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job with id '{job_id}' not found.",
        )

    # Build enriched response with assignment and provider info
    from src.api.routes.providers import _mobile_status

    try:
        job_data = JobOut.model_validate(job).model_dump()
        # Convert UPPERCASE enum to mobile-friendly lowercase
        job_data["status"] = _mobile_status(job.status.value)
    except Exception:
        # Fallback: manually construct the dict if Pydantic validation fails
        job_data = {
            "id": str(job.id),
            "reference_number": job.reference_number,
            "customer_id": str(job.customer_id),
            "task_id": str(job.task_id),
            "status": _mobile_status(
                job.status.value if hasattr(job.status, 'value') else str(job.status)
            ),
            "priority": job.priority.value if hasattr(job.priority, 'value') else str(job.priority),
            "is_emergency": job.is_emergency,
            "service_latitude": str(job.service_latitude),
            "service_longitude": str(job.service_longitude),
            "service_address": job.service_address,
            "service_unit": job.service_unit,
            "service_city": job.service_city,
            "service_province_state": job.service_province_state,
            "service_postal_zip": job.service_postal_zip,
            "service_country": job.service_country,
            "requested_date": str(job.requested_date) if job.requested_date else None,
            "requested_time_start": str(job.requested_time_start) if job.requested_time_start else None,
            "requested_time_end": str(job.requested_time_end) if job.requested_time_end else None,
            "flexible_schedule": job.flexible_schedule,
            "quoted_price_cents": job.quoted_price_cents,
            "final_price_cents": job.final_price_cents,
            "currency": job.currency,
            "customer_notes_json": job.customer_notes_json or [],
            "started_at": job.started_at.isoformat() if job.started_at else None,
            "completed_at": job.completed_at.isoformat() if job.completed_at else None,
            "cancelled_at": job.cancelled_at.isoformat() if job.cancelled_at else None,
            "cancellation_reason": job.cancellation_reason,
            "created_at": job.created_at.isoformat() if job.created_at else None,
            "updated_at": job.updated_at.isoformat() if job.updated_at else None,
        }

    # Attach assignment and provider info for the mobile app
    assignment_data = None
    provider_data = None
    if job.assignments:
        from src.models.job import AssignmentStatus

        active_assignment = None
        for a in job.assignments:
            if a.status in (AssignmentStatus.OFFERED, AssignmentStatus.ACCEPTED):
                active_assignment = a
                break

        if active_assignment:
            assignment_data = {
                "id": str(active_assignment.id),
                "status": active_assignment.status.value,
                "offeredAt": (
                    active_assignment.offered_at.isoformat()
                    if active_assignment.offered_at
                    else None
                ),
                "respondedAt": (
                    active_assignment.responded_at.isoformat()
                    if active_assignment.responded_at
                    else None
                ),
                "slaResponseDeadline": (
                    active_assignment.sla_response_deadline.isoformat()
                    if active_assignment.sla_response_deadline
                    else None
                ),
                "slaArrivalDeadline": (
                    active_assignment.sla_arrival_deadline.isoformat()
                    if active_assignment.sla_arrival_deadline
                    else None
                ),
                "estimatedArrivalMin": active_assignment.estimated_arrival_min,
            }

            # Load provider info
            try:
                from sqlalchemy import select
                from sqlalchemy.orm import selectinload

                from src.models.provider import ProviderProfile

                prov_stmt = (
                    select(ProviderProfile)
                    .options(selectinload(ProviderProfile.user))
                    .where(ProviderProfile.id == active_assignment.provider_id)
                )
                prov_result = await db.execute(prov_stmt)
                provider = prov_result.scalar_one_or_none()

                if provider and provider.user:
                    provider_data = {
                        "id": str(provider.id),
                        "displayName": (
                            provider.user.display_name
                            or f"{provider.user.first_name} {provider.user.last_name}"
                        ),
                        "level": provider.current_level.value,
                        "avatarUrl": provider.user.avatar_url,
                        "phone": provider.user.phone,
                        "rating": float(provider.average_rating) if provider.average_rating else None,
                        "completedJobs": provider.total_completed_jobs or 0,
                    }
            except Exception:
                pass

    return {
        "data": {
            "job": job_data,
            "assignment": assignment_data,
            "provider": provider_data,
        },
    }


# ---------------------------------------------------------------------------
# PATCH /api/v1/jobs/{job_id}/status -- Update job status (internal)
# ---------------------------------------------------------------------------

@router.patch(
    "/{job_id}/status",
    response_model=JobOut,
    summary="Update job status",
    description=(
        "Transitions a job to a new status. All transitions are validated "
        "against the state machine. Invalid transitions return 409 Conflict."
    ),
)
async def update_job_status(
    db: DBSession,
    job_id: uuid.UUID,
    body: JobStatusUpdateRequest,
) -> JobOut:
    try:
        job = await jobService.update_job_status(
            db,
            job_id,
            body.new_status,
            actor_id=body.actor_id,
            actor_type=body.actor_type,
        )
    except jobService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.JobStartNotAllowedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.reason,
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    # Reload server-side columns (e.g. updated_at onupdate) that the flush left
    # expired, so the sync JobOut serialization doesn't trigger lazy async IO.
    await db.refresh(job)
    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/cancel -- Cancel a job
# ---------------------------------------------------------------------------

@router.post(
    "/{job_id}/cancel",
    response_model=JobOut,
    summary="Cancel a job",
    description=(
        "Cancels a job. The cancellation type is determined by the actor_type: "
        "customer -> cancelled_by_customer, provider -> cancelled_by_provider, "
        "system/admin -> cancelled_by_system. Guards enforce that customers "
        "can only cancel before a provider is en route."
    ),
)
async def cancel_job(
    db: DBSession,
    job_id: uuid.UUID,
    body: JobCancelRequest,
) -> JobOut:
    try:
        job = await jobService.cancel_job(
            db,
            job_id,
            cancelled_by=body.cancelled_by,
            actor_type=body.actor_type,
            reason=body.reason,
        )
    except jobService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    return JobOut.model_validate(job)


# ---------------------------------------------------------------------------
# PATCH /api/v1/jobs/{job_id}/update-status -- Mobile-friendly status update
# ---------------------------------------------------------------------------

@router.patch(
    "/{job_id}/update-status",
    summary="Update job status (mobile)",
    description=(
        "Mobile-friendly endpoint for updating a job's status. Accepts "
        "simplified status values and determines actor type from the "
        "authenticated user."
    ),
)
async def mobile_update_job_status(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: MobileJobStatusUpdateRequest,
) -> dict[str, Any]:
    # Map mobile status values to internal status and actor type
    status_map = {
        "cancelled": "cancelled_by_customer",
        "en_route": "provider_en_route",
        "arrived": "in_progress",  # Map arrived to in_progress for now
        "in_progress": "in_progress",
        "completed": "completed",
    }

    internal_status = status_map.get(body.status)
    if internal_status is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail=f"Unknown status '{body.status}'.",
        )

    # Quién actúa se decide por su RELACIÓN CON ESTE TRABAJO, no por sus roles.
    #
    # Antes se miraba `user.role_provider`, y eso rompía a cualquier cuenta con rol
    # "both": al cancelar SU PROPIA reserva se la clasificaba como proveedor, se
    # intentaba `cancelled_by_provider` y la máquina de estados lo rechazaba con un
    # 409 — correctamente, porque un proveedor no puede cancelar un trabajo que
    # nunca le asignaron. El usuario solo veía "error al eliminar".
    #
    # Ser proveedor en la plataforma y ser EL proveedor de este trabajo son cosas
    # distintas; solo la segunda decide qué transición toca.
    from sqlalchemy import select as _select

    from src.models.job import AssignmentStatus, Job, JobAssignment

    _job = (
        await db.execute(_select(Job).where(Job.id == job_id))
    ).scalar_one_or_none()
    if _job is None:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=f"Job {job_id} not found.",
        )

    es_cliente = _job.customer_id == user.id
    es_proveedor_del_trabajo = False
    if not es_cliente:
        from src.models.provider import ProviderProfile

        prov = (
            await db.execute(
                _select(ProviderProfile).where(ProviderProfile.user_id == user.id)
            )
        ).scalars().first()
        if prov is not None:
            es_proveedor_del_trabajo = (
                await db.execute(
                    _select(JobAssignment.id)
                    .where(
                        JobAssignment.job_id == job_id,
                        JobAssignment.provider_id == prov.id,
                        JobAssignment.status.in_(
                            [AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]
                        ),
                    )
                    .limit(1)
                )
            ).scalars().first() is not None

    if user.role_admin:
        actor_type = "admin"
    elif es_cliente:
        actor_type = "customer"
    elif es_proveedor_del_trabajo:
        actor_type = "provider"
    else:
        # Ni dueño ni asignado: no tiene nada que hacer aquí.
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail="You are not part of this job.",
        )

    # Special case: cancellation
    if body.status == "cancelled":
        if actor_type == "provider":
            internal_status = "cancelled_by_provider"
        elif actor_type in ("admin", "system"):
            internal_status = "cancelled_by_system"

    try:
        job = await jobService.update_job_status(
            db,
            job_id,
            internal_status,
            actor_id=user.id,
            actor_type=actor_type,
        )
    except jobService.JobNotFoundError as exc:
        raise HTTPException(
            status_code=status.HTTP_404_NOT_FOUND,
            detail=str(exc),
        )
    except jobService.JobStartNotAllowedError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=exc.reason,
        )
    except jobService.InvalidTransitionError as exc:
        raise HTTPException(
            status_code=status.HTTP_409_CONFLICT,
            detail=str(exc),
        )

    job_out = MobileJobOut.model_validate(job)
    return {"data": {"job": job_out.model_dump(by_alias=True)}}


# ---------------------------------------------------------------------------
# GET /api/v1/jobs/{job_id}/tracking -- Real-time tracking
# ---------------------------------------------------------------------------

@router.get(
    "/{job_id}/tracking",
    summary="Get real-time job tracking info",
    description=(
        "Returns provider location, ETA, and current status for tracking "
        "the provider during an active job."
    ),
)
async def get_job_tracking(
    db: DBSession,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from src.api.routes.providers import _mobile_status
    from src.services import providerService

    tracking = await providerService.get_job_tracking(db, job_id)
    tracking["status"] = _mobile_status(tracking["status"])
    result = JobTrackingOut(**tracking)
    return {"data": result.model_dump(by_alias=True)}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/provider-location -- Update provider location
# ---------------------------------------------------------------------------

@router.post(
    "/provider-location",
    summary="Update provider location",
    description=(
        "Called by the partner app to update the provider's current GPS "
        "coordinates. This data is consumed by the customer tracking screen."
    ),
)
async def update_provider_location(
    db: DBSession,
    user: CurrentUser,
    body: dict[str, Any],
) -> dict[str, Any]:
    from src.services import providerService

    lat = body.get("latitude")
    lng = body.get("longitude")
    if lat is None or lng is None:
        raise HTTPException(
            status_code=status.HTTP_422_UNPROCESSABLE_ENTITY,
            detail="latitude and longitude are required",
        )

    await providerService.update_provider_location(
        db, user.id, float(lat), float(lng)
    )
    await db.commit()
    return {"data": {"ok": True}}


# ---------------------------------------------------------------------------
# POST /api/v1/jobs/{job_id}/rating  -- Customer submits job rating
# ---------------------------------------------------------------------------

from pydantic import BaseModel as _BaseModel, Field as _Field

class RatingSubmitRequest(_BaseModel):
    rating: int = _Field(ge=1, le=5, description="Star rating 1-5")
    tags: list[str] = _Field(default_factory=list, description="Feedback tag IDs")
    feedback: Optional[str] = _Field(default=None, description="Optional text feedback")


@router.post(
    "/{job_id}/rating",
    summary="Submit a job rating",
    description=(
        "Customer submits a star rating, optional feedback tags, and optional "
        "text feedback for a completed job. Creates a Review record with the "
        "customer as reviewer and the assigned provider as reviewee."
    ),
)
async def submit_job_rating(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: RatingSubmitRequest,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job, JobStatus, JobAssignment, AssignmentStatus
    from src.models.review import Review, ReviewStatus, ReviewerRole
    from src.models.provider import ProviderProfile

    # 1. Load job -- must belong to this customer and be completed
    job_stmt = select(Job).where(Job.id == job_id, Job.customer_id == user.id)
    job = (await db.execute(job_stmt)).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    if job.status != JobStatus.COMPLETED:
        raise HTTPException(
            status_code=409,
            detail=f"Job is not completed (current: {job.status.value})",
        )

    # 2. Check for duplicate review
    existing_review_stmt = select(Review).where(
        Review.job_id == job_id,
        Review.reviewer_id == user.id,
    )
    existing = (await db.execute(existing_review_stmt)).scalar_one_or_none()
    if existing is not None:
        raise HTTPException(
            status_code=409,
            detail="You have already rated this job",
        )

    # 3. Find the assigned provider's user_id
    assignment_stmt = select(JobAssignment).where(
        JobAssignment.job_id == job_id,
        JobAssignment.status == AssignmentStatus.COMPLETED,
    )
    assignment = (await db.execute(assignment_stmt)).scalar_one_or_none()
    if assignment is None:
        # Fallback: try accepted assignment
        assignment_stmt2 = select(JobAssignment).where(
            JobAssignment.job_id == job_id,
            JobAssignment.status == AssignmentStatus.ACCEPTED,
        )
        assignment = (await db.execute(assignment_stmt2)).scalar_one_or_none()

    if assignment is None:
        raise HTTPException(
            status_code=404,
            detail="No provider assignment found for this job",
        )

    # Get provider's user_id from ProviderProfile
    provider_stmt = select(ProviderProfile).where(
        ProviderProfile.id == assignment.provider_id,
    )
    provider = (await db.execute(provider_stmt)).scalar_one_or_none()
    if provider is None:
        raise HTTPException(
            status_code=404,
            detail="Provider profile not found",
        )

    reviewee_user_id = provider.user_id

    # 4. Build tags as comma-separated comment prefix
    tags_text = ", ".join(body.tags) if body.tags else ""
    comment_parts = []
    if tags_text:
        comment_parts.append(f"[Tags: {tags_text}]")
    if body.feedback:
        comment_parts.append(body.feedback)
    comment = " ".join(comment_parts) if comment_parts else None

    # 5. Create the Review
    review = Review(
        job_id=job_id,
        reviewer_id=user.id,
        reviewee_id=reviewee_user_id,
        reviewer_role=ReviewerRole.CUSTOMER,
        overall_rating=Decimal(str(body.rating)),
        comment=comment,
        status=ReviewStatus.PUBLISHED,
    )
    db.add(review)
    await db.flush()

    logger.info(
        "Customer %s rated job %s with %d stars",
        user.id, job_id, body.rating,
    )

    await db.commit()

    return {"data": {
        "reviewId": str(review.id),
        "rating": body.rating,
        "tags": body.tags,
        "feedback": body.feedback,
        "message": "Rating submitted successfully",
    }}


# ---------------------------------------------------------------------------
# PP4b — payment authorize / capture (destination charge, manual capture)
# ---------------------------------------------------------------------------

from pydantic import ConfigDict as _ConfigDict  # noqa: E402


class AuthorizePaymentRequest(_BaseModel):
    """Optional body for authorize-payment. A test/server-side flow may pass a
    PaymentMethod to confirm immediately; the mobile app instead confirms the
    returned clientSecret on-device."""
    model_config = _ConfigDict(populate_by_name=True)
    payment_method: Optional[str] = _Field(default=None, alias="paymentMethod")


class CapturePaymentRequest(_BaseModel):
    """Optional body for capture-payment: the reconciled actual total and, for a
    server-side test, a PaymentMethod to collect an approved overage delta."""
    model_config = _ConfigDict(populate_by_name=True)
    final_total_cents: Optional[int] = _Field(default=None, alias="finalTotalCents", gt=0)
    payment_method: Optional[str] = _Field(default=None, alias="paymentMethod")


@router.post(
    "/{job_id}/authorize-payment",
    summary="Authorize (hold) payment for a job",
    description=(
        "Places a manual-capture destination-charge hold of total_charged × 1.30 "
        "on the customer's card. The provider/company is merchant of record; "
        "VISP keeps the commission as the application fee. Returns the "
        "PaymentIntent clientSecret for on-device confirmation."
    ),
)
async def authorize_payment(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: Optional[AuthorizePaymentRequest] = None,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.integrations.stripe import PaymentError
    from src.models.job import Job
    from src.services import job_payment_service as jp

    job = (
        await db.execute(select(Job).where(Job.id == job_id, Job.customer_id == user.id))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    pm = body.payment_method if body else None
    try:
        result = await jp.authorize_job(
            db,
            job,
            customer_stripe_id=getattr(user, "stripe_customer_id", None),
            payment_method=pm,
            confirm=bool(pm),
        )
    except jp.JobNotPriceableError:
        raise HTTPException(status_code=409, detail="Job has no agreed total to charge yet")
    except jp.ProviderNotPayableError:
        raise HTTPException(status_code=409, detail="Provider has no payout account configured")
    except jp.ProviderPaymentSetupIncompleteError:
        raise HTTPException(
            status_code=409,
            detail=(
                "This professional hasn't finished setting up payments yet, so the "
                "job can't be charged. Please choose another provider or try again "
                "once they complete their payout setup."
            ),
        )
    except PaymentError as exc:
        raise HTTPException(status_code=400, detail=f"Payment authorization failed: {exc}")

    await db.commit()
    return {"data": {
        "paymentIntentId": result.id,
        "clientSecret": result.client_secret,
        "status": result.status,
        "authorizedCents": result.amount_cents,
        "amountCapturableCents": result.amount_capturable_cents,
        "applicationFeeCents": result.application_fee_cents,
    }}


@router.post(
    "/{job_id}/capture-payment",
    summary="Capture the held payment at completion",
    description=(
        "Captures the actual amount (≤ the held ceiling) for a completed job; "
        "the unused hold is released. Restricted to the job's customer or its "
        "accepted provider."
    ),
)
async def capture_payment(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
    body: Optional[CapturePaymentRequest] = None,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.integrations.stripe import PaymentError
    from src.models.job import AssignmentStatus, Job, JobAssignment
    from src.models.provider import ProviderProfile
    from src.models.user import User
    from src.services import job_payment_service as jp

    job = await db.get(Job, job_id)
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    # Authz: customer who owns the job, or the accepted provider's user.
    allowed = job.customer_id == user.id
    if not allowed:
        assignment = (
            await db.execute(
                select(JobAssignment).where(
                    JobAssignment.job_id == job_id,
                    JobAssignment.status == AssignmentStatus.ACCEPTED,
                ).limit(1)
            )
        ).scalar_one_or_none()
        if assignment is not None:
            provider = await db.get(ProviderProfile, assignment.provider_id)
            allowed = bool(provider and provider.user_id == user.id)
    if not allowed:
        raise HTTPException(status_code=403, detail="Not allowed to capture this job")

    # The customer's Stripe id (for collecting an approved overage delta).
    customer = await db.get(User, job.customer_id)
    pm = body.payment_method if body else None
    try:
        result = await jp.capture_job(
            db,
            job,
            final_total_cents=(body.final_total_cents if body else None),
            customer_stripe_id=getattr(customer, "stripe_customer_id", None),
            payment_method=pm,
            confirm=bool(pm),
        )
    except jp.PaymentNotAuthorizedError:
        raise HTTPException(status_code=409, detail="No held authorization to capture")
    except jp.OverageApprovalRequiredError as exc:
        raise HTTPException(status_code=409, detail={
            "error": "overage_approval_required",
            "actualCents": exc.actual_cents,
            "authorizedCents": exc.authorized_cents,
            "overageCents": exc.overage_cents,
        })
    except PaymentError as exc:
        raise HTTPException(status_code=400, detail=f"Payment capture failed: {exc}")

    await db.commit()
    return {"data": {
        "status": result.status,
        "capturedCents": result.amount_captured_cents,
        "applicationFeeCents": result.application_fee_cents,
        "actualTotalCents": job.actual_total_cents,
        "finalPriceCents": job.final_price_cents,
    }}


@router.post(
    "/{job_id}/approve-overage",
    summary="Customer approves charging above the authorized ceiling",
    description=(
        "Sets overage approval on a job whose actual cost exceeds the held "
        "ceiling, so a subsequent capture-payment can collect the delta."
    ),
)
async def approve_overage(
    db: DBSession,
    user: CurrentUser,
    job_id: uuid.UUID,
) -> dict[str, Any]:
    from sqlalchemy import select
    from src.models.job import Job

    job = (
        await db.execute(select(Job).where(Job.id == job_id, Job.customer_id == user.id))
    ).scalar_one_or_none()
    if job is None:
        raise HTTPException(status_code=404, detail="Job not found")

    job.overage_approved_at = datetime.now(timezone.utc)
    await db.commit()
    logger.info("Customer %s approved overage for job %s", user.id, job_id)
    return {"data": {"ok": True, "overageApprovedAt": job.overage_approved_at.isoformat()}}
