"""
Job Service -- VISP-BE-JOBS-002
================================

Business logic for job lifecycle management. All operations use async
SQLAlchemy sessions and enforce business rules including:

  - Closed task catalog (no free text -- task_id must reference service_tasks)
  - SLA snapshot immutability (copied from sla_profiles at creation time)
  - State machine enforcement via jobStateManager
  - Event emission on every state change

Key functions:
  - create_job        -- create with SLA snapshot
  - update_job_status -- state machine transition
  - cancel_job        -- cancellation with actor enforcement
  - get_job           -- single job retrieval
  - get_jobs_by_customer / get_jobs_by_provider -- paginated lists
  - generate_reference_number -- TSK-XXXXXX format
"""

from __future__ import annotations

import logging
import math
import random
import string
import uuid
from dataclasses import dataclass, field
from datetime import date, datetime, time, timedelta, timezone
from decimal import Decimal
from typing import Any, Optional, Sequence

from sqlalchemy import and_, func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession
from sqlalchemy.orm import selectinload

from src.events.jobEvents import (
    emit_job_cancelled,
    emit_job_completed,
    emit_job_created,
    emit_job_status_changed,
    emit_sla_snapshot_captured,
)
from src.models.job import Job, JobPriority, JobStatus
from src.models.provider import ProviderLevel
from src.models.sla import SLAProfile
from src.models.taxonomy import ServiceTask
from src.services import service_zone_service
from src.services.jobStateManager import ActorType, validate_transition
from src.services.pricingEngine import (
    HOURLY_RATES,
    LEVEL_PRICING_MODEL,
    finalize_time_based_price,
)

logger = logging.getLogger(__name__)


# Tope de fotos que el cliente puede adjuntar al reservar (decisión del cliente
# 2026-08-11). El número evita saturar la vista del proveedor; el peso lo controla
# el downscale en la app: 5 fotos de iPhone sin comprimir son ~25 MB, con
# downscale ~1,5 MB. Sin comprimir, 5 saturan igual que 20.
MAX_CUSTOMER_EVIDENCE_PHOTOS = 5


# ---------------------------------------------------------------------------
# Pagination helper (same pattern as taxonomy_service)
# ---------------------------------------------------------------------------

@dataclass(frozen=True)
class PaginatedResult:
    """Generic container for a page of results plus metadata."""

    items: Sequence
    total_items: int
    page: int
    page_size: int

    @property
    def total_pages(self) -> int:
        if self.total_items == 0:
            return 0
        return math.ceil(self.total_items / self.page_size)


# ---------------------------------------------------------------------------
# Exceptions
# ---------------------------------------------------------------------------

class JobNotFoundError(Exception):
    """Raised when a job cannot be found by ID."""

    def __init__(self, job_id: uuid.UUID) -> None:
        self.job_id = job_id
        super().__init__(f"Job with id '{job_id}' not found.")


class TaskNotFoundError(Exception):
    """Raised when a task cannot be found by ID."""

    def __init__(self, task_id: uuid.UUID) -> None:
        self.task_id = task_id
        super().__init__(f"Task with id '{task_id}' not found.")


class BookingInputRequiredError(Exception):
    """El servicio exige detalles o evidencia que el cliente no aportó.

    Se lanza cuando `service_tasks.requires_details` o `requires_evidence` están
    encendidos y falta lo correspondiente, o cuando se exceden las 5 fotos.

    Las rutas la traducen a 400. Nunca a 5xx: `api.richieyanez.com` está detrás de
    Cloudflare, que envuelve los 5xx en su propia página y el cliente no vería el
    mensaje que le dice qué le falta.
    """

    def __init__(self, message: str) -> None:
        super().__init__(message)


class InvalidTransitionError(Exception):
    """Raised when a job status transition is not allowed."""

    def __init__(self, reason: str) -> None:
        self.reason = reason
        super().__init__(reason)


class JobStartNotAllowedError(Exception):
    """A provider tried to start (IN_PROGRESS) before the start preconditions are
    met: it isn't yet the scheduled time, or they haven't arrived at the customer's
    service location. ``code`` is ``"scheduled_time"`` or ``"not_arrived"`` so the
    route can surface a specific 4xx message."""

    def __init__(self, code: str, reason: str) -> None:
        self.code = code
        self.reason = reason
        super().__init__(reason)


