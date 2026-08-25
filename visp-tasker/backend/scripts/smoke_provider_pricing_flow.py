"""
End-to-end smoke for the Provider-Set Pricing LOOP (PP2 + PP4).

Proves the full provider -> customer flow against visp_prod:
  1. provider sets their rate (PUT /provider/rates/{task})           [PP2]
  2. a job exists for that task, offered to the provider             [setup]
  3. provider accepts -> job re-quoted from THEIR rate               [PP4]
  4. customer sees the provider's price (GET /jobs/{id}/pending-provider)
  5. customer approves -> job PROVIDER_ACCEPTED

Requires migrations 021 + 022 applied. A try/finally cleans up the job,
assignment, rate and any seeded qualification so visp_prod is left as it was.

Run with::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_provider_pricing_flow.py

Prints SMOKE PASS on success; exits non-zero on any failure.
"""

from __future__ import annotations

import asyncio
import os
import sys
import uuid
from decimal import Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.main import app  # noqa: E402
from src.services import auth_service  # noqa: E402

from src.core.config import settings  # noqa: E402

# La conexión sale del .env (settings.database_url): este script NO lleva
# credenciales dentro. Se niega a correr si no es la base real.
_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

API = "/api/v1"


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SmokeError(msg)


def step(n: int, msg: str) -> None:
    print(f"[step {n}] {msg}")


