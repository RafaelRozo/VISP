"""Denunciar y bloquear (Apple, guía 1.2) — migración 055.

Ver `docs/plan-denunciar-bloquear.md`. Las reglas que no se pueden perder:

* **El bloqueo es en las dos direcciones.** La fila guarda quién lo pidió, pero
  `blocked_user_ids` devuelve a los dos lados: si A bloquea a B, B tampoco
  puede escribir a A ni ofertarle.
* **Un bloqueo nunca deja un trabajo a medias.** Si hay un trabajo asignado
  entre los dos, `create_block` se niega con `JobActiveError` y la app manda al
  botón de pánico (`cancel-with-reason` con `block=true`), que cancela el
  trabajo y bloquea en la misma transacción.
* **Solo se denuncia o bloquea a alguien con quien se comparte un trabajo.** La
  contraparte la deduce el servidor a partir del trabajo; la app no puede
  inventársela.
* **Desbloquear es solo del admin**, y queda registrado en `moderation_actions`.
"""

from __future__ import annotations

import logging
import re
import uuid
from datetime import datetime, timedelta, timezone
from typing import Any, Optional

from sqlalchemy import and_, delete, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.chat import ChatMessage
from src.models.job import AssignmentStatus, Job, JobAssignment, JobCancellationReport, JobStatus
from src.models.job_offer import JobOffer, OfferStatus
from src.models.moderation import ContentReport, ModerationAction, UserBlock
from src.models.provider import ProviderProfile
from src.models.user import User, UserStatus

logger = logging.getLogger(__name__)


# ---------------------------------------------------------------------------
# Errores
# ---------------------------------------------------------------------------

class ModerationError(Exception):
    """Base. Cada subclase lleva el `code` que la app recibe."""

    code = "moderation_error"


class NotRelatedError(ModerationError):
    """No compartes ningún trabajo con esa persona (o el contenido no es suyo)."""

    code = "not_related"


class JobActiveError(ModerationError):
    """Hay un trabajo asignado entre los dos: se bloquea desde el botón de pánico."""

    code = "job_active"

    def __init__(self, job_id: uuid.UUID) -> None:
        self.job_id = job_id
        super().__init__("There is an active job with this person.")


class InvalidReportError(ModerationError):
    code = "invalid_report"


class ReportNotFoundError(ModerationError):
    code = "report_not_found"


class BlockNotFoundError(ModerationError):
    code = "block_not_found"


# ---------------------------------------------------------------------------
# Constantes
# ---------------------------------------------------------------------------

CONTENT_TYPES = ("USER", "CHAT_MESSAGE", "JOB_DETAILS", "JOB_EVIDENCE", "PROFILE")
REASONS = ("HARASSMENT", "OFFENSIVE", "INAPPROPRIATE_PHOTO", "SCAM", "SAFETY", "OTHER")
ADMIN_ACTIONS = ("dismiss", "remove_content", "suspend", "ban")
MAX_NOTE_LENGTH = 500

# El trabajo está asignado: hay un proveedor comprometido. Son exactamente los
# estados que el botón de pánico sabe cancelar, y por eso son los que impiden
# bloquear directamente.
ASSIGNED_STATUSES = frozenset({
    JobStatus.SCHEDULED,
    JobStatus.PROVIDER_ACCEPTED,
    JobStatus.PROVIDER_EN_ROUTE,
    JobStatus.IN_PROGRESS,
})

# Estados en los que el trabajo sigue en la bolsa y un proveedor puede verlo.
_OPEN_STATUSES = frozenset({JobStatus.PENDING_MATCH, JobStatus.MATCHED, JobStatus.PENDING_APPROVAL})