# Start-precondition tuning (2026-07-17 requirement: provider may only start once
# they're at the customer's location AND the scheduled time has arrived).
# Emergencies (L4 / is_emergency) are exempt from the TIME gate but still must be
# on-site. A small grace lets a provider who arrived early begin without friction.
START_ARRIVAL_RADIUS_M = 150.0
START_SCHEDULE_GRACE_MIN = 15


# ---------------------------------------------------------------------------
# Reference number generation
# ---------------------------------------------------------------------------

def generate_reference_number() -> str:
    """Generate a human-readable reference number in TSK-XXXXXX format.

    Uses uppercase letters and digits for readability. Collision avoidance
    is handled at the database level via a unique constraint; callers should
    retry on IntegrityError.
    """
    chars = string.ascii_uppercase + string.digits
    suffix = "".join(random.choices(chars, k=6))
    return f"TSK-{suffix}"


# ---------------------------------------------------------------------------
# SLA snapshot capture
# ---------------------------------------------------------------------------

async def _capture_sla_snapshot(
    db: AsyncSession,
    task: ServiceTask,
    *,
    service_country: str = "CA",
    service_province_state: Optional[str] = None,
    service_city: Optional[str] = None,
) -> dict[str, Any]:
    """Find the best-matching SLA profile for a task and capture a snapshot.

    SLA profile matching priority (highest wins):
    1. Task-specific + most granular region match
    2. Level-wide + most granular region match
    3. Fallback to country-level default

    Returns a dict with the snapshot data, plus ``sla_profile_id`` if a
    profile was found.
    """
    # Build filter: active profiles matching the task's level
    today = date.today()
    filters = [
        SLAProfile.level == task.level,
        SLAProfile.is_active.is_(True),
        SLAProfile.effective_from <= today,
        or_(
            SLAProfile.effective_until.is_(None),
            SLAProfile.effective_until >= today,
        ),
        SLAProfile.country == service_country,
    ]

    stmt = (
        select(SLAProfile)
        .where(*filters)
        .order_by(
            # Prefer task-specific over level-wide
            SLAProfile.task_id == task.id,  # True sorts after False in PG, so desc
            SLAProfile.priority_order.desc(),
        )
    )

    result = await db.execute(stmt)
    profiles = result.scalars().all()

    if not profiles:
        logger.warning(
            "No SLA profile found for task %s (level=%s, country=%s). "
            "Job will be created without SLA targets.",
            task.id,
            task.level.value,
            service_country,
        )
        return {
            "sla_profile_id": None,
            "response_time_min": None,
            "arrival_time_min": None,
            "completion_time_min": None,
            "penalty_enabled": False,
            "penalty_per_min_cents": None,
            "penalty_cap_cents": None,
            "profile_name": None,
            "level": task.level.value,
            "region_value": None,
            "captured_at": datetime.now(timezone.utc).isoformat(),
        }

    # Pick the best match: prefer task-specific, then highest priority
    best: SLAProfile | None = None
    for profile in profiles:
        # Task-specific profiles always win
        if profile.task_id == task.id:
            if best is None or best.task_id != task.id:
                best = profile
            elif profile.priority_order > best.priority_order:
                best = profile
        elif best is None or best.task_id != task.id:
            if best is None or profile.priority_order > best.priority_order:
                best = profile

    if best is None:
        best = profiles[0]

    snapshot = {
        "sla_profile_id": str(best.id),
        "response_time_min": best.response_time_min,
        "arrival_time_min": best.arrival_time_min,
        "completion_time_min": best.completion_time_min,
        "penalty_enabled": best.penalty_enabled,
        "penalty_per_min_cents": best.penalty_per_min_cents,
        "penalty_cap_cents": best.penalty_cap_cents,
        "profile_name": best.name,
        "level": best.level.value,
        "region_value": best.region_value,
        "captured_at": datetime.now(timezone.utc).isoformat(),
    }

    return snapshot


# ---------------------------------------------------------------------------
# Job CRUD operations
# ---------------------------------------------------------------------------

