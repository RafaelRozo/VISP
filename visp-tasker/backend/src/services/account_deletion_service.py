"""Borrado de cuenta desde la app (Apple 5.1.1(v)). Plan: `docs/plan-borrar-cuenta.md`.

El borrado es LÓGICO el día 0 y ANONIMIZACIÓN a los 30 días. Nunca un
`DELETE FROM users`: trabajos, consentimientos, reseñas, chat y comprobantes
apuntan a `users` con RESTRICT, y son historial de la otra parte, contabilidad
(CRA, 6 años) o auditoría legal (regla de negocio 3). Y las tablas en CASCADE se
llevarían por delante credenciales, tarifas y ofertas del proveedor.

Las reglas de qué bloquea (decisiones de Ricardo, 2026-09-29):

  * Un trabajo AGENDADO que aún no ha empezado NO bloquea, sea uno cliente o
    proveedor, si faltan MÁS de 15 min para la cita. Es el mismo margen desde el
    que el proveedor ya puede arrancar (`jobService.START_SCHEDULE_GRACE_MIN`):
    a partir de ahí puede ir de camino y el borrado le dejaría plantado.
      - Borra el CLIENTE -> el trabajo se cancela, se suelta la retención y se
        avisa al proveedor. Cancelar es gratis (mig 041): no hay penalización que
        esquivar borrando la cuenta.
      - Borra el PROVEEDOR -> el trabajo NO se cancela: vuelve a recibir ofertas.
        El cliente sigue queriendo el servicio. La retención se suelta porque va
        `on_behalf_of` la cuenta Stripe del que se va y no se puede reusar.
  * Bloquean: trabajo en ruta, en curso o en disputa; agendado a <= 15 min; cobro
    de un trabajo terminado aún sin capturar; saldo Stripe del proveedor > 0
    (D1); ser admin de una empresa B2B (D4); tener asignado un trabajo de empresa.
"""

from __future__ import annotations

import logging
import shutil
import uuid
from dataclasses import dataclass, field
from datetime import datetime, timedelta, timezone
from pathlib import Path
from typing import Any, Optional

from sqlalchemy import delete, or_, select, text
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.account_deletion import AccountDeletion
from src.models.company import CompanyMember, CompanyMemberRole, CompanyMemberStatus
from src.models.company_job import CompanyJobAssignment, CompanyJobStatus
from src.models.job import AssignmentStatus, Job, JobAssignment, JobStatus
from src.models.job_offer import JobOffer, OfferStatus
from src.models.notification import DeviceToken, Notification, NotificationPreference
from src.models.provider import ProviderDocument, ProviderProfile, ProviderProfileStatus
from src.models.user import User, UserStatus
from src.models.verification import (
    ProviderCredential,
    ProviderExperienceRecord,
    ProviderInsurancePolicy,
)
from src.services import jobSchedule

logger = logging.getLogger(__name__)

# El plazo que promete la política de privacidad, y el de recuperar la cuenta
# escribiendo a soporte. D3: los documentos de verificación, igual.
RETENTION_DAYS = 30

# Motivo que queda en `jobs.cancellation_reason`. Cerrado, para poder contarlo.
ACCOUNT_DELETED_REASON = "ACCOUNT_DELETED"

# Estados sin proveedor comprometido: se cancelan solos si borra el cliente.
_PRE_PROVIDER = (
    JobStatus.DRAFT,
    JobStatus.PENDING_MATCH,
    JobStatus.MATCHED,
    JobStatus.PENDING_APPROVAL,
    JobStatus.PENDING_PRICE_AGREEMENT,
)
# Agendados: se liberan si faltan más de 15 min para la cita.
_BOOKED = (JobStatus.SCHEDULED, JobStatus.PROVIDER_ACCEPTED)
# Alguien ya se movió o hay un conflicto abierto: siempre bloquean.
_UNDERWAY = (JobStatus.PROVIDER_EN_ROUTE, JobStatus.IN_PROGRESS)

# Un trabajo terminado cuya captura sigue pendiente (sobrecoste o material sin
# aprobar). Pasados 7 días Stripe ya soltó la retención y no hay nada que
# cobrar, así que un trabajo viejo no bloquea para siempre.
_CAPTURE_WINDOW = timedelta(days=7)

