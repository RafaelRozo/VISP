"""Smoke del GATE DE SEGURO por servicio.

Prueba el ciclo completo que pidió el cliente: si un servicio está marcado como
"requiere seguro", el proveedor no puede ofrecerlo hasta tener una póliza
verificada y vigente en su perfil — y en cuanto el admin la aprueba, se desbloquea
solo.

El punto crítico es `recompute_level_and_qualifications`: es lo que corre cuando el
admin aprueba la póliza. Si no mirara el seguro, aprobarlo no desbloquearía nada.

Se auto-limpia.

    ./venv/bin/python scripts/smoke_insurance_gate.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import date, timedelta

sys.path.insert(0, ".")

from src.api.deps import async_session_factory  # noqa: E402

passed = 0
failed: list[str] = []


def check(name: str, ok: bool, detail: str = "") -> None:
    global passed
    if ok:
        passed += 1
        print(f"  PASS  {name}" + (f" — {detail}" if detail else ""))
    else:
        failed.append(name)
        print(f"  FAIL  {name}" + (f" — {detail}" if detail else ""))


async def main() -> int:  # noqa: C901
    print("=" * 72)
    print("SMOKE — gate de seguro por servicio")
    print("=" * 72)

    from sqlalchemy import delete, select

    from src.models.provider import ProviderProfile
    from src.models.taxonomy import (
        ProviderTaskQualification,
        ServiceCredentialRequirement,
        ServiceTask,
    )
    from src.models.verification import InsuranceStatus, ProviderInsurancePolicy
    from src.services.provider_level_service import (
        provider_has_valid_insurance,
        recompute_level_and_qualifications,
        tasks_requiring_insurance,
    )

    creado_req = False
    creada_poliza: uuid.UUID | None = None
    creada_qual = False

    async with async_session_factory() as db:
        task = (
            await db.execute(
                select(ServiceTask)
                .where(ServiceTask.is_active.is_(True), ServiceTask.level == "LEVEL_0")
                .limit(1)
            )
        ).scalar_one()
        provider = (await db.execute(select(ProviderProfile).limit(1))).scalar_one()
        print(f"  servicio: {task.name}")
        print(f"  proveedor: {provider.id}")

        # Estado de partida: sin póliza vigente.
        pólizas_previas = (
            await db.execute(
                select(ProviderInsurancePolicy).where(
                    ProviderInsurancePolicy.provider_id == provider.id
                )
            )
        ).scalars().all()
        if pólizas_previas:
            print(f"  (el proveedor ya tenía {len(pólizas_previas)} póliza(s); se respetan)")

        print("\n[1] El servicio NO exige seguro todavía")
        req = await tasks_requiring_insurance(db, [task.id])
        check("el motor dice que no lo exige", task.id not in req)

        print("\n[2] El admin marca el checkbox")
        db.add(ServiceCredentialRequirement(task_id=task.id, code="CGL", mandatory=True))
        await db.commit()
        creado_req = True
        req = await tasks_requiring_insurance(db, [task.id])
        check("el motor lo ve como que exige seguro", task.id in req)

        print("\n[3] El proveedor elige el servicio SIN póliza")
        existente = (
            await db.execute(
                select(ProviderTaskQualification).where(
                    ProviderTaskQualification.provider_id == provider.id,
                    ProviderTaskQualification.task_id == task.id,
                )
            )
        ).scalar_one_or_none()
        if existente is None:
            db.add(
                ProviderTaskQualification(
                    provider_id=provider.id, task_id=task.id, qualified=True
                )
            )
            await db.commit()
            creada_qual = True

        tiene = await provider_has_valid_insurance(db, provider.id)
        await recompute_level_and_qualifications(db, provider.id)
        await db.commit()
        q = (
            await db.execute(
                select(ProviderTaskQualification).where(
                    ProviderTaskQualification.provider_id == provider.id,
                    ProviderTaskQualification.task_id == task.id,
                )
            )
        ).scalar_one()
        if tiene:
            check("(el proveedor YA tenía póliza vigente, no se puede probar el bloqueo)",
                  False, "usa un proveedor sin póliza")
        else:
            check("sin póliza -> NO cualificado", q.qualified is False,
                  f"qualified={q.qualified}")

        print("\n[4] Sube la póliza y el admin la aprueba")
        hoy = date.today()
        poliza = ProviderInsurancePolicy(
            provider_id=provider.id,
            policy_number=f"GATE-{uuid.uuid4().hex[:8].upper()}",
            insurer_name="Intact (smoke)",
            policy_type="general_liability",
            coverage_amount_cents=200_000_000,
            effective_date=hoy - timedelta(days=1),
            expiry_date=hoy + timedelta(days=364),
            status=InsuranceStatus.PENDING_REVIEW,
        )
        db.add(poliza)
        await db.commit()
        creada_poliza = poliza.id

        await recompute_level_and_qualifications(db, provider.id)
        await db.commit()
        q = (await db.execute(
            select(ProviderTaskQualification).where(
                ProviderTaskQualification.provider_id == provider.id,
                ProviderTaskQualification.task_id == task.id,
            )
        )).scalar_one()
        check("póliza PENDIENTE -> sigue sin cualificar", q.qualified is False,
              f"qualified={q.qualified}")

        # El admin la aprueba.
        poliza.status = InsuranceStatus.VERIFIED
        await db.commit()
        await recompute_level_and_qualifications(db, provider.id)
        await db.commit()
        q = (await db.execute(
            select(ProviderTaskQualification).where(
                ProviderTaskQualification.provider_id == provider.id,
                ProviderTaskQualification.task_id == task.id,
            )
        )).scalar_one()
        check("póliza VERIFICADA -> se desbloquea solo", q.qualified is True,
              f"qualified={q.qualified}")

        print("\n[5] La póliza vence")
        poliza.expiry_date = hoy - timedelta(days=1)
        await db.commit()
        vigente = await provider_has_valid_insurance(db, provider.id)
        await recompute_level_and_qualifications(db, provider.id)
        await db.commit()
        q = (await db.execute(
            select(ProviderTaskQualification).where(
                ProviderTaskQualification.provider_id == provider.id,
                ProviderTaskQualification.task_id == task.id,
            )
        )).scalar_one()
        check("póliza vencida no cuenta como vigente", vigente is False)
        check("vencida -> se vuelve a bloquear", q.qualified is False,
              f"qualified={q.qualified}")

        # ------------------------------------------------------------ limpieza
        print("\n[6] Limpieza")
        if creada_poliza:
            await db.execute(
                delete(ProviderInsurancePolicy).where(
                    ProviderInsurancePolicy.id == creada_poliza
                )
            )
        if creado_req:
            await db.execute(
                delete(ServiceCredentialRequirement).where(
                    ServiceCredentialRequirement.task_id == task.id,
                    ServiceCredentialRequirement.code == "CGL",
                )
            )
        if creada_qual:
            await db.execute(
                delete(ProviderTaskQualification).where(
                    ProviderTaskQualification.provider_id == provider.id,
                    ProviderTaskQualification.task_id == task.id,
                )
            )
        await db.commit()
        # Recalcular para dejar las cualificaciones como estaban.
        await recompute_level_and_qualifications(db, provider.id)
        await db.commit()
        restantes = await tasks_requiring_insurance(db, [task.id])
        print(f"        requisito CGL restante: {'SÍ (!)' if restantes else 'no'}")

    print("\n" + "=" * 72)
    total = passed + len(failed)
    print(f"RESULTADO: {passed}/{total} PASS")
    for name in failed:
        print(f"  - FALLÓ: {name}")
    print("=" * 72)
    return 1 if failed else 0


if __name__ == "__main__":
    raise SystemExit(asyncio.run(main()))