async def create_job(
    db: AsyncSession,
    *,
    customer_id: uuid.UUID,
    task_id: uuid.UUID,
    location: dict[str, Any],
    schedule: dict[str, Any] | None = None,
    priority: str = "standard",
    is_emergency: bool = False,
    customer_notes_json: list[str] | None = None,
    quantity: Decimal | None = None,
    customer_details: str | None = None,
    customer_evidence: list[str] | None = None,
    customer_extra_note: str | None = None,
) -> Job:
    """Create a new job with SLA snapshot from sla_profiles.

    CRITICAL BUSINESS RULE: The SLA response_minutes and arrival_minutes
    are copied from sla_profiles into the job record at creation time.
    These values are IMMUTABLE after creation.

    Args:
        db: Async database session.
        customer_id: UUID of the customer creating the job.
        task_id: UUID of the task from the closed catalog.
        location: Dict with lat, lon, address, city, etc.
        schedule: Optional dict with requested_date, time_start, time_end.
        priority: Job priority (standard, priority, urgent, emergency).
        is_emergency: Whether this is an emergency job.
        customer_notes_json: List of predefined note selections.

    Returns:
        The newly created Job ORM instance.

    Raises:
        TaskNotFoundError: If the task_id does not exist in the catalog.
    """
    # 1. Validate task exists in the closed catalog
    task_stmt = select(ServiceTask).where(
        ServiceTask.id == task_id,
        ServiceTask.is_active.is_(True),
    )
    task_result = await db.execute(task_stmt)
    task = task_result.scalar_one_or_none()

    if task is None:
        raise TaskNotFoundError(task_id)

    # 1b. Gate de zona de servicio. Va ANTES de cualquier escritura: si la
    # dirección del trabajo cae fuera de las zonas activas, no se crea nada.
    # Se valida la dirección DEL TRABAJO, no el GPS de quien reserva — ver
    # service_zone_service y CLAUDE.md § Service Zones.
    await service_zone_service.assert_in_service_area(
        db,
        location.get("latitude"),
        location.get("longitude"),
        subject="service address",
    )

    # 1c. Detalles y evidencia que aporta el cliente (migración 038).
    #
    # Estos datos son SOPORTE DE DECISIÓN para el proveedor: los ve antes de
    # aceptar, para juzgar si le interesa el trabajo con su rango de precio. NO
    # cambian el alcance ni el precio, que salen del catálogo. Ver CLAUDE.md
    # regla 1.
    #
    # La validación vive AQUÍ y no en las rutas a propósito: hay dos caminos de
    # reserva (`POST /jobs` y `POST /jobs/book`) y si la regla se duplicara en
    # cada uno, tarde o temprano divergen y uno se salta el requisito.
    details = (customer_details or "").strip() or None
    extra_note = (customer_extra_note or "").strip() or None
    evidence = [u for u in (customer_evidence or []) if u and u.strip()]

    if len(evidence) > MAX_CUSTOMER_EVIDENCE_PHOTOS:
        raise BookingInputRequiredError(
            f"You can attach at most {MAX_CUSTOMER_EVIDENCE_PHOTOS} photos "
            f"({len(evidence)} given)."
        )
    if task.requires_details and not details:
        raise BookingInputRequiredError(
            "This service needs a description of the work before it can be booked. "
            "Tell the provider what to expect so they can decide whether to accept."
        )
    if task.requires_evidence and not evidence:
        raise BookingInputRequiredError(
            "This service needs at least one photo before it can be booked. "
            "The provider uses it to decide whether to accept the job."
        )

    # 2. Capture SLA snapshot (IMMUTABLE after this point)
    sla_snapshot = await _capture_sla_snapshot(
        db,
        task,
        service_country=location.get("country", "CA"),
        service_province_state=location.get("province_state"),
        service_city=location.get("city"),
    )

    sla_profile_id = (
        uuid.UUID(sla_snapshot["sla_profile_id"])
        if sla_snapshot.get("sla_profile_id")
        else None
    )

    # 3. Generate unique reference number
    reference_number = generate_reference_number()

    # 4. Build the job record
    job = Job(
        reference_number=reference_number,
        customer_id=customer_id,
        task_id=task_id,
        status=JobStatus.DRAFT,
        priority=JobPriority(priority),
        is_emergency=is_emergency,
        # Location
        service_latitude=Decimal(str(location["latitude"])),
        service_longitude=Decimal(str(location["longitude"])),
        service_address=location["address"],
        service_unit=location.get("unit"),
        service_city=location.get("city"),
        service_province_state=location.get("province_state"),
        service_postal_zip=location.get("postal_zip"),
        service_country=location.get("country", "CA"),
        # SLA snapshot (IMMUTABLE)
        sla_response_time_min=sla_snapshot.get("response_time_min"),
        sla_arrival_time_min=sla_snapshot.get("arrival_time_min"),
        sla_completion_time_min=sla_snapshot.get("completion_time_min"),
        sla_profile_id=sla_profile_id,
        sla_snapshot_json=sla_snapshot,
        # Notes
        customer_notes_json=customer_notes_json or [],
        # Detalles / evidencia / nota del cliente (migración 038)
        customer_details=details,
        customer_evidence_json=evidence,
        customer_extra_note=extra_note,
    )

    # 5. Apply schedule if provided
    if schedule:
        job.requested_date = schedule.get("requested_date")
        job.requested_time_start = schedule.get("requested_time_start")
        job.requested_time_end = schedule.get("requested_time_end")
        job.flexible_schedule = schedule.get("flexible_schedule", False)

    # 5b. Customer-confirmed quantity (PP4a). Only honoured for tasks that allow
    # it; clamped to the task's min_quantity. Ignored otherwise (reprice then
    # falls back to the catalog estimate).
    if quantity is not None and task.allows_quantity:
        q = Decimal(str(quantity))
        if q > 0:
            min_q = task.min_quantity or Decimal(1)
            job.quantity = max(q, min_q)

    db.add(job)
    await db.flush()

    # 6. Emit events
    emit_job_created(
        job_id=job.id,
        customer_id=customer_id,
        task_id=task_id,
        reference_number=reference_number,
    )
    emit_sla_snapshot_captured(
        job_id=job.id,
        sla_profile_id=sla_profile_id,
        snapshot=sla_snapshot,
    )

    logger.info(
        "Job created: %s (ref=%s, task=%s, level=%s, emergency=%s)",
        job.id,
        reference_number,
        task.slug,
        task.level.value,
        is_emergency,
    )

    return job