# Uploads, por dueño (ver las rutas de subida en users/jobs/providers).
_UPLOAD_ROOT = Path(__file__).resolve().parents[2] / "uploads"
_USER_UPLOAD_DIRS = ("avatars", "booking-evidence")
_PROVIDER_UPLOAD_DIRS = ("credentials", "insurance", "experience", "provider_documents")


# ---------------------------------------------------------------------------
# Errores
# ---------------------------------------------------------------------------

class AccountDeletionError(Exception):
    pass


class WrongPasswordError(AccountDeletionError):
    pass


class AlreadyDeletedError(AccountDeletionError):
    pass


class DeletionBlockedError(AccountDeletionError):
    """Algo cambió entre la comprobación y la confirmación. Lleva el plan nuevo."""

    def __init__(self, plan: "DeletionPlan") -> None:
        self.plan = plan
        super().__init__(f"{len(plan.blockers)} blocker(s)")


# ---------------------------------------------------------------------------
# Plan: qué impide borrar y qué se hará con cada trabajo
# ---------------------------------------------------------------------------

@dataclass
class DeletionPlan:
    blockers: list[dict[str, Any]] = field(default_factory=list)
    will_change: list[dict[str, Any]] = field(default_factory=list)
    pending_balance_cents: int = 0
    expected_payout_date: Optional[str] = None
    # Trabajos a tocar si se confirma. No salen en la respuesta.
    cancel_jobs: list[Job] = field(default_factory=list)
    reopen_jobs: list[Job] = field(default_factory=list)

    @property
    def can_delete(self) -> bool:
        return not self.blockers

    def to_dict(self) -> dict[str, Any]:
        return {
            "canDelete": self.can_delete,
            "blockers": self.blockers,
            "willChange": self.will_change,
            "pendingBalanceCents": self.pending_balance_cents,
            "expectedPayoutDate": self.expected_payout_date,
            "retentionDays": RETENTION_DAYS,
        }


def _job_ref(job: Job) -> dict[str, Any]:
    start = jobSchedule.scheduled_start(job)
    return {
        "jobId": str(job.id),
        "reference": job.reference_number,
        "status": job.status.value,
        "scheduledAt": start.isoformat() if start else None,
    }


def _starts_soon(job: Job, now: datetime) -> bool:
    """¿Faltan 15 min o menos para la cita (o ya pasó)? Sin fecha no hay cita."""
    from src.services.jobService import START_SCHEDULE_GRACE_MIN

    start = jobSchedule.scheduled_start(job)
    if start is None:
        return False
    return start - now <= timedelta(minutes=START_SCHEDULE_GRACE_MIN)


async def _get_provider_profile(db: AsyncSession, user_id: uuid.UUID) -> Optional[ProviderProfile]:
    return (
        await db.execute(select(ProviderProfile).where(ProviderProfile.user_id == user_id))
    ).scalars().first()


async def stripe_pending_balance(account_id: str) -> tuple[int, Optional[str]]:
    """Saldo disponible + pendiente de la cuenta conectada, y cuándo llega al banco.

    Módulo-nivel a propósito: el smoke lo sustituye para probar el bloqueo sin
    una cuenta Stripe con dinero de verdad.
    """
    import stripe

    from src.integrations.stripe.payoutService import get_balance

    info = await get_balance(account_id)
    total = max(0, info.available_cents) + max(0, info.pending_cents)
    fecha: Optional[str] = None
    try:
        payouts = stripe.Payout.list(limit=10, stripe_account=account_id)
        llegadas = [
            p.arrival_date for p in payouts.data if p.status in ("pending", "in_transit")
        ]
        if llegadas:
            fecha = datetime.fromtimestamp(max(llegadas), tz=timezone.utc).date().isoformat()
    except Exception:  # noqa: BLE001 — la fecha es un detalle, no una condición.
        logger.warning("No se pudo leer la fecha de pago de %s", account_id, exc_info=True)
    return total, fecha


