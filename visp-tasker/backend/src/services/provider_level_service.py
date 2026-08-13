"""Provider level derivation + task-qualification sync (section-based model, migration 029).

Rules (Ricardo, 2026-07-23):
  * L1 (default) — no approved SECTION document. Sees/offers only OPEN sections
    (service_categories.requires_credential = False).
  * L2 — the provider has >= 1 VERIFIED credential tied to a SECTION
    (provider_credentials.category_id set). This is the global L1 -> L2 flip:
    the first approved section document unlocks all L2 gated sections.
  * L3 — regulated trades. In addition to L2, requires a VERIFIED trade LICENSE
    (credential_type = license, non-expired) AND a VERIFIED, active insurance
    policy. The matching engine still enforces license+insurance as a backstop.
  * L4 (emergency) — SHELVED for now. Never auto-assigned; L4 tasks never qualify.

A task in an OPEN section is always offerable. A task in a GATED section is
offerable once the provider's level reaches the task's required level.

This module is the single source of truth for both current_level and the
per-task ProviderTaskQualification.qualified flag; call
``recompute_level_and_qualifications`` whenever a credential or insurance policy
changes verification state, and use ``task_qualifies`` at onboarding/service
selection time.
"""

from __future__ import annotations

import uuid
from datetime import date, datetime, timezone

from sqlalchemy import func, or_, select
from sqlalchemy.ext.asyncio import AsyncSession

from src.models.provider import (
    ProviderLevel,
    ProviderLevelRecord,
    ProviderProfile,
)
from src.models.taxonomy import ProviderTaskQualification, ServiceCategory, ServiceTask
from src.models.verification import (
    CredentialStatus,
    CredentialType,
    InsuranceStatus,
    ProviderCredential,
    ProviderInsurancePolicy,
)

LEVEL_NUMERIC: dict[ProviderLevel, int] = {
    ProviderLevel.LEVEL_0: 0,
    ProviderLevel.LEVEL_1: 1,
    ProviderLevel.LEVEL_2: 2,
    ProviderLevel.LEVEL_3: 3,
    ProviderLevel.LEVEL_4: 4,
}


def task_qualifies(
    provider_level: ProviderLevel,
    task_level: ProviderLevel,
    section_requires_credential: bool = False,
) -> bool:
    """Whether a provider at ``provider_level`` may offer/be matched to a task.

    INTERINO (2026-08-04). La reestructuración L0..L3 apagó
    ``service_categories.requires_credential`` en las 12 categorías porque el
    gate pasó de la SECCIÓN al SERVICIO. Con la lógica anterior eso dejaba
    ``section_requires_credential=False`` para todo, y la función devolvía True
    incluso para instalar una línea de gas: cualquier proveedor podría tomar
    cualquier trabajo regulado.

    Hasta que el motor por servicio esté (lee los códigos de
    ``service_credential_requirements`` contra las credenciales verificadas del
    proveedor), se aplica el nivel GLOBAL como backstop para el trabajo
    regulado:

    * L4 nunca califica (Emergency fuera del producto).
    * L0/L1 (acceso base y trabajo no regulado) califican siempre.
    * L2/L3 exigen provider_level >= task_level.

    ``section_requires_credential`` se conserva en la firma por compatibilidad
    con las llamadas existentes, pero ya no decide nada.
    """
    if task_level == ProviderLevel.LEVEL_4:
        return False
    if task_level in (ProviderLevel.LEVEL_0, ProviderLevel.LEVEL_1):
        return True
    return LEVEL_NUMERIC[provider_level] >= LEVEL_NUMERIC[task_level]


async def _has_verified_section_credential(db: AsyncSession, provider_id: uuid.UUID) -> bool:
    """True if the provider has >= 1 VERIFIED credential attached to a section."""
    stmt = select(func.count(ProviderCredential.id)).where(
        ProviderCredential.provider_id == provider_id,
        ProviderCredential.category_id.is_not(None),
        ProviderCredential.status == CredentialStatus.VERIFIED,
    )
    return (await db.execute(stmt)).scalar_one() > 0


async def _has_verified_license(
    db: AsyncSession, provider_id: uuid.UUID, on_date: date
) -> bool:
    """True si el proveedor tiene una licencia de OFICIO verificada y vigente.

    NO ampliar el filtro de tipo. Cuenta ``CredentialType.LICENSE`` y nada más:
    la licencia de CONDUCIR tiene su propio tipo (``DRIVERS_LICENSE``, migración
    035) justo para que no llegue hasta aquí. Mientras las dos compartieron el
    valor ``LICENSE``, un proveedor subía su G2, el admin la aprobaba de buena
    fe, y esta función devolvía True -> le abría el gate de trabajo regulado.
    """
    stmt = select(func.count(ProviderCredential.id)).where(
        ProviderCredential.provider_id == provider_id,
        ProviderCredential.credential_type == CredentialType.LICENSE,
        ProviderCredential.status == CredentialStatus.VERIFIED,
        or_(
            ProviderCredential.expiry_date.is_(None),
            ProviderCredential.expiry_date >= on_date,
        ),
    )
    return (await db.execute(stmt)).scalar_one() > 0