async def _enforce_start_preconditions(db: AsyncSession, job: Job, now: datetime) -> None:
    """Guard the provider-initiated IN_PROGRESS transition (2026-07-17 requirement).

    A provider may only start the work when BOTH hold:

    * **Scheduled time** — ``now`` is at/after the booked slot (minus a
      ``START_SCHEDULE_GRACE_MIN`` grace). Skipped for emergencies (L4 /
      ``is_emergency``) and for jobs with no requested date (start-now bookings).
    * **On-site** — the provider's last known GPS fix is within
      ``START_ARRIVAL_RADIUS_M`` of the job's service location. Applies to every
      job, emergencies included. A missing fix counts as not-arrived.

    Raises :class:`JobStartNotAllowedError` with a ``code`` the route maps to 409.
    """
    from src.models.job import AssignmentStatus, JobAssignment
    from src.models.provider import ProviderProfile
    from src.services.geoService import haversine_distance

    task = await db.get(ServiceTask, job.task_id)
    is_emergency = bool(job.is_emergency) or (task is not None and task.level == ProviderLevel.LEVEL_4)

    # --- Time gate (emergencies + start-now bookings exempt) ---
    if not is_emergency and job.requested_date is not None:
        slot_time = job.requested_time_start or time(0, 0)
        scheduled = datetime.combine(job.requested_date, slot_time, tzinfo=timezone.utc)
        earliest = scheduled - timedelta(minutes=START_SCHEDULE_GRACE_MIN)
        if now < earliest:
            raise JobStartNotAllowedError(
                "scheduled_time",
                f"This job is scheduled for {scheduled.isoformat()}; it can't be "
                f"started before then.",
            )

    # --- Arrival gate (all jobs) ---
    assignment = (
        await db.execute(
            select(JobAssignment).where(
                JobAssignment.job_id == job.id,
                JobAssignment.status == AssignmentStatus.ACCEPTED,
            ).limit(1)
        )
    ).scalar_one_or_none()
    provider = (
        await db.get(ProviderProfile, assignment.provider_id) if assignment else None
    )
    # The provider's last known location lives on their User record.
    prov_lat = prov_lng = None
    if provider is not None:
        prov_user = await _load_provider_user(db, provider)
        if prov_user is not None:
            prov_lat = prov_user.last_latitude
            prov_lng = prov_user.last_longitude

    if prov_lat is None or prov_lng is None:
        raise JobStartNotAllowedError(
            "not_arrived",
            "We can't confirm you've arrived at the customer's location yet. "
            "Enable location and get on-site to start the job.",
        )

    distance_km = haversine_distance(
        float(prov_lat), float(prov_lng),
        float(job.service_latitude), float(job.service_longitude),
    )
    if distance_km * 1000.0 > START_ARRIVAL_RADIUS_M:
        raise JobStartNotAllowedError(
            "not_arrived",
            f"You appear to be {distance_km * 1000:.0f} m from the service "
            f"location. You must be within {START_ARRIVAL_RADIUS_M:.0f} m to start.",
        )