async def build_plan(
    db: AsyncSession, user: User, *, lock: bool = False, now: Optional[datetime] = None
) -> DeletionPlan:
    """Evalúa los dos papeles —cliente y proveedor— y devuelve el plan.

    Con ``lock=True`` los trabajos se leen con FOR UPDATE: es la pasada que hace
    la confirmación, y así un "en ruta" simultáneo no se cuela entre la
    comprobación de los 15 min y el cambio de estado.
    """
    now = now or datetime.now(timezone.utc)
    plan = DeletionPlan()

    # --- Como cliente ------------------------------------------------------
    q = select(Job).where(
        Job.customer_id == user.id,
        Job.status.in_(_PRE_PROVIDER + _BOOKED + _UNDERWAY + (JobStatus.DISPUTED,)),
    )
    if lock:
        q = q.with_for_update()
    for job in (await db.execute(q)).scalars().all():
        if job.status == JobStatus.DISPUTED:
            plan.blockers.append({**_job_ref(job), "code": "JOB_DISPUTED", "role": "customer"})
        elif job.status in _UNDERWAY:
            plan.blockers.append({**_job_ref(job), "code": "JOB_UNDERWAY", "role": "customer"})
        elif job.status in _BOOKED and _starts_soon(job, now):
            plan.blockers.append({**_job_ref(job), "code": "JOB_STARTS_SOON", "role": "customer"})
        else:
            plan.cancel_jobs.append(job)
            plan.will_change.append({**_job_ref(job), "action": "cancel", "role": "customer"})

    # --- Como proveedor ----------------------------------------------------
    profile = await _get_provider_profile(db, user.id)
    if profile is not None:
        q = (
            select(Job)
            .join(JobAssignment, JobAssignment.job_id == Job.id)
            .where(
                JobAssignment.provider_id == profile.id,
                JobAssignment.status == AssignmentStatus.ACCEPTED,
                Job.status.in_(_BOOKED + _UNDERWAY + (JobStatus.DISPUTED,)),
            )
        )
        if lock:
            q = q.with_for_update(of=Job)
        for job in (await db.execute(q)).scalars().unique().all():
            if job.status == JobStatus.DISPUTED:
                plan.blockers.append({**_job_ref(job), "code": "JOB_DISPUTED", "role": "provider"})
            elif job.status in _UNDERWAY:
                plan.blockers.append({**_job_ref(job), "code": "JOB_UNDERWAY", "role": "provider"})
            elif _starts_soon(job, now):
                plan.blockers.append(
                    {**_job_ref(job), "code": "JOB_STARTS_SOON", "role": "provider"}
                )
            else:
                plan.reopen_jobs.append(job)
                plan.will_change.append(
                    {**_job_ref(job), "action": "reopen", "role": "provider"}
                )

        pendientes = (
            await db.execute(
                select(JobOffer.id).where(
                    JobOffer.provider_id == profile.id,
                    JobOffer.status == OfferStatus.PENDING,
                )
            )
        ).scalars().all()
        if pendientes:
            plan.will_change.append(
                {"action": "withdraw_offers", "role": "provider", "count": len(pendientes)}
            )

        # D1: saldo pendiente de cobro. Falla CERRADO: si no se puede leer, no se
        # sabe si hay dinero de por medio, y cerrar la cuenta lo dejaría colgado.
        if profile.stripe_account_id:
            try:
                saldo, fecha = await stripe_pending_balance(profile.stripe_account_id)
            except Exception:  # noqa: BLE001
                logger.warning(
                    "No se pudo leer el saldo Stripe de %s", profile.stripe_account_id,
                    exc_info=True,
                )
                plan.blockers.append({"code": "PAYOUT_CHECK_FAILED", "role": "provider"})
            else:
                plan.pending_balance_cents = saldo
                plan.expected_payout_date = fecha
                if saldo > 0:
                    plan.blockers.append({
                        "code": "PAYOUT_PENDING",
                        "role": "provider",
                        "amountCents": saldo,
                        "expectedPayoutDate": fecha,
                    })

    # --- Cobros sin cerrar (los dos papeles) --------------------------------
    job_ids_proveedor = (
        select(JobAssignment.job_id).where(
            JobAssignment.provider_id == profile.id,
            JobAssignment.status.in_([AssignmentStatus.ACCEPTED, AssignmentStatus.COMPLETED]),
        )
        if profile is not None
        else None
    )
    condicion_parte = Job.customer_id == user.id
    if job_ids_proveedor is not None:
        condicion_parte = or_(condicion_parte, Job.id.in_(job_ids_proveedor))
    sin_capturar = (
        await db.execute(
            select(Job).where(
                condicion_parte,
                Job.status == JobStatus.COMPLETED,
                Job.stripe_payment_intent_id.isnot(None),
                Job.final_price_cents.is_(None),
                Job.completed_at >= now - _CAPTURE_WINDOW,
            )
        )
    ).scalars().all()
    for job in sin_capturar:
        plan.blockers.append({**_job_ref(job), "code": "PAYMENT_PENDING"})

    # --- Empresas B2B --------------------------------------------------------
    miembros = (
        await db.execute(
            select(CompanyMember).where(
                CompanyMember.user_id == user.id,
                CompanyMember.status == CompanyMemberStatus.ACTIVE,
            )
        )
    ).scalars().all()
    if any(m.role == CompanyMemberRole.ADMIN for m in miembros):
        plan.blockers.append({"code": "COMPANY_OWNER"})
    asignados = (
        await db.execute(
            select(CompanyJobAssignment)
            .join(Job, Job.id == CompanyJobAssignment.job_id)
            .where(
                CompanyJobAssignment.assigned_collaborator_id == user.id,
                CompanyJobAssignment.status.in_(
                    [CompanyJobStatus.ASSIGNED, CompanyJobStatus.ACCEPTED]
                ),
                Job.status.in_(_BOOKED + _UNDERWAY),
            )
        )
    ).scalars().all()
    for a in asignados:
        plan.blockers.append({"code": "COMPANY_JOB_ASSIGNED", "jobId": str(a.job_id)})

    return plan