# Filtro automático del chat. NO bloquea el mensaje —en servicios del hogar
# "fuego" o "gas" son palabras normales—: abre una denuncia para que la revise
# una persona. Por eso aquí solo van insultos y amenazas inequívocos, y no la
# lista de `chatService._SAFETY_KEYWORDS`, que incluye "fire" o "emergency".
_ABUSE_WORDS = [
    # en
    "kill you", "i will kill", "weapon", "rape",
    # Sin "gun": "caulking gun" o "glue gun" son herramientas del oficio.
    "harass", "assault",
    "fuck", "fucking", "shit", "bitch", "asshole", "cunt", "slut", "whore",
    "bastard", "dickhead", "retard", "nigger", "faggot",
    # fr
    "je vais te tuer", "merde", "putain", "salope", "connard", "connasse",
    "enculé", "encule", "pute", "batard", "bâtard", "nègre", "pédé",
]
_ABUSE_PATTERN = re.compile(
    r"\b(" + "|".join(re.escape(w) for w in _ABUSE_WORDS) + r")\b",
    re.IGNORECASE,
)


# ---------------------------------------------------------------------------
# Bloqueos: la consulta que usan el chat, el matching y las ofertas
# ---------------------------------------------------------------------------

async def blocked_user_ids(db: AsyncSession, user_id: uuid.UUID) -> set[uuid.UUID]:
    """Todas las personas con las que `user_id` tiene un bloqueo, en cualquier dirección."""
    rows = (
        await db.execute(
            select(UserBlock.blocker_id, UserBlock.blocked_id).where(
                or_(UserBlock.blocker_id == user_id, UserBlock.blocked_id == user_id)
            )
        )
    ).all()
    return {b if a == user_id else a for a, b in rows}


