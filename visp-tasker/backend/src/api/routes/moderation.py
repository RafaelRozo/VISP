"""Denunciar y bloquear (Apple, guía 1.2) — migración 055.

App:
  POST   /api/v1/reports                   — denunciar (y opcionalmente bloquear)
  POST   /api/v1/blocks                    — bloquear desde el menú "⋯"

Admin:
  GET    /api/v1/admin/reports             — la cola (status=OPEN|ACTIONED|DISMISSED|all)
  GET    /api/v1/admin/reports/summary     — contadores del Dashboard y la barra lateral
  POST   /api/v1/admin/reports/{id}/resolve
  GET    /api/v1/admin/blocks?q=           — bloqueos, por nombre o email
  POST   /api/v1/admin/blocks/{id}/unblock — desbloquear (con nota)

No hay desbloqueo en la app: quien quiera desbloquear escribe a soporte
(decisión de Ricardo, 2026-10-06). Ver `docs/plan-denunciar-bloquear.md`.

Los errores van como `{"detail": {"code", "message"}}` y siempre 4xx: Cloudflare
envuelve los 5xx y la app no vería el motivo.
"""

from __future__ import annotations

import uuid
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, status
from pydantic import BaseModel, Field

from src.api.deps import CurrentAdmin, CurrentUser, DBSession
from src.services import moderation_service as mod

router = APIRouter(tags=["Moderation"])
admin_router = APIRouter(prefix="/admin", tags=["Admin – Moderation"])


def _http(exc: mod.ModerationError) -> HTTPException:
    codes = {
        mod.NotRelatedError: status.HTTP_403_FORBIDDEN,
        mod.JobActiveError: status.HTTP_409_CONFLICT,
        mod.ReportNotFoundError: status.HTTP_404_NOT_FOUND,
        mod.BlockNotFoundError: status.HTTP_404_NOT_FOUND,
    }
    detail: dict[str, Any] = {"code": exc.code, "message": str(exc)}
    if isinstance(exc, mod.JobActiveError):
        # La app abre el botón de pánico de ESTE trabajo.
        detail["jobId"] = str(exc.job_id)
    return HTTPException(status_code=codes.get(type(exc), status.HTTP_400_BAD_REQUEST), detail=detail)


# ---------------------------------------------------------------------------
# App
# ---------------------------------------------------------------------------

class ReportRequest(BaseModel):
    jobId: uuid.UUID
    contentType: str
    reason: str
    note: Optional[str] = Field(default=None, max_length=mod.MAX_NOTE_LENGTH)
    # El id del mensaje cuando contentType = CHAT_MESSAGE.
    contentId: Optional[uuid.UUID] = None
    # El cliente denuncia la tarjeta de UNA oferta: dice cuál.
    offerId: Optional[uuid.UUID] = None
    block: bool = False


class BlockRequest(BaseModel):
    jobId: uuid.UUID
    offerId: Optional[uuid.UUID] = None


@router.post("/reports", status_code=status.HTTP_201_CREATED, summary="Report content or a user")
async def create_report(db: DBSession, user: CurrentUser, body: ReportRequest) -> dict[str, Any]:
    try:
        report, block = await mod.create_report(
            db,
            reporter_id=user.id,
            job_id=body.jobId,
            content_type=body.contentType,
            reason=body.reason,
            note=body.note,
            content_id=body.contentId,
            offer_id=body.offerId,
            block=body.block,
        )
    except mod.ModerationError as exc:
        raise _http(exc)
    await db.commit()
    return {"data": {"reportId": str(report.id), "blocked": block is not None}}


@router.post("/blocks", status_code=status.HTTP_201_CREATED, summary="Block a user")
async def create_block(db: DBSession, user: CurrentUser, body: BlockRequest) -> dict[str, Any]:
    try:
        await mod.block_user(db, user_id=user.id, job_id=body.jobId, offer_id=body.offerId)
    except mod.ModerationError as exc:
        raise _http(exc)
    await db.commit()
    return {"data": {"blocked": True}}


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

class ResolveRequest(BaseModel):
    action: str
    note: Optional[str] = Field(default=None, max_length=2000)


class UnblockRequest(BaseModel):
    note: str = Field(min_length=1, max_length=2000)


@admin_router.get("/reports/summary", summary="Open reports counters")
async def reports_summary(db: DBSession, _: CurrentAdmin) -> dict[str, Any]:
    return {"data": await mod.reports_summary(db)}


@admin_router.get("/reports", summary="Content reports queue")
async def list_reports(
    db: DBSession, _: CurrentAdmin, status_filter: Optional[str] = "OPEN"
) -> dict[str, Any]:
    filtro = None if (status_filter or "").lower() == "all" else (status_filter or "OPEN").upper()
    return {"data": await mod.list_reports(db, status=filtro)}


@admin_router.post("/reports/{report_id}/resolve", summary="Resolve a content report")
async def resolve_report(
    db: DBSession, admin: CurrentAdmin, report_id: uuid.UUID, body: ResolveRequest
) -> dict[str, Any]:
    # Suspender o expulsar cambia el estado de la cuenta: lo mismo que en Users,
    # solo un super_admin.
    if body.action in ("suspend", "ban") and getattr(admin, "role", None) != "super_admin":
        raise HTTPException(
            status_code=status.HTTP_403_FORBIDDEN,
            detail={"code": "super_admin_required", "message": "Only a super_admin can suspend or ban."},
        )
    try:
        report = await mod.resolve_report(
            db, admin_id=admin.id, report_id=report_id, action=body.action, note=body.note
        )
    except mod.ModerationError as exc:
        raise _http(exc)
    await db.commit()
    return {"data": {"id": str(report.id), "status": report.status, "adminAction": report.admin_action}}


@admin_router.get("/blocks", summary="User blocks, searchable by name or email")
async def list_blocks(db: DBSession, _: CurrentAdmin, q: Optional[str] = None) -> dict[str, Any]:
    return {"data": await mod.list_blocks(db, q=q)}


@admin_router.post("/blocks/{block_id}/unblock", summary="Unblock (admin only, note required)")
async def remove_block(
    db: DBSession, admin: CurrentAdmin, block_id: uuid.UUID, body: UnblockRequest
) -> dict[str, Any]:
    try:
        await mod.remove_block(db, admin_id=admin.id, block_id=block_id, note=body.note)
    except mod.ModerationError as exc:
        raise _http(exc)
    await db.commit()
    return {"data": {"removed": True}}