# ---------------------------------------------------------------------------
# Día 0: el borrado
# ---------------------------------------------------------------------------

@dataclass
class DeletionResult:
    record: AccountDeletion
    # (tipo, job_id, user_id) — se envían DESPUÉS del commit (`send_notices`): un
    # push que sale y luego la transacción se deshace avisa de algo que no pasó.
    notices: list[tuple[str, uuid.UUID, uuid.UUID]]


async def delete_account(
    db: AsyncSession,
    user: User,
    *,
    password: str,
    ip_address: Optional[str] = None,
    user_agent: Optional[str] = None,
) -> DeletionResult:
    """Borra la cuenta (día 0) en la transacción del llamador. No hace commit."""
    from src.services.auth_service import verify_password

    if user.deleted_at is not None or user.status == UserStatus.DEACTIVATED:
        raise AlreadyDeletedError(str(user.id))
    if not user.password_hash or not verify_password(password, user.password_hash):
        raise WrongPasswordError(str(user.id))

    # La fila del usuario, bloqueada: dos confirmaciones a la vez (doble toque)
    # no deben hacer el borrado dos veces.
    await db.execute(select(User.id).where(User.id == user.id).with_for_update())

    now = datetime.now(timezone.utc)
    plan = await build_plan(db, user, lock=True, now=now)
    if not plan.can_delete:
        raise DeletionBlockedError(plan)

    profile = await _get_provider_profile(db, user.id)
    record = AccountDeletion(
        user_id=user.id,
        requested_at=now,
        ip_address=(ip_address or None) and ip_address[:64],
        user_agent=(user_agent or None) and user_agent[:500],
        previous_user_status=user.status.value,
        previous_provider_status=profile.status.value if profile is not None else None,
        job_actions=[],
        purge_after=now + timedelta(days=RETENTION_DAYS),
    )

    # 1. La cuenta primero. Así el re-broadcast de abajo ya no lo encuentra a él
    #    mismo como candidato, y todas sus sesiones mueren en la próxima petición
    #    (`get_current_user` mira el estado en cada una).
    user.status = UserStatus.DEACTIVATED
    user.deleted_at = now
    if profile is not None:
        profile.status = ProviderProfileStatus.INACTIVE
    await db.flush()

    notices: list[tuple[str, uuid.UUID, uuid.UUID]] = []
    acciones: list[dict[str, Any]] = []

    # 2. Sus trabajos como cliente: cancelados, retención suelta.
    for job in plan.cancel_jobs:
        avisar = await _cancel_for_deleted_customer(db, job, user.id, now)
        notices.extend(("customer_left", job.id, uid) for uid in avisar)
        acciones.append({"job_id": str(job.id), "reference": job.reference_number,
                         "action": "cancelled"})

    # 3. Sus trabajos como proveedor: de vuelta al matching.
    for job in plan.reopen_jobs:
        await _reopen_for_new_provider(db, job, profile, now)
        notices.append(("provider_left", job.id, job.customer_id))
        acciones.append({"job_id": str(job.id), "reference": job.reference_number,
                         "action": "reopened"})

    # 4. Ofertas e invitaciones pendientes del proveedor: retiradas.
    if profile is not None:
        ofertas = (
            await db.execute(
                select(JobOffer).where(
                    JobOffer.provider_id == profile.id,
                    JobOffer.status == OfferStatus.PENDING,
                )
            )
        ).scalars().all()
        for o in ofertas:
            o.status = OfferStatus.WITHDRAWN
            o.responded_at = now
            acciones.append({"job_id": str(o.job_id), "action": "offer_withdrawn"})
        invitaciones = (
            await db.execute(
                select(JobAssignment).where(
                    JobAssignment.provider_id == profile.id,
                    JobAssignment.status == AssignmentStatus.OFFERED,
                )
            )
        ).scalars().all()
        for a in invitaciones:
            a.status = AssignmentStatus.CANCELLED
            a.responded_at = now

    # 5. Sale de las empresas donde colabora (D4: si era admin, ya bloqueó arriba).
    miembros = (
        await db.execute(select(CompanyMember).where(CompanyMember.user_id == user.id))
    ).scalars().all()
    for m in miembros:
        m.status = CompanyMemberStatus.DISABLED

    # 6. Sin más push.
    await db.execute(delete(DeviceToken).where(DeviceToken.user_id == user.id))

    record.job_actions = acciones
    db.add(record)
    await db.flush()

    logger.warning(
        "Cuenta %s borrada (día 0): %d trabajos cancelados, %d reabiertos. Purga el %s.",
        user.id, len(plan.cancel_jobs), len(plan.reopen_jobs), record.purge_after.date(),
    )
    return DeletionResult(record=record, notices=notices)