async def _load_provider_user(db: AsyncSession, provider: Any) -> Any:
    """Return the User owning ``provider`` (for last-known location)."""
    from src.models.user import User

    return await db.get(User, provider.user_id)


async def update_job_status(
    db: AsyncSession,
    job_id: uuid.UUID,
    new_status: str,
    *,
    actor_id: uuid.UUID | None = None,
    actor_type: str = "system",
) -> Job:
    """Transition a job to a new status using the state machine.

    All transitions are validated through the jobStateManager. Invalid
    transitions raise an InvalidTransitionError.

    Args:
        db: Async database session.
        job_id: UUID of the job to update.
        new_status: Target status string.
        actor_id: UUID of the actor performing the transition.
        actor_type: Type of actor (customer, provider, system, admin).

    Returns:
        The updated Job ORM instance.

    Raises:
        JobNotFoundError: If the job does not exist.
        InvalidTransitionError: If the transition is not allowed.
    """
    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if job is None:
        raise JobNotFoundError(job_id)

    old_status = job.status
    target_status = JobStatus(new_status)
    actor = ActorType(actor_type)

    # Validate transition through state machine
    transition_result = validate_transition(old_status, target_status, actor)
    if not transition_result.allowed:
        raise InvalidTransitionError(transition_result.reason or "Transition not allowed.")

    now = datetime.now(timezone.utc)

    # Enforce start preconditions: a PROVIDER may only move a job to IN_PROGRESS
    # once it's the scheduled time (grace-adjusted) AND they're on-site. System /
    # admin transitions bypass this (overrides, tooling, tests).
    if target_status == JobStatus.IN_PROGRESS and actor == ActorType.PROVIDER:
        await _enforce_start_preconditions(db, job, now)

    # Apply the transition
    job.status = target_status

    # Fetch the task to determine level for pricing logic
    task_stmt = select(ServiceTask).where(ServiceTask.id == job.task_id)
    task_result = await db.execute(task_stmt)
    task = task_result.scalar_one_or_none()
    task_level = task.level if task else None

    # Set lifecycle timestamps based on the new status
    if target_status == JobStatus.IN_PROGRESS:
        job.started_at = now

        # For L1/L2 time-based jobs: set pricing_model and hourly_rate
        if task_level in (ProviderLevel.LEVEL_1, ProviderLevel.LEVEL_2):
            job.pricing_model = LEVEL_PRICING_MODEL[task_level]
            hourly_rates = HOURLY_RATES.get(task_level)
            if hourly_rates and job.hourly_rate_cents is None:
                job.hourly_rate_cents = hourly_rates["default"]

        # For L3/L4: set pricing model if not already set
        elif task_level in (ProviderLevel.LEVEL_3, ProviderLevel.LEVEL_4):
            if job.pricing_model is None:
                job.pricing_model = LEVEL_PRICING_MODEL[task_level]

    elif target_status == JobStatus.COMPLETED:
        job.completed_at = now

        # Legacy hourly finalization ONLY. A provider-set-priced job already has
        # an agreed, immutable total (total_charged_cents snapshotted at accept);
        # recomputing from actual duration would wipe the provider's fixed quote
        # along with its commission + payout. Only fall back to duration-based
        # finalization for legacy time-based jobs that never went through the
        # provider-set pricing path.
        if job.pricing_model == "TIME_BASED" and not job.total_charged_cents:
            await finalize_time_based_price(db, job.id)

        # PP4b — auto-capture the held authorization (only jobs that went through
        # the destination-charge hold). An overage above the ceiling is surfaced
        # for customer approval rather than failing completion; Stripe errors are
        # logged and don't block completion.
        if job.authorized_amount_cents and job.stripe_payment_intent_id:
            from src.services import job_payment_service as jp

            try:
                await jp.capture_job(db, job)
            except jp.OverageApprovalRequiredError:
                logger.info(
                    "Job %s completed; actual exceeds authorized ceiling — "
                    "awaiting customer overage approval before capture.",
                    job.id,
                )
            except Exception:  # noqa: BLE001 — never block completion on capture
                logger.exception("Auto-capture failed for job %s at completion", job.id)

    await db.flush()

    # Emit status change event
    emit_job_status_changed(
        job_id=job.id,
        old_status=old_status.value,
        new_status=target_status.value,
        actor_id=actor_id,
    )

    # Emit completion event if applicable
    if target_status == JobStatus.COMPLETED:
        emit_job_completed(job_id=job.id)

    logger.info(
        "Job %s transitioned: %s -> %s (actor=%s, type=%s)",
        job.id,
        old_status.value,
        target_status.value,
        actor_id,
        actor_type,
    )

    return job