async def is_blocked(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> bool:
    """¿Hay un bloqueo entre A y B, lo haya pedido quien lo haya pedido?"""
    found = (
        await db.execute(
            select(UserBlock.id)
            .where(
                or_(
                    and_(UserBlock.blocker_id == a, UserBlock.blocked_id == b),
                    and_(UserBlock.blocker_id == b, UserBlock.blocked_id == a),
                )
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return found is not None


async def active_job_between(
    db: AsyncSession, a: uuid.UUID, b: uuid.UUID
) -> Optional[uuid.UUID]:
    """Un trabajo asignado entre A y B (en cualquier rol), o None."""
    row = (
        await db.execute(
            select(Job.id)
            .join(JobAssignment, JobAssignment.job_id == Job.id)
            .join(ProviderProfile, ProviderProfile.id == JobAssignment.provider_id)
            .where(
                Job.status.in_(ASSIGNED_STATUSES),
                JobAssignment.status == AssignmentStatus.ACCEPTED,
                or_(
                    and_(Job.customer_id == a, ProviderProfile.user_id == b),
                    and_(Job.customer_id == b, ProviderProfile.user_id == a),
                ),
            )
            .limit(1)
        )
    ).scalar_one_or_none()
    return row


# ---------------------------------------------------------------------------
# A quién se denuncia o bloquea: lo decide el servidor a partir del trabajo
# ---------------------------------------------------------------------------

async def assigned_provider_user(db: AsyncSession, job_id: uuid.UUID) -> Optional[uuid.UUID]:
    return (
        await db.execute(
            select(ProviderProfile.user_id)
            .join(JobAssignment, JobAssignment.provider_id == ProviderProfile.id)
            .where(
                JobAssignment.job_id == job_id,
                JobAssignment.status.in_([AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]),
            )
            .limit(1)
        )
    ).scalar_one_or_none()


async def _provider_can_see_job(db: AsyncSession, job: Job, user_id: uuid.UUID) -> bool:
    """El proveedor tiene relación con el trabajo: ofertó, lo tiene asignado o lo ve en la bolsa."""
    profile = (
        await db.execute(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    ).scalar_one_or_none()
    if profile is None:
        return False

    has_link = (
        await db.execute(
            select(JobOffer.id)
            .where(JobOffer.job_id == job.id, JobOffer.provider_id == profile.id)
            .union_all(
                select(JobAssignment.id).where(
                    JobAssignment.job_id == job.id, JobAssignment.provider_id == profile.id
                )
            )
            .limit(1)
        )
    ).first()
    if has_link is not None:
        return True

    if job.status not in _OPEN_STATUSES:
        return False
    from src.services.matchingEngine import BID_SCHEDULE_CONFLICT, provider_can_bid

    motivo = await provider_can_bid(db, job, profile)
    return motivo is None or motivo == BID_SCHEDULE_CONFLICT


async def resolve_counterpart(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    offer_id: Optional[uuid.UUID] = None,
    message_id: Optional[uuid.UUID] = None,
) -> tuple[Job, uuid.UUID, str]:
    """(trabajo, la otra persona, el rol de quien pide: 'customer' | 'provider').

    - Con `message_id`: el autor del mensaje, que tiene que ser del trabajo y no tuyo.
    - Cliente con `offer_id`: el proveedor de esa oferta.
    - Cliente sin oferta: el proveedor asignado.
    - Proveedor: el cliente, si tiene relación con el trabajo.
    """
    job = await db.get(Job, job_id)
    if job is None:
        raise NotRelatedError("Job not found.")

    is_customer = job.customer_id == user_id

    if message_id is not None:
        msg = await db.get(ChatMessage, message_id)
        if msg is None or msg.job_id != job.id or msg.sender_id == user_id:
            raise NotRelatedError("Message not found in this job.")
        if is_customer:
            return job, msg.sender_id, "customer"
        if await assigned_provider_user(db, job.id) == user_id:
            return job, msg.sender_id, "provider"
        raise NotRelatedError("You are not part of this chat.")

    if is_customer:
        if offer_id is not None:
            offer = await db.get(JobOffer, offer_id)
            if offer is None or offer.job_id != job.id:
                raise NotRelatedError("Offer not found in this job.")
            provider_user = (
                await db.execute(
                    select(ProviderProfile.user_id).where(ProviderProfile.id == offer.provider_id)
                )
            ).scalar_one_or_none()
        else:
            provider_user = await assigned_provider_user(db, job.id)
        if provider_user is None:
            raise NotRelatedError("There is no provider on this job yet.")
        return job, provider_user, "customer"

    if await _provider_can_see_job(db, job, user_id):
        return job, job.customer_id, "provider"
    raise NotRelatedError("You are not part of this job.")


# ---------------------------------------------------------------------------
# Bloquear
# ---------------------------------------------------------------------------

async def _withdraw_offers_between(db: AsyncSession, a: uuid.UUID, b: uuid.UUID) -> int:
    """Retira las ofertas vivas entre los dos: un bloqueado no puede seguir esperando que lo elijan."""
    offers = (
        await db.execute(
            select(JobOffer)
            .join(Job, Job.id == JobOffer.job_id)
            .join(ProviderProfile, ProviderProfile.id == JobOffer.provider_id)
            .where(
                JobOffer.status == OfferStatus.PENDING,
                or_(
                    and_(Job.customer_id == a, ProviderProfile.user_id == b),
                    and_(Job.customer_id == b, ProviderProfile.user_id == a),
                ),
            )
        )
    ).scalars().all()
    now = datetime.now(timezone.utc)
    for offer in offers:
        offer.status = OfferStatus.WITHDRAWN
        offer.responded_at = now
    return len(offers)


async def create_block(
    db: AsyncSession,
    *,
    blocker_id: uuid.UUID,
    blocked_id: uuid.UUID,
    source: str,
    job_id: Optional[uuid.UUID] = None,
    cancellation_report_id: Optional[uuid.UUID] = None,
    content_report_id: Optional[uuid.UUID] = None,
    allow_active_job: bool = False,
) -> UserBlock:
    """Crea el bloqueo (o devuelve el que ya había). No hace commit.

    `allow_active_job=True` solo lo pasa el botón de pánico, que acaba de
    cancelar el trabajo en la misma transacción.
    """
    if blocker_id == blocked_id:
        raise NotRelatedError("You cannot block yourself.")

    if not allow_active_job:
        activo = await active_job_between(db, blocker_id, blocked_id)
        if activo is not None:
            raise JobActiveError(activo)

    existing = (
        await db.execute(
            select(UserBlock).where(
                UserBlock.blocker_id == blocker_id, UserBlock.blocked_id == blocked_id
            )
        )
    ).scalar_one_or_none()
    if existing is not None:
        return existing

    block = UserBlock(
        blocker_id=blocker_id,
        blocked_id=blocked_id,
        job_id=job_id,
        source=source,
        cancellation_report_id=cancellation_report_id,
        content_report_id=content_report_id,
    )
    db.add(block)
    retiradas = await _withdraw_offers_between(db, blocker_id, blocked_id)
    await db.flush()
    logger.info(
        "Block %s -> %s (source=%s, job=%s); %d pending offers withdrawn.",
        blocker_id, blocked_id, source, job_id, retiradas,
    )
    return block


async def panic_counterpart(db: AsyncSession, *, job: Job, user_id: uuid.UUID) -> uuid.UUID:
    """A quién bloquea el botón de pánico. Se resuelve ANTES de cancelar.

    La cancelación suelta (o cobra) la retención de Stripe, y eso no lo deshace
    un rollback: si no hay a quién bloquear hay que saberlo antes de tocar nada.
    """
    other = (
        await assigned_provider_user(db, job.id) if job.customer_id == user_id else job.customer_id
    )
    if other is None:
        raise NotRelatedError("There is nobody to block on this job.")
    return other


async def block_from_panic(
    db: AsyncSession,
    *,
    job: Job,
    user_id: uuid.UUID,
    other_id: uuid.UUID,
    cancellation_report: JobCancellationReport,
) -> UserBlock:
    """El bloqueo del botón de pánico: el trabajo ya se canceló en esta transacción."""
    return await create_block(
        db,
        blocker_id=user_id,
        blocked_id=other_id,
        source="PANIC",
        job_id=job.id,
        cancellation_report_id=cancellation_report.id,
        allow_active_job=True,
    )


# ---------------------------------------------------------------------------
# Denunciar
# ---------------------------------------------------------------------------

def _display_name(user: Optional[User]) -> Optional[str]:
    if user is None:
        return None
    return user.display_name or f"{user.first_name} {user.last_name}".strip()


async def _snapshot(
    db: AsyncSession,
    *,
    content_type: str,
    job: Job,
    reported_user_id: uuid.UUID,
    message_id: Optional[uuid.UUID],
) -> dict[str, Any]:
    """Copia de lo denunciado tal como estaba. Es la prueba que verá el admin."""
    reported = await db.get(User, reported_user_id)
    snap: dict[str, Any] = {
        "reportedName": _display_name(reported),
        "jobReference": job.reference_number,
    }
    if content_type == "CHAT_MESSAGE" and message_id is not None:
        msg = await db.get(ChatMessage, message_id)
        if msg is not None:
            snap["message"] = msg.message_text
            snap["messageSentAt"] = msg.created_at.isoformat() if msg.created_at else None
    elif content_type in ("JOB_DETAILS", "JOB_EVIDENCE"):
        snap["details"] = job.customer_details
        snap["extraNote"] = job.customer_extra_note
        snap["evidence"] = job.customer_evidence_json or []
    elif content_type == "PROFILE":
        profile = (
            await db.execute(
                select(ProviderProfile).where(ProviderProfile.user_id == reported_user_id)
            )
        ).scalar_one_or_none()
        snap["bio"] = profile.bio if profile else None
        snap["avatarUrl"] = reported.avatar_url if reported else None
    return snap


async def create_report(
    db: AsyncSession,
    *,
    reporter_id: uuid.UUID,
    job_id: uuid.UUID,
    content_type: str,
    reason: str,
    note: Optional[str] = None,
    content_id: Optional[uuid.UUID] = None,
    offer_id: Optional[uuid.UUID] = None,
    block: bool = False,
) -> tuple[ContentReport, Optional[UserBlock]]:
    """Guarda la denuncia y, si se pidió, el bloqueo. No hace commit.

    Con `block=True` y un trabajo asignado entre los dos se lanza
    `JobActiveError` ANTES de guardar nada: la app tiene que ir al botón de
    pánico, y una denuncia a medias sin su bloqueo confundiría al admin.
    """
    if content_type not in CONTENT_TYPES:
        raise InvalidReportError(f"Unknown content type '{content_type}'.")
    if reason not in REASONS:
        raise InvalidReportError(f"Unknown reason '{reason}'.")
    texto = (note or "").strip() or None
    if texto and len(texto) > MAX_NOTE_LENGTH:
        raise InvalidReportError(f"The note can have at most {MAX_NOTE_LENGTH} characters.")
    if reason == "OTHER" and not texto:
        raise InvalidReportError("Tell us what happened — with 'other' the note is required.")

    message_id = content_id if content_type == "CHAT_MESSAGE" else None
    if content_type == "CHAT_MESSAGE" and message_id is None:
        raise InvalidReportError("A chat message report needs the message id.")

    job, other, role = await resolve_counterpart(
        db, user_id=reporter_id, job_id=job_id, offer_id=offer_id, message_id=message_id
    )
    # Lo que cada lado puede ver de verdad: el proveedor ve los detalles y fotos
    # del cliente; el cliente ve la tarjeta (perfil) del proveedor.
    if content_type in ("JOB_DETAILS", "JOB_EVIDENCE") and role != "provider":
        raise InvalidReportError("Only the provider can report the job details.")
    if content_type == "PROFILE" and role != "customer":
        raise InvalidReportError("Only the customer can report a provider profile.")

    if block:
        activo = await active_job_between(db, reporter_id, other)
        if activo is not None:
            raise JobActiveError(activo)

    report = ContentReport(
        reporter_id=reporter_id,
        reported_user_id=other,
        job_id=job.id,
        source="USER",
        content_type=content_type,
        content_id=message_id,
        reason=reason,
        note=texto,
        snapshot=await _snapshot(
            db, content_type=content_type, job=job, reported_user_id=other, message_id=message_id
        ),
        status="OPEN",
    )
    db.add(report)
    await db.flush()

    blk: Optional[UserBlock] = None
    if block:
        blk = await create_block(
            db,
            blocker_id=reporter_id,
            blocked_id=other,
            source="REPORT",
            job_id=job.id,
            content_report_id=report.id,
        )

    logger.info(
        "Report %s: %s reported %s (%s, %s) on job %s; block=%s.",
        report.id, reporter_id, other, content_type, reason, job.id, block,
    )
    return report, blk


async def block_user(
    db: AsyncSession,
    *,
    user_id: uuid.UUID,
    job_id: uuid.UUID,
    offer_id: Optional[uuid.UUID] = None,
) -> UserBlock:
    """Bloquear desde el menú "⋯" (sin trabajo asignado entre los dos)."""
    job, other, _ = await resolve_counterpart(db, user_id=user_id, job_id=job_id, offer_id=offer_id)
    return await create_block(db, blocker_id=user_id, blocked_id=other, source="MENU", job_id=job.id)


async def auto_flag_chat_message(db: AsyncSession, msg: ChatMessage) -> Optional[ContentReport]:
    """Filtro automático: abre una denuncia si el mensaje trae insultos o amenazas.

    El mensaje se entrega igual. Lo revisa una persona.
    """
    match = _ABUSE_PATTERN.search(msg.message_text or "")
    if match is None:
        return None
    job = await db.get(Job, msg.job_id)
    if job is None:
        return None
    report = ContentReport(
        reporter_id=None,
        reported_user_id=msg.sender_id,
        job_id=msg.job_id,
        source="AUTO_FILTER",
        content_type="CHAT_MESSAGE",
        content_id=msg.id,
        reason="OFFENSIVE",
        note=f"Auto-filter matched: '{match.group()}'",
        snapshot={
            "reportedName": _display_name(await db.get(User, msg.sender_id)),
            "jobReference": job.reference_number,
            "message": msg.message_text,
        },
        status="OPEN",
    )
    db.add(report)
    await db.flush()
    logger.warning("AUTO_FILTER report %s on message %s (job %s).", report.id, msg.id, msg.job_id)
    return report


async def hidden_message_ids(
    db: AsyncSession, *, user_id: uuid.UUID, job_id: uuid.UUID
) -> set[uuid.UUID]:
    """Mensajes que este usuario denunció en este trabajo: dejan de mostrársele."""
    rows = (
        await db.execute(
            select(ContentReport.content_id).where(
                ContentReport.reporter_id == user_id,
                ContentReport.job_id == job_id,
                ContentReport.content_type == "CHAT_MESSAGE",
                ContentReport.content_id.isnot(None),
            )
        )
    ).scalars().all()
    return set(rows)


# ---------------------------------------------------------------------------
# Admin
# ---------------------------------------------------------------------------

def _user_card(user: Optional[User]) -> Optional[dict[str, Any]]:
    if user is None:
        return None
    return {
        "id": str(user.id),
        "name": _display_name(user),
        "email": user.email,
        "status": user.status.value if hasattr(user.status, "value") else str(user.status),
    }


async def _users_by_id(db: AsyncSession, ids: set[uuid.UUID]) -> dict[uuid.UUID, User]:
    ids = {i for i in ids if i is not None}
    if not ids:
        return {}
    return {u.id: u for u in (await db.execute(select(User).where(User.id.in_(ids)))).scalars()}


async def list_reports(db: AsyncSession, *, status: Optional[str] = "OPEN") -> list[dict[str, Any]]:
    stmt = select(ContentReport).order_by(ContentReport.created_at.asc())
    if status:
        stmt = stmt.where(ContentReport.status == status)
    reports = (await db.execute(stmt.limit(500))).scalars().all()

    users = await _users_by_id(
        db, {r.reporter_id for r in reports} | {r.reported_user_id for r in reports}
    )
    now = datetime.now(timezone.utc)
    out = []
    for r in reports:
        out.append({
            "id": str(r.id),
            "source": r.source,
            "contentType": r.content_type,
            "contentId": str(r.content_id) if r.content_id else None,
            "reason": r.reason,
            "note": r.note,
            "snapshot": r.snapshot,
            "status": r.status,
            "jobId": str(r.job_id) if r.job_id else None,
            "reporter": _user_card(users.get(r.reporter_id)),
            "reported": _user_card(users.get(r.reported_user_id)),
            "createdAt": r.created_at.isoformat(),
            "overdue": r.status == "OPEN" and now - r.created_at > timedelta(hours=24),
            "adminAction": r.admin_action,
            "adminNote": r.admin_note,
            "reviewedAt": r.reviewed_at.isoformat() if r.reviewed_at else None,
        })
    return out


async def reports_summary(db: AsyncSession) -> dict[str, int]:
    """Lo que pinta el Dashboard y el contador de la barra lateral."""
    limite = datetime.now(timezone.utc) - timedelta(hours=24)
    abiertas = (
        await db.execute(
            select(func.count()).select_from(ContentReport).where(ContentReport.status == "OPEN")
        )
    ).scalar_one()
    vencidas = (
        await db.execute(
            select(func.count())
            .select_from(ContentReport)
            .where(ContentReport.status == "OPEN", ContentReport.created_at < limite)
        )
    ).scalar_one()
    panico = (
        await db.execute(
            select(func.count())
            .select_from(JobCancellationReport)
            .where(JobCancellationReport.status == "PENDING")
        )
    ).scalar_one()
    return {"open": abiertas, "overdue": vencidas, "panicPending": panico}


async def _remove_content(db: AsyncSession, report: ContentReport) -> None:
    now = datetime.now(timezone.utc)
    if report.content_type == "CHAT_MESSAGE" and report.content_id:
        msg = await db.get(ChatMessage, report.content_id)
        if msg is not None:
            msg.removed_at = now
    elif report.content_type in ("JOB_DETAILS", "JOB_EVIDENCE") and report.job_id:
        job = await db.get(Job, report.job_id)
        if job is not None:
            if report.content_type == "JOB_DETAILS":
                job.customer_details = None
                job.customer_extra_note = None
            else:
                job.customer_evidence_json = []
    elif report.content_type == "PROFILE":
        profile = (
            await db.execute(
                select(ProviderProfile).where(ProviderProfile.user_id == report.reported_user_id)
            )
        ).scalar_one_or_none()
        if profile is not None:
            profile.bio = None
        user = await db.get(User, report.reported_user_id)
        if user is not None:
            user.avatar_url = None
    else:
        raise InvalidReportError("This report has no content to remove — suspend or ban instead.")


async def resolve_report(
    db: AsyncSession,
    *,
    admin_id: uuid.UUID,
    report_id: uuid.UUID,
    action: str,
    note: Optional[str],
) -> ContentReport:
    """Cierra una denuncia. No hace commit."""
    if action not in ADMIN_ACTIONS:
        raise InvalidReportError(f"Unknown action '{action}'.")
    report = await db.get(ContentReport, report_id)
    if report is None:
        raise ReportNotFoundError(str(report_id))
    if report.status != "OPEN":
        raise InvalidReportError("This report was already reviewed.")

    if action == "remove_content":
        await _remove_content(db, report)
    elif action in ("suspend", "ban"):
        user = await db.get(User, report.reported_user_id)
        if user is not None:
            user.status = UserStatus.SUSPENDED if action == "suspend" else UserStatus.BANNED

    now = datetime.now(timezone.utc)
    report.status = "DISMISSED" if action == "dismiss" else "ACTIONED"
    report.admin_action = action
    report.admin_note = (note or "").strip() or None
    report.reviewed_by = admin_id
    report.reviewed_at = now
    db.add(ModerationAction(
        admin_id=admin_id,
        action=f"report_{action}",
        report_id=report.id,
        target_user_id=report.reported_user_id,
        note=report.admin_note or action,
    ))
    await db.flush()
    return report


async def list_blocks(db: AsyncSession, *, q: Optional[str] = None) -> list[dict[str, Any]]:
    """Bloqueos, filtrables por nombre o email de cualquiera de los dos lados."""
    stmt = select(UserBlock).order_by(UserBlock.created_at.desc())
    if q and q.strip():
        like = f"%{q.strip()}%"
        matching = select(User.id).where(
            or_(
                User.email.ilike(like),
                User.first_name.ilike(like),
                User.last_name.ilike(like),
                User.display_name.ilike(like),
                func.concat(User.first_name, " ", User.last_name).ilike(like),
            )
        )
        stmt = stmt.where(
            or_(UserBlock.blocker_id.in_(matching), UserBlock.blocked_id.in_(matching))
        )
    blocks = (await db.execute(stmt.limit(500))).scalars().all()
    users = await _users_by_id(
        db, {b.blocker_id for b in blocks} | {b.blocked_id for b in blocks}
    )
    return [
        {
            "id": str(b.id),
            "blocker": _user_card(users.get(b.blocker_id)),
            "blocked": _user_card(users.get(b.blocked_id)),
            "source": b.source,
            "jobId": str(b.job_id) if b.job_id else None,
            "createdAt": b.created_at.isoformat(),
        }
        for b in blocks
    ]


async def remove_block(
    db: AsyncSession, *, admin_id: uuid.UUID, block_id: uuid.UUID, note: str
) -> None:
    """Desbloquear (solo admin, con nota). La foto del bloqueo queda en moderation_actions."""
    if not (note or "").strip():
        raise InvalidReportError("A note is required to unblock.")
    block = await db.get(UserBlock, block_id)
    if block is None:
        raise BlockNotFoundError(str(block_id))
    db.add(ModerationAction(
        admin_id=admin_id,
        action="unblock",
        target_user_id=block.blocked_id,
        block_snapshot={
            "blockId": str(block.id),
            "blockerId": str(block.blocker_id),
            "blockedId": str(block.blocked_id),
            "source": block.source,
            "jobId": str(block.job_id) if block.job_id else None,
            "createdAt": block.created_at.isoformat(),
        },
        note=note.strip(),
    ))
    await db.execute(delete(UserBlock).where(UserBlock.id == block_id))
    await db.flush()