async def _cancel_for_deleted_customer(
    db: AsyncSession, job: Job, customer_id: uuid.UUID, now: datetime
) -> list[uuid.UUID]:
    """Cancela un trabajo del cliente que se va. Devuelve a quién avisar."""
    from src.services import jobService
    from src.services.cancellation_service import _release_hold
    from src.services.jobStateManager import ActorType, validate_transition

    # A quién avisar, ANTES de tocar nada: el proveedor asignado y quien ofertó.
    avisar: list[uuid.UUID] = []
    asignado = (
        await db.execute(
            select(ProviderProfile.user_id)
            .join(JobAssignment, JobAssignment.provider_id == ProviderProfile.id)
            .where(
                JobAssignment.job_id == job.id,
                JobAssignment.status == AssignmentStatus.ACCEPTED,
            )
        )
    ).scalars().all()
    avisar.extend(asignado)
    ofertas = (
        await db.execute(
            select(JobOffer).where(
                JobOffer.job_id == job.id, JobOffer.status == OfferStatus.PENDING
            )
        )
    ).scalars().all()
    for o in ofertas:
        o.status = OfferStatus.EXPIRED
        o.responded_at = now
        prov = await db.get(ProviderProfile, o.provider_id)
        if prov is not None and prov.user_id not in avisar:
            avisar.append(prov.user_id)

    # La retención se suelta ANTES del cambio de estado (mismo orden que el
    # barrido de plantones): lo peor es un trabajo cancelado con el dinero del
    # cliente todavía bloqueado. `update_job_status` no la suelta por sí solo.
    await _release_hold(job)

    # PROVIDER_ACCEPTED no admite "cancelado por el cliente" en la máquina de
    # estados: ahí lo cancela el sistema, con el mismo motivo.
    if validate_transition(
        job.status, JobStatus.CANCELLED_BY_CUSTOMER, ActorType.CUSTOMER
    ).allowed:
        target, actor = JobStatus.CANCELLED_BY_CUSTOMER, "customer"
    else:
        target, actor = JobStatus.CANCELLED_BY_SYSTEM, "system"
    await jobService.update_job_status(
        db, job.id, target.value, actor_id=customer_id, actor_type=actor
    )
    job.cancellation_reason = ACCOUNT_DELETED_REASON
    return avisar