async def cancel_job(
    db: AsyncSession,
    job_id: uuid.UUID,
    *,
    cancelled_by: uuid.UUID,
    actor_type: str = "customer",
    reason: str | None = None,
) -> Job:
    """Cancel a job with the appropriate cancellation status.

    The cancellation status is determined by the actor_type:
      - customer -> cancelled_by_customer
      - provider -> cancelled_by_provider
      - system/admin -> cancelled_by_system

    Args:
        db: Async database session.
        job_id: UUID of the job to cancel.
        cancelled_by: UUID of the user cancelling the job.
        actor_type: Type of actor (customer, provider, system, admin).
        reason: Optional cancellation reason.

    Returns:
        The cancelled Job ORM instance.

    Raises:
        JobNotFoundError: If the job does not exist.
        InvalidTransitionError: If cancellation is not allowed.
    """
    # Determine target cancellation status
    cancel_status_map = {
        "customer": JobStatus.CANCELLED_BY_CUSTOMER,
        "provider": JobStatus.CANCELLED_BY_PROVIDER,
        "system": JobStatus.CANCELLED_BY_SYSTEM,
        "admin": JobStatus.CANCELLED_BY_SYSTEM,
    }
    target_status = cancel_status_map.get(actor_type, JobStatus.CANCELLED_BY_SYSTEM)

    stmt = select(Job).where(Job.id == job_id)
    result = await db.execute(stmt)
    job = result.scalar_one_or_none()

    if job is None:
        raise JobNotFoundError(job_id)

    old_status = job.status
    actor = ActorType(actor_type)

    # Validate through state machine
    transition_result = validate_transition(old_status, target_status, actor)
    if not transition_result.allowed:
        raise InvalidTransitionError(transition_result.reason or "Cancellation not allowed.")

    # Apply cancellation
    job.status = target_status
    job.cancelled_at = datetime.now(timezone.utc)
    job.cancellation_reason = reason

    await db.flush()

    # Emit events
    emit_job_status_changed(
        job_id=job.id,
        old_status=old_status.value,
        new_status=target_status.value,
        actor_id=cancelled_by,
    )
    emit_job_cancelled(
        job_id=job.id,
        cancelled_by=cancelled_by,
        reason=reason,
    )

    logger.info(
        "Job %s cancelled: %s -> %s by %s (reason=%s)",
        job.id,
        old_status.value,
        target_status.value,
        cancelled_by,
        reason,
    )

    return job