def expected_qty(unit: str, dur_min: int | None) -> int:
    if unit == "HOURLY":
        return max(1, round((dur_min or 60) / 60))
    return 1


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    job_id = uuid.uuid4()
    provider_id = None
    # Set once the provider is picked; the cleanup runs even if we fail before that.
    home_original = None
    task = None
    seeded_qual = False
    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "wrong DB")
        print("Connected to dev DB: visp_prod")

        # ACTIVE + L0/L1 + ORDER BY id. `ORDER BY created_at` picked a different
        # provider on every run (the seeded ones share created_at) and sometimes
        # landed on an L3, which needs a verified licence and insurance to be
        # offered any job. It went unnoticed while the smoke inserted the
        # job_assignment by hand; the provider job list is now computed live, so
        # the real eligibility filter applies.
        prov = await conn.fetchrow(
            "SELECT id, user_id, home_latitude, home_longitude, service_radius_km "
            "FROM provider_profiles "
            "WHERE status = 'ACTIVE' AND current_level IN ('LEVEL_0', 'LEVEL_1') "
            "ORDER BY id LIMIT 1"
        )
        check(prov is not None, "need an ACTIVE L0/L1 provider_profile")
        provider_id, provider_user = prov["id"], prov["user_id"]
        # Put the provider where the job is (43.65, -79.38) — that distance is what
        # matching measures. Restored in the cleanup below.
        home_original = (prov["home_latitude"], prov["home_longitude"], prov["service_radius_km"])
        await conn.execute(
            "UPDATE provider_profiles SET home_latitude=43.65, home_longitude=-79.38, "
            "service_radius_km=50, updated_at=now() WHERE id=$1",
            provider_id,
        )

        # A non-custom task with a price range.
        task = await conn.fetchrow(
            """SELECT id, name, pricing_unit, base_price_min_cents, base_price_max_cents, estimated_duration_min
               FROM service_tasks
               WHERE pricing_unit <> 'CUSTOM_QUOTE' AND is_active = TRUE
                 AND base_price_min_cents IS NOT NULL AND base_price_max_cents > base_price_min_cents
               ORDER BY name LIMIT 1"""
        )
        check(task is not None, "need a priceable task with a range")
        unit = task["pricing_unit"]
        print(f"provider {provider_id} · task '{task['name']}' ({unit}) "
              f"[{task['base_price_min_cents']}..{task['base_price_max_cents']}] dur={task['estimated_duration_min']}")

        # Ensure the provider is qualified for it.
        q = await conn.fetchrow(
            "SELECT id, qualified FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
            provider_id, task["id"],
        )
        if q is None:
            await conn.execute(
                "INSERT INTO provider_task_qualifications (id, provider_id, task_id, qualified, auto_granted, qualified_at, created_at, updated_at) "
                "VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
                uuid.uuid4(), provider_id, task["id"],
            )
            seeded_qual = True
        elif not q["qualified"]:
            await conn.execute("UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1", q["id"])

        # A customer user (anyone other than the provider's own user).
        customer = await conn.fetchrow(
            "SELECT id, email FROM users WHERE id <> $1 ORDER BY created_at NULLS LAST LIMIT 1",
            provider_user,
        )
        check(customer is not None, "need a customer user")

        rate_cents = (task["base_price_min_cents"] + task["base_price_max_cents"]) // 2
        qty = expected_qty(unit, task["estimated_duration_min"])
        expected_subtotal = rate_cents * qty
        catalog_quote = task["base_price_max_cents"] + 999  # deliberately different
        commission_rate = 0.20

        token_prov, _ = auth_service.create_access_token(provider_user)
        token_cust, _ = auth_service.create_access_token(customer["id"])
        hdr_prov = {"Authorization": f"Bearer {token_prov}"}
        hdr_cust = {"Authorization": f"Bearer {token_cust}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as client:
            # 1. provider sets their rate via the API (PP2).
            step(1, f"PUT /provider/rates — provider sets {rate_cents}c")
            r = await client.put(f"{API}/provider/rates/{task['id']}", headers=hdr_prov, json={"rate_cents": rate_cents})
            check(r.status_code == 200, f"set rate: {r.status_code}: {r.text}")
            print(f"        -> 200, rate {rate_cents}c / {unit}")

            # 2. create an OPEN job (PENDING_MATCH) + OFFERED assignment.
            #
            # Ofertas v2 (2026-08-19): el proveedor ya no "acepta" un trabajo, OFERTA.
            # El trabajo vive en PENDING_MATCH mientras admite ofertas y salta directo
            # a SCHEDULED cuando el cliente elige una; PENDING_APPROVAL era del flujo
            # viejo (el proveedor se interesaba y el cliente lo aprobaba después) y ya
            # no se usa. El precio lo sella la aceptación de la oferta, igual que antes
            # lo sellaba el accept del proveedor.
            step(2, "seed an OPEN job offered to the provider")
            await conn.execute(
                """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                       service_latitude, service_longitude, service_address,
                       quoted_price_cents, commission_rate, created_at, updated_at)
                   VALUES ($1,$2,$3,$4,'PENDING_MATCH',43.65,-79.38,'1 Smoke St',$5,$6,now(),now())""",
                job_id, f"PP4-{job_id.hex[:8].upper()}", customer["id"], task["id"],
                catalog_quote, commission_rate,
            )
            # No hand-seeded job_assignment: the provider job list reads none.
            print(f"        -> job {job_id} quoted at catalog {catalog_quote}c")

            # 3. provider offers + customer accepts -> reprice to provider rate (PP4).
            step(3, "provider offers, customer accepts — triggers re-quote")
            r = await client.post(
                f"{API}/provider/open-jobs/{job_id}/offer", headers=hdr_prov,
                json={"magnitude": float(qty)},
            )
            check(r.status_code == 201, f"offer: {r.status_code}: {r.text}")
            offer_id = r.json()["data"]["offerId"]
            r = await client.post(
                f"{API}/jobs/{job_id}/offers/{offer_id}/accept", headers=hdr_cust)
            check(r.status_code == 200, f"accept: {r.status_code}: {r.text}")
            row = await conn.fetchrow("SELECT status, quoted_price_cents, commission_amount_cents, provider_payout_cents FROM jobs WHERE id=$1", job_id)
            check(str(row["status"]).upper().endswith("SCHEDULED"), f"status {row['status']}")
            check(row["quoted_price_cents"] == expected_subtotal,
                  f"quote not repriced: got {row['quoted_price_cents']}, expected {expected_subtotal} ({rate_cents}x{qty})")
            # La comisión NO es la que se sembró en el job: el reprice la vuelve a
            # calcular desde el NIVEL del proveedor que se queda el trabajo, que es lo
            # correcto — al reservar no hay proveedor asignado y esa tasa era un
            # marcador. Se comprueba la relación (comisión = subtotal × la tasa que
            # quedó), no un número fijo que se rompe cada vez que cambian los niveles.
            tasa_final = await conn.fetchval(
                "SELECT commission_rate FROM jobs WHERE id=$1", job_id)
            check(tasa_final is not None, "el reprice no dejó tasa de comisión")
            exp_comm = int(Decimal(expected_subtotal) * tasa_final)
            check(row["commission_amount_cents"] == exp_comm, f"commission {row['commission_amount_cents']} != {exp_comm}")
            check(row["provider_payout_cents"] == expected_subtotal - exp_comm, "payout mismatch")
            print(f"        -> 200, repriced {catalog_quote}c -> {expected_subtotal}c (rate {rate_cents}x{qty}), "
                  f"commission {exp_comm}c, payout {row['provider_payout_cents']}c")

            # 4. la oferta aceptada guarda lo que el cliente vio antes de decidir.
            #
            # Sustituye a `GET /jobs/{job}/pending-provider`, que era del flujo viejo.
            # Ahora el cliente ve el precio EN LA OFERTA, antes de aceptar, y la fila
            # de `job_offers` es el registro inmutable de lo que se le enseñó.
            step(4, "la oferta aceptada refleja tarifa y precio del proveedor")
            oferta = await conn.fetchrow(
                "SELECT rate_cents, subtotal_cents, unit::text unit, status "
                "FROM job_offers WHERE id=$1", uuid.UUID(offer_id))
            check(oferta["status"] == "accepted", f"offer status {oferta['status']}")
            check(oferta["rate_cents"] == rate_cents, f"rateCents {oferta['rate_cents']} != {rate_cents}")
            check(oferta["subtotal_cents"] == expected_subtotal,
                  f"subtotal {oferta['subtotal_cents']} != {expected_subtotal}")
            check(oferta["unit"] == unit, f"unit {oferta['unit']} != {unit}")
            print(f"        -> customer saw ${rate_cents/100:.2f}/{oferta['unit']} -> ${expected_subtotal/100:.2f}")

            # 5. customer approves.
            # 5. Aceptar la oferta YA agendó el trabajo: no hay un segundo paso de
            # aprobación. `approve-provider` existía porque el cliente conocía al
            # proveedor DESPUÉS de que este aceptara; ahora lo ve —con precio, tiempo
            # y reputación— antes de elegir, así que no queda nada que aprobar.
            step(5, "aceptar la oferta deja el trabajo agendado, sin segundo paso")
            st = await conn.fetchval("SELECT status FROM jobs WHERE id=$1", job_id)
            check(str(st).upper().endswith("SCHEDULED"), f"final status {st}")
            asg = await conn.fetchval(
                "SELECT status::text FROM job_assignments WHERE job_id=$1 AND provider_id=$2",
                job_id, provider_id)
            check(asg == "ACCEPTED", f"assignment {asg} != ACCEPTED")
            print(f"        -> job {st}, asignación ACCEPTED")

        print("\nAll 5 steps passed.")

    finally:
        print("\n[cleanup] removing test data ...")
        try:
            # pricing_events FK jobs with ON DELETE RESTRICT — clear them first
            # (the accept-reprice now snapshots a tax/receipt event, PP3).
            await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", job_id)
            await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
            await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)
            if provider_id and home_original is not None:
                await conn.execute(
                    "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3, "
                    "service_radius_km=$4, updated_at=now() WHERE id=$1",
                    provider_id, *home_original,
                )
            if provider_id and task:
                await conn.execute(
                    "DELETE FROM provider_service_rates WHERE provider_id=$1 AND task_id=$2",
                    provider_id, task["id"],
                )
                if seeded_qual:
                    await conn.execute(
                        "DELETE FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
                        provider_id, task["id"],
                    )
            print("[cleanup] visp_prod is clean.")
        finally:
            await conn.close()


def main() -> None:
    try:
        asyncio.run(run())
    except BaseException as exc:  # noqa: BLE001
        print(f"\nSMOKE FAIL: {type(exc).__name__}: {exc}", file=sys.stderr)
        sys.exit(1)
    print("\nSMOKE PASS")


if __name__ == "__main__":
    main()