async def _reopen_for_new_provider(
    db: AsyncSession, job: Job, profile: ProviderProfile, now: datetime
) -> None:
    """El proveedor asignado se va: el trabajo vuelve a recibir ofertas.

    Se deshace lo que hizo `offerService.accept_offer`: oferta aceptada, precio
    sellado, asignación y retención. El precio del trabajo (`total_charged_cents`
    y compañía) se queda como estaba: el próximo `accept_offer` lo reprecia
    entero contra la oferta nueva.
    """
    from src.services import jobService, offerService
    from src.services.cancellation_service import _release_hold
    from src.services.matchingEngine import find_matching_providers

    # La retención va `on_behalf_of` y `transfer_data` a la cuenta del que se va:
    # no sirve para el siguiente proveedor. Se suelta y el cliente vuelve a
    # autorizar por el camino normal al aceptar la oferta nueva.
    await _release_hold(job)
    job.stripe_payment_intent_id = None
    job.authorized_amount_cents = None
    job.authorized_at = None

    if job.accepted_offer_id is not None:
        oferta = await db.get(JobOffer, job.accepted_offer_id)
        if oferta is not None:
            oferta.status = OfferStatus.WITHDRAWN
            oferta.responded_at = now
    job.accepted_offer_id = None
    job.price_agreed_at = None

    asignaciones = (
        await db.execute(
            select(JobAssignment).where(
                JobAssignment.job_id == job.id,
                JobAssignment.provider_id == profile.id,
                JobAssignment.status == AssignmentStatus.ACCEPTED,
            )
        )
    ).scalars().all()
    for a in asignaciones:
        a.status = AssignmentStatus.CANCELLED
        a.responded_at = now

    await jobService.update_job_status(
        db, job.id, JobStatus.PENDING_MATCH.value, actor_type="system"
    )
    # Ventana nueva de ofertas. `job_deadline_sql` la recorta a la cita, así que
    # nunca se ofertará después de la hora del servicio.
    job.offers_close_at = offerService.default_close_at(now)
    await db.flush()

    # Re-broadcast, igual que al crear el trabajo. La bolsa se calcula en vivo y
    # es lo que de verdad decide quién lo ve; esto solo registra a quién se avisó.
    try:
        ya = set(
            (
                await db.execute(
                    select(JobAssignment.provider_id).where(JobAssignment.job_id == job.id)
                )
            ).scalars().all()
        )
        resultado = await find_matching_providers(db, job, max_results=20)
        for m in resultado.get("matches", []):
            if m["provider_id"] in ya:
                continue
            db.add(JobAssignment(
                job_id=job.id,
                provider_id=m["provider_id"],
                status=AssignmentStatus.OFFERED,
                offered_at=now,
            ))
        await db.flush()
    except Exception:  # noqa: BLE001 — la bolsa en vivo lo cubre igual.
        logger.exception("Re-broadcast fallido para el trabajo %s", job.id)


async def send_notices(db: AsyncSession, notices: list[tuple[str, uuid.UUID, uuid.UUID]]) -> None:
    """Los push del borrado. Se llaman tras el commit; un fallo nunca bloquea."""
    from src.services import notificationService

    for tipo, job_id, user_id in notices:
        try:
            if tipo == "customer_left":
                await notificationService.notify_job_cancelled_account_deleted(
                    job_id=job_id, user_id=user_id, db=db
                )
            elif tipo == "provider_left":
                await notificationService.notify_provider_left(
                    job_id=job_id, customer_user_id=user_id, db=db
                )
        except Exception:  # noqa: BLE001
            logger.exception("Aviso de borrado fallido (%s, job %s)", tipo, job_id)