async def _has_verified_insurance(
    db: AsyncSession, provider_id: uuid.UUID, on_date: date
) -> bool:
    stmt = select(func.count(ProviderInsurancePolicy.id)).where(
        ProviderInsurancePolicy.provider_id == provider_id,
        ProviderInsurancePolicy.status == InsuranceStatus.VERIFIED,
        ProviderInsurancePolicy.effective_date <= on_date,
        ProviderInsurancePolicy.expiry_date >= on_date,
    )
    return (await db.execute(stmt)).scalar_one() > 0


async def compute_level(db: AsyncSession, provider_id: uuid.UUID) -> ProviderLevel:
    """Derive the provider's level from their VERIFIED credentials/insurance."""
    if not await _has_verified_section_credential(db, provider_id):
        return ProviderLevel.LEVEL_1

    today = date.today()
    if await _has_verified_license(db, provider_id, today) and await _has_verified_insurance(
        db, provider_id, today
    ):
        return ProviderLevel.LEVEL_3
    return ProviderLevel.LEVEL_2


async def recompute_level_and_qualifications(
    db: AsyncSession,
    provider_id: uuid.UUID,
    *,
    admin_user_id: uuid.UUID | None = None,
) -> ProviderLevel:
    """Recompute current_level and re-derive every ProviderTaskQualification.qualified.

    Writes a ProviderLevelRecord when the level actually changes. Flushes (no
    commit) so the caller controls the transaction. Returns the resolved level.
    """
    profile = (
        await db.execute(
            select(ProviderProfile).where(ProviderProfile.id == provider_id)
        )
    ).scalar_one_or_none()
    if profile is None:
        return ProviderLevel.LEVEL_1

    now = datetime.now(timezone.utc)
    level = await compute_level(db, provider_id)

    if profile.current_level != level:
        previous = profile.current_level
        profile.current_level = level
        db.add(
            ProviderLevelRecord(
                provider_id=provider_id,
                level=level,
                qualified=LEVEL_NUMERIC[level] > LEVEL_NUMERIC[previous],
                qualified_at=now,
                revoked_at=None if LEVEL_NUMERIC[level] >= LEVEL_NUMERIC[previous] else now,
                revoked_reason=(
                    None
                    if LEVEL_NUMERIC[level] >= LEVEL_NUMERIC[previous]
                    else "Credential/insurance no longer valid"
                ),
                approved_by=admin_user_id,
            )
        )

    # Re-derive qualified for every task the provider has selected.
    rows = (
        await db.execute(
            select(ProviderTaskQualification, ServiceTask, ServiceCategory)
            .join(ServiceTask, ProviderTaskQualification.task_id == ServiceTask.id)
            .join(ServiceCategory, ServiceTask.category_id == ServiceCategory.id)
            .where(ProviderTaskQualification.provider_id == provider_id)
        )
    ).all()

    # Gate de seguro por servicio. Va AQUÍ y no solo en las rutas porque esta
    # función es la que corre cuando el admin aprueba o rechaza una póliza: si no
    # lo mirara, aprobar el seguro no desbloquearía nada y rechazarlo dejaría los
    # servicios abiertos. Es el punto donde se cierra el ciclo.
    insurance_tasks = await tasks_requiring_insurance(db, [task.id for _, task, _ in rows])
    has_insurance = await provider_has_valid_insurance(db, provider_id)

    for qual, task, category in rows:
        insurance_ok = task.id not in insurance_tasks or has_insurance
        should = (
            task_qualifies(level, task.level, category.requires_credential)
            and insurance_ok
        )
        if qual.qualified != should:
            qual.qualified = should
            qual.qualified_at = now if should else None
            qual.auto_granted = True

    await db.flush()
    return level


# ---------------------------------------------------------------------------
# Gate de seguro POR SERVICIO (migración 034 + checkbox del admin)
# ---------------------------------------------------------------------------

async def tasks_requiring_insurance(
    db: AsyncSession, task_ids: list[uuid.UUID]
) -> set[uuid.UUID]:
    """De los servicios dados, cuáles exigen seguro.

    La fuente es `service_credential_requirements` cruzada con el `kind` del
    código: NO hay un booleano `requires_insurance` en `service_tasks`. Eso es
    deliberado — el checkbox del admin escribe esta misma fila, así que el motor
    consulta un solo sitio y no puede haber dos fuentes contradiciéndose.

    Se filtra por `kind = INSURANCE` y no por el código literal 'CGL' para que
    añadir otro tipo de póliza al catálogo no exija tocar el motor.
    """
    if not task_ids:
        return set()

    from src.models.taxonomy import (
        CredentialRequirement,
        ServiceCredentialRequirement,
    )

    stmt = (
        select(ServiceCredentialRequirement.task_id)
        .join(
            CredentialRequirement,
            CredentialRequirement.code == ServiceCredentialRequirement.code,
        )
        .where(
            ServiceCredentialRequirement.task_id.in_(task_ids),
            # `kind` es columna de texto (no enum de Python); las etiquetas del
            # enum de Postgres van en MAYÚSCULAS.
            CredentialRequirement.kind == "INSURANCE",
            CredentialRequirement.is_active.is_(True),
        )
    )
    return {row[0] for row in (await db.execute(stmt)).all()}


async def provider_has_valid_insurance(
    db: AsyncSession, provider_id: uuid.UUID
) -> bool:
    """Póliza VERIFIED y vigente hoy.

    Pendiente de revisión o vencida NO cuenta: si bastara con tener "una póliza",
    subir cualquier PDF abriría los servicios que exigen seguro, que es justo lo
    que el requisito existe para evitar.
    """
    return await _has_verified_insurance(db, provider_id, date.today())