async def get_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job | None:
    """Fetch a single job by primary key with assignments eagerly loaded.

    Returns None if the job is not found.
    """
    stmt = (
        select(Job)
        .options(selectinload(Job.assignments))
        .where(Job.id == job_id)
    )
    result = await db.execute(stmt)
    return result.scalar_one_or_none()


async def get_jobs_by_customer(
    db: AsyncSession,
    customer_id: uuid.UUID,
    *,
    status_filter: str | None = None,
    page: int = 1,
    page_size: int = 20,
) -> PaginatedResult:
    """Return a paginated list of jobs for a specific customer.

    Optionally filtered by status.
    """
    filters = [Job.customer_id == customer_id]
    if status_filter:
        filters.append(Job.status == JobStatus(status_filter))

    # Count
    count_stmt = select(func.count(Job.id)).where(*filters)
    total_items: int = (await db.execute(count_stmt)).scalar_one()

    # Data
    data_stmt = (
        select(Job)
        .where(*filters)
        .order_by(Job.created_at.desc())
        .offset((page - 1) * page_size)
        .limit(page_size)
    )
    jobs = (await db.execute(data_stmt)).scalars().all()

    return PaginatedResult(
        items=jobs,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


    return PaginatedResult(
        items=jobs,
        total_items=total_items,
        page=page,
        page_size=page_size,
    )


async def queue_job(
    db: AsyncSession,
    job_id: uuid.UUID,
) -> Job:
    """Transition a job to PENDING and broadcast it to nearby qualified providers.

    1. Update status to PENDING (if not already).
    2. Find active providers who are qualified for this task.
    3. Filter by distance (job location vs provider home + radius).
    4. Create JobAssignment (OFFERED) for each match.
    """
    from src.models.provider import (
        ProviderProfile,
        ProviderProfileStatus,
    )
    from src.models.taxonomy import ProviderTaskQualification
    from src.models.job import JobAssignment, AssignmentStatus
    from src.services.geoService import haversine_distance

    # 1. Fetch job
    job = await get_job(db, job_id)
    if not job:
        raise JobNotFoundError(job_id)

    # 1b. Update status to PENDING if currently DRAFT or PENDING_MATCH
    # If already PENDING, we just re-broadcast
    if job.status in [JobStatus.DRAFT, JobStatus.PENDING_MATCH]:
        job = await update_job_status(db, job.id, JobStatus.PENDING, actor_type="system")

    # 2. Find qualified providers
    # query: Active profiles + Qualified for task
    stmt = (
        select(ProviderProfile)
        .join(ProviderTaskQualification)
        .where(
            ProviderProfile.status == ProviderProfileStatus.ACTIVE,
            ProviderTaskQualification.task_id == job.task_id,
            ProviderTaskQualification.qualified.is_(True),
        )
    )
    result = await db.execute(stmt)
    candidates = result.scalars().all()

    # 3. Filter by location & Create Assignments
    assignments_created = 0
    
    # We might want to check if assignment already exists to avoid duplicates
    existing_assign_stmt = (
        select(JobAssignment.provider_id)
        .where(JobAssignment.job_id == job.id)
    )
    existing_provider_ids = (await db.execute(existing_assign_stmt)).scalars().all()
    existing_set = set(existing_provider_ids)

    for provider in candidates:
        if provider.id in existing_set:
            continue
            
        # Location check
        # If provider has no location, skip (or default to allow? skip for now)
        if provider.home_latitude is None or provider.home_longitude is None:
            continue

        dist_km = haversine_distance(
            float(job.service_latitude),
            float(job.service_longitude),
            float(provider.home_latitude),
            float(provider.home_longitude),
        )

        # check if job is within provider's radius
        if dist_km <= float(provider.service_radius_km):
            # Create assignment
            assignment = JobAssignment(
                job_id=job.id,
                provider_id=provider.id,
                status=AssignmentStatus.OFFERED,
                offered_at=datetime.now(timezone.utc),
                # Expires in 30 mins or custom time?
                offer_expires_at=datetime.now(timezone.utc) + timedelta(minutes=30), 
            )
            db.add(assignment)
            assignments_created += 1

    await db.commit()
    logger.info(f"Queued job {job.id}: Broadcasted to {assignments_created} providers.")
    
    return job