# ---------------------------------------------------------------------------
# Restaurar (dentro del plazo, a petición de soporte)
# ---------------------------------------------------------------------------

async def restore_account(db: AsyncSession, user: User) -> AccountDeletion:
    """Devuelve la cuenta al estado anterior. Los trabajos NO se restauran: ya se
    cancelaron o tienen otro proveedor, y deshacerlo afectaría a otras personas."""
    record = (
        await db.execute(
            select(AccountDeletion)
            .where(
                AccountDeletion.user_id == user.id,
                AccountDeletion.purged_at.is_(None),
                AccountDeletion.restored_at.is_(None),
            )
            .order_by(AccountDeletion.requested_at.desc())
            .limit(1)
        )
    ).scalars().first()
    if record is None:
        raise AccountDeletionError("No restorable deletion for this user (purged or not deleted).")

    user.status = UserStatus(record.previous_user_status)
    user.deleted_at = None
    profile = await _get_provider_profile(db, user.id)
    if profile is not None and record.previous_provider_status:
        profile.status = ProviderProfileStatus(record.previous_provider_status)
    record.restored_at = datetime.now(timezone.utc)
    await db.flush()
    logger.warning("Cuenta %s restaurada (borrado del %s)", user.id, record.requested_at)
    return record


# ---------------------------------------------------------------------------
# Día 30: la purga
# ---------------------------------------------------------------------------

async def purge_due_accounts(
    db: AsyncSession, *, now: Optional[datetime] = None, user_id: Optional[uuid.UUID] = None
) -> dict[str, int]:
    """Anonimiza las cuentas cuyo plazo venció. Cada una en su SAVEPOINT: una que
    falla no para a las demás. ``user_id`` fuerza una concreta (script / smoke)."""
    now = now or datetime.now(timezone.utc)
    q = select(AccountDeletion).where(
        AccountDeletion.purged_at.is_(None), AccountDeletion.restored_at.is_(None)
    )
    q = q.where(AccountDeletion.user_id == user_id) if user_id else q.where(
        AccountDeletion.purge_after <= now
    )
    pendientes = (await db.execute(q)).scalars().all()

    hechas = aplazadas = fallidas = 0
    for record in pendientes:
        try:
            async with db.begin_nested():
                if await _purge_one(db, record, now):
                    hechas += 1
                else:
                    aplazadas += 1
        except Exception:  # noqa: BLE001
            fallidas += 1
            logger.exception("Purga fallida para la cuenta %s", record.user_id)
    return {"purged": hechas, "deferred": aplazadas, "failed": fallidas}


async def _purge_one(db: AsyncSession, record: AccountDeletion, now: datetime) -> bool:
    """Devuelve False si se aplaza (saldo Stripe aún > 0)."""
    user = await db.get(User, record.user_id)
    if user is None or user.status != UserStatus.DEACTIVATED:
        # Alguien la reactivó sin pasar por `restore_account`. No se toca.
        record.purge_notes = "skipped: account is not deactivated"
        record.restored_at = now
        return True

    profile = await _get_provider_profile(db, user.id)
    notas: list[str] = []

    # Stripe. El saldo se vuelve a mirar: si aún hay dinero, se aplaza entero —
    # cerrar la cuenta conectada lo dejaría colgado.
    if profile is not None and profile.stripe_account_id:
        try:
            saldo, _ = await stripe_pending_balance(profile.stripe_account_id)
        except Exception as exc:  # noqa: BLE001
            record.purge_notes = f"deferred: balance check failed ({exc})"[:1000]
            return False
        if saldo > 0:
            record.purge_notes = f"deferred: Stripe balance {saldo} cents"
            return False
        nota = _close_connected_account(profile.stripe_account_id)
        if nota:
            notas.append(nota)
    if user.stripe_customer_id:
        nota = _delete_stripe_customer(user.stripe_customer_id)
        if nota:
            notas.append(nota)

    # Archivos: avatar, fotos de reservas y, si era proveedor, su expediente.
    carpetas = [_UPLOAD_ROOT / d / str(user.id) for d in _USER_UPLOAD_DIRS]
    if profile is not None:
        carpetas += [_UPLOAD_ROOT / d / str(profile.id) for d in _PROVIDER_UPLOAD_DIRS]
    for carpeta in carpetas:
        if carpeta.is_dir():
            shutil.rmtree(carpeta, ignore_errors=True)

    # Perfil de proveedor: documentos de verificación fuera (D3: 30 días) y
    # datos personales a NULL. Las calificaciones y su historial de trabajos se
    # quedan: son la otra parte de trabajos que existieron.
    if profile is not None:
        # La columna no está mapeada en el ORM: asignarla desde Python no haría
        # nada, y el DELETE de credenciales chocaría con su FK (NO ACTION).
        await db.execute(
            text(
                "UPDATE provider_profiles SET identity_license_credential_id = NULL "
                "WHERE id = :pid"
            ),
            {"pid": profile.id},
        )
        for modelo in (
            ProviderCredential,
            ProviderInsurancePolicy,
            ProviderExperienceRecord,
            ProviderDocument,
        ):
            await db.execute(delete(modelo).where(modelo.provider_id == profile.id))
        profile.bio = None
        profile.portfolio_url = None
        profile.home_address = None
        profile.home_city = None
        profile.home_postal_zip = None
        profile.home_latitude = None
        profile.home_longitude = None
        profile.stripe_account_id = None

    from src.services import auth_service

    # La fila de `users`, anonimizada. El email pasa a uno imposible: libera el
    # real para volver a registrarse y sigue cumpliendo el UNIQUE.
    user.first_name = "Deleted"
    user.last_name = "user"
    user.display_name = "Deleted user"
    user.email = f"deleted+{user.id}@invalid"
    user.phone = None
    user.password_hash = None
    # NOT NULL y UNIQUE en la base (el modelo dice Optional, la tabla no): se
    # rota a uno nuevo que nadie conoce, así el código viejo deja de servir.
    user.recovery_code = auth_service.generate_recovery_code()
    user.avatar_url = None
    user.auth_provider_id = None
    user.stripe_customer_id = None
    user.default_address_street = None
    user.default_address_city = None
    user.default_address_province = None
    user.default_address_postal_code = None
    user.default_address_latitude = None
    user.default_address_longitude = None
    user.default_address_formatted = None
    user.last_latitude = None
    user.last_longitude = None

    await db.execute(delete(Notification).where(Notification.user_id == user.id))
    await db.execute(
        delete(NotificationPreference).where(NotificationPreference.user_id == user.id)
    )

    record.purged_at = now
    record.purge_notes = "; ".join(notas) or None
    await db.flush()
    logger.warning("Cuenta %s purgada y anonimizada%s", user.id,
                   f" ({record.purge_notes})" if record.purge_notes else "")
    return True


def _close_connected_account(account_id: str) -> Optional[str]:
    """Cierra la cuenta conectada (Accounts v2). Devuelve una nota si falla: la
    purga sigue y soporte la cierra a mano desde el dashboard de Stripe."""
    import stripe

    from src.core.config import settings

    try:
        client = stripe.StripeClient(settings.stripe_secret_key)
        cuenta = client.v2.core.accounts.retrieve(account_id)
        configs = list(getattr(cuenta, "applied_configurations", None) or [])
        params: dict[str, Any] = {"applied_configurations": configs} if configs else {}
        client.v2.core.accounts.close(account_id, params=params)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudo cerrar la cuenta conectada %s: %s", account_id, exc)
        return f"stripe account {account_id} not closed: {exc}"[:500]


def _delete_stripe_customer(customer_id: str) -> Optional[str]:
    import stripe

    import src.integrations.stripe.payoutService  # noqa: F401 — fija stripe.api_key

    try:
        stripe.Customer.delete(customer_id)
        return None
    except Exception as exc:  # noqa: BLE001
        logger.warning("No se pudo borrar el customer %s: %s", customer_id, exc)
        return f"stripe customer {customer_id} not deleted: {exc}"[:500]
