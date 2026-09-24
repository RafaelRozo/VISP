"""Smoke de la preparación de cuenta — GET /users/me/readiness.

Plan: docs/plan-checklist-cuenta.md

Es el checklist guiado del Home. Lo que se comprueba:

  A — Sin token, 401. Los pasos que faltan son información de la cuenta.
  B — Un proveedor recién creado, sin NADA: los 5 bloqueantes en
      `action_required`, `nextKey` = contract, `allDone` False. El paso
      destacado es SIEMPRE el primer bloqueante, nunca un recomendado.
  C — El contrato firmado por el camino real (POST /consents/sign) mueve el
      paso a `done` y `nextKey` avanza al siguiente. Con CONTROL: se comprueba
      contra `has_valid_signature`, que es el predicado que usa la puerta.
  D — Dirección base: lat/lng SIN radio no basta; con radio, `done`. Es la
      dirección DECLARADA — el mismo dato que mira `provider_can_bid`.
  E — Servicios: el conteo es el de cualificaciones reales.
  F — Precio: con 2 servicios tarifables y 1 tarifa, `withRate` 1 de 2 y el paso
      sigue pendiente. Con las dos, `done`.
  G — Un servicio PER_CONTRACT **no** cuenta para el paso del precio: ahí el
      precio lo pone el cliente, y contarlo dejaría un paso imposible de
      terminar.
  H — Cobros, los cuatro estados: sin cuenta (0 de 5), a medias (resumeAt donde
      lo dejó), entregado sin capabilities (`in_review`, NO pendiente — el
      proveedor no puede hacer nada y en visp_prod las 7 cuentas están así), y
      con capabilities activas (`done`).
  I — Perfil: SOLO la bio, y no bloquea. Pedía además "3 fotos" contadas de
      `provider_credentials` tipo PORTFOLIO: ni el número existía como regla en
      el backend, ni esa es la tabla vigente —la evidencia se movió al
      expediente único `provider_experience_records` el 2026-08-11—, así que era
      un paso imposible de completar.
  J — Con todo hecho, `allDone` True y `nextKey` None: el checklist desaparece.
  K — Cliente: dirección y tarjeta. Un `both` pide su lista por rol y son dos
      listas distintas.
  N — LA PUERTA DE LA TARJETA: un cliente sin método de pago NO puede publicar
      un trabajo (`POST /jobs/book` -> 400 `payment_method_required`). Y con
      CONTROL de coherencia: el checklist marca ese mismo paso pendiente en el
      mismo instante, porque los dos leen
      `readiness_service.customer_has_payment_method`. Si divergieran, el
      checklist diría "tarjeta lista" mientras la reserva la rechaza.
  L — LA PRUEBA DE LA FUENTE ÚNICA: el paso de dirección está pendiente
      EXACTAMENTE cuando `provider_can_bid` devuelve `no_location`, y deja de
      estarlo a la vez que él. Si un día divergen, el checklist miente.

Todo lo sembrado se borra al final.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_readiness.py
"""

from __future__ import annotations

import asyncio
import math
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.api.deps import async_session_factory  # noqa: E402
from src.core.config import settings  # noqa: E402
from src.main import app  # noqa: E402
from src.models.job import Job  # noqa: E402
from src.models.provider import ProviderProfile  # noqa: E402
from src.models.verification import ConsentType  # noqa: E402
from src.services import auth_service  # noqa: E402
from src.services.legalConsentService import has_valid_signature  # noqa: E402
from src.services.matchingEngine import BID_NO_LOCATION, provider_can_bid  # noqa: E402

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

API = "/api/v1"
_checks = 0


class SmokeError(AssertionError):
    pass


def check(cond: bool, msg: str) -> None:
    global _checks
    _checks += 1
    if not cond:
        raise SmokeError(msg)


def step(n: str, msg: str) -> None:
    print(f"[{n}] {msg}")


def paso(datos: dict, clave: str) -> dict:
    for p in datos["steps"]:
        if p["key"] == clave:
            return p
    raise SmokeError(f"no existe el paso {clave!r} en {[p['key'] for p in datos['steps']]}")


def _firma_sintetica() -> dict:
    trazo = [[20 + i * 2.2, 60 + 22 * math.sin(i / 6.0)] for i in range(120)]
    return {"width": 320, "height": 140, "strokes": [trazo, [[60, 95], [200, 92]]]}


async def _crear_usuario(conn, email: str, *, provider: bool, customer: bool) -> uuid.UUID:
    uid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO users (id, email, password_hash, first_name, last_name,
                              phone, auth_provider, role_customer, role_provider,
                              role_admin, status, email_verified, phone_verified,
                              recovery_code)
           VALUES ($1,$2,$3,$4,$5,$6,'EMAIL',$7,$8,FALSE,'ACTIVE'::user_status,
                   TRUE,FALSE,$9)""",
        uid, email, auth_service.hash_password("SmokeTest123!"),
        "Smoke", "Readiness", "+1416" + str(uid.int)[-7:],
        customer, provider, uuid.uuid4().hex[:12].upper(),
    )
    return uid


async def main() -> int:  # noqa: C901 — un smoke es una lista de comprobaciones
    conn = await asyncpg.connect(_DSN)
    usuarios: list[uuid.UUID] = []
    archivos: list[Path] = []
    prov_id = uuid.uuid4()

    try:
        prov_uid = await _crear_usuario(
            conn, f"smoke-rdy-p-{uuid.uuid4().hex[:8]}@visp.test",
            provider=True, customer=False)
        cust_uid = await _crear_usuario(
            conn, f"smoke-rdy-c-{uuid.uuid4().hex[:8]}@visp.test",
            provider=False, customer=True)
        usuarios += [prov_uid, cust_uid]

        hdr = {"Authorization": f"Bearer {auth_service.create_access_token(prov_uid)[0]}"}
        hdr_c = {"Authorization": f"Bearer {auth_service.create_access_token(cust_uid)[0]}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test",
                               timeout=60.0) as c:

            async def leer(headers=hdr, role="provider") -> dict:
                r = await c.get(f"{API}/users/me/readiness?role={role}", headers=headers)
                check(r.status_code == 200, f"readiness dio {r.status_code}: {r.text[:200]}")
                return r.json()["data"]

            # ---- A: sin token -------------------------------------------
            r = await c.get(f"{API}/users/me/readiness")
            check(r.status_code in (401, 403), f"A: sin token dio {r.status_code}")
            step("A", f"sin token → {r.status_code}")

            # ---- B: proveedor sin perfil --------------------------------
            d = await leer()
            check(len(d["steps"]) == 6, f"B: esperaba 6 pasos, hay {len(d['steps'])}")
            check(d["nextKey"] == "contract", f"B: nextKey {d['nextKey']!r}")
            check(d["allDone"] is False, "B: un proveedor vacío no puede estar listo")
            check(d["blockingCount"] == 5, f"B: {d['blockingCount']} bloqueantes, esperaba 5")
            check(paso(d, "profile")["blocking"] is False,
                  "B: bio y fotos no bloquean nada; son conversión, no puerta")
            step("B", f"proveedor nuevo: {d['doneCount']}/{d['totalCount']}, "
                      f"siguiente={d['nextKey']}, bloqueantes={d['blockingCount']}")

            # Ahora sí, el perfil de proveedor.
            await conn.execute(
                "INSERT INTO provider_profiles (id, user_id) VALUES ($1,$2)",
                prov_id, prov_uid)

            # ---- L (parte 1): el checklist marca la dirección pendiente ---
            d = await leer()
            check(paso(d, "address")["status"] == "action_required",
                  "L: el checklist da la dirección por hecha y no lo está")
            step("L", "sin dirección: checklist pendiente (la puerta se comprueba en L2)")

            # ---- C: el contrato, por el camino real ---------------------
            doc = (await c.get(f"{API}/consents/document/provider_ic_agreement")).json()
            r = await c.post(f"{API}/consents/sign", headers=hdr, json={
                "consent_type": "provider_ic_agreement",
                "signed_full_name": "Smoke Readiness Tester",
                "document_hash": doc["hash"],
                "signature": _firma_sintetica(),
                "device_id": "SMOKE-RDY",
            })
            check(r.status_code in (200, 201), f"C: firmar dio {r.status_code} {r.text[:160]}")
            ruta = await conn.fetchval(
                "SELECT document_path FROM legal_consents WHERE user_id=$1", prov_uid)
            if ruta:
                archivos.append(Path(ruta))

            async with async_session_factory() as s:
                firmado = await has_valid_signature(
                    s, prov_uid, ConsentType.PROVIDER_IC_AGREEMENT)
            check(firmado is True, "C: has_valid_signature no ve la firma recién hecha")

            d = await leer()
            check(paso(d, "contract")["status"] == "done",
                  "C: el contrato está firmado y el checklist dice que no")
            check(d["nextKey"] == "address",
                  f"C: nextKey debería avanzar a address, es {d['nextKey']!r}")
            step("C", "firmado → paso done, siguiente=address (y has_valid_signature de acuerdo)")

            # ---- D: dirección y radio -----------------------------------
            # El radio NO se puede probar a 0: `chk_service_radius` obliga a
            # 0 < radio <= 200 y la columna es NOT NULL con 25 por defecto. O
            # sea que en la práctica el paso 1 es solo las coordenadas — el
            # guardia `radio > 0` se queda porque lo tiene `provider_can_bid`,
            # pero la base ya lo hace imposible.
            await conn.execute(
                "UPDATE provider_profiles SET home_latitude=43.70, home_longitude=-79.40, "
                "service_radius_km=25, home_city='Toronto' WHERE id=$1", prov_id)
            d = await leer()
            a = paso(d, "address")
            check(a["status"] == "done", "D: con coordenadas y radio debería estar hecho")
            check(a["meta"]["city"] == "Toronto" and a["meta"]["radiusKm"] == 25.0,
                  f"D: meta de la dirección {a['meta']}")
            step("D", f"con radio → done ({a['meta']['city']} · {a['meta']['radiusKm']} km)")

            # ---- E/F/G: servicios, precio y el PER_CONTRACT -------------
            tarifables = [r["id"] for r in await conn.fetch(
                "SELECT id FROM service_tasks WHERE is_active AND pricing_unit <> "
                "'PER_CONTRACT'::pricing_unit LIMIT 2")]
            check(len(tarifables) == 2, "E: hacen falta 2 servicios tarifables en el catálogo")
            for tid in tarifables:
                await conn.execute(
                    "INSERT INTO provider_task_qualifications "
                    "(id, provider_id, task_id, qualified, auto_granted, qualified_at, "
                    " created_at, updated_at) VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
                    uuid.uuid4(), prov_id, tid)

            d = await leer()
            check(paso(d, "services")["status"] == "done", "E: 2 servicios y sigue pendiente")
            check(paso(d, "services")["meta"]["count"] == 2,
                  f"E: cuenta {paso(d, 'services')['meta']}")
            r = paso(d, "rates")
            check(r["status"] == "action_required" and r["meta"] == {"withRate": 0, "total": 2},
                  f"E: el precio debería estar 0 de 2, está {r['meta']}")
            step("E", "2 servicios → done; precio 0 de 2")

            # ---- L (parte 2): la puerta real, de acuerdo ----------------
            # Va AQUÍ y no antes porque `provider_can_bid` mira la cualificación
            # antes que la ubicación: sin servicios devuelve `not_qualified` y el
            # control no probaría lo que dice probar.
            job_id = uuid.uuid4()
            await conn.execute(
                """INSERT INTO jobs (id, reference_number, customer_id, task_id,
                                     service_latitude, service_longitude, service_address)
                   VALUES ($1,$2,$3,$4,43.6532,-79.3832,'1 Test St, Toronto')""",
                job_id, f"TSK-RDY{uuid.uuid4().hex[:3].upper()}", cust_uid, tarifables[0])

            async def motivo_puerta() -> str | None:
                async with async_session_factory() as ses:
                    return await provider_can_bid(
                        ses, await ses.get(Job, job_id), await ses.get(ProviderProfile, prov_id))

            check(await motivo_puerta() != BID_NO_LOCATION,
                  "L: el checklist da la dirección por puesta y provider_can_bid dice no_location")
            await conn.execute(
                "UPDATE provider_profiles SET home_latitude=NULL, home_longitude=NULL WHERE id=$1",
                prov_id)
            check(await motivo_puerta() == BID_NO_LOCATION,
                  "L: control — sin coordenadas la puerta tiene que cerrar")
            check(paso(await leer(), "address")["status"] == "action_required",
                  "L: y el checklist tiene que volver a marcarlo pendiente A LA VEZ")
            await conn.execute(
                "UPDATE provider_profiles SET home_latitude=43.70, home_longitude=-79.40 WHERE id=$1",
                prov_id)
            check(await motivo_puerta() != BID_NO_LOCATION, "L: y al reponerlas, abrir otra vez")
            check(paso(await leer(), "address")["status"] == "done",
                  "L: checklist y puerta vuelven juntos")
            step("L", "checklist y provider_can_bid cambian a la vez: una sola fuente")

            unidad = await conn.fetchval(
                "SELECT pricing_unit::text FROM service_tasks WHERE id=$1", tarifables[0])
            await conn.execute(
                "INSERT INTO provider_service_rates (id, provider_id, task_id, unit, "
                " rate_cents, is_active, created_at, updated_at) "
                "VALUES ($1,$2,$3,$4::pricing_unit,4500,TRUE,now(),now())",
                uuid.uuid4(), prov_id, tarifables[0], unidad)
            r = paso(await leer(), "rates")
            check(r["status"] == "action_required" and r["meta"]["withRate"] == 1,
                  f"F: con 1 de 2 tarifas el paso no está hecho, meta={r['meta']}")
            step("F", "1 de 2 con precio → sigue pendiente, y lo dice con el conteo")

            # El PER_CONTRACT no debe engordar el total.
            contrato_tid = await conn.fetchval(
                "SELECT id FROM service_tasks WHERE is_active AND pricing_unit = "
                "'PER_CONTRACT'::pricing_unit LIMIT 1")
            if contrato_tid is not None:
                await conn.execute(
                    "INSERT INTO provider_task_qualifications "
                    "(id, provider_id, task_id, qualified, auto_granted, qualified_at, "
                    " created_at, updated_at) VALUES ($1,$2,$3,TRUE,TRUE,now(),now(),now())",
                    uuid.uuid4(), prov_id, contrato_tid)
                d = await leer()
                check(paso(d, "services")["meta"]["count"] == 3,
                      "G: el PER_CONTRACT sí cuenta como servicio")
                check(paso(d, "rates")["meta"]["total"] == 2,
                      f"G: el PER_CONTRACT NO lleva tarifa, total={paso(d, 'rates')['meta']}")
                step("G", "servicio PER_CONTRACT: cuenta como servicio, no como precio pendiente")
            else:
                step("G", "sin servicios PER_CONTRACT activos en el catálogo — saltado")

            unidad2 = await conn.fetchval(
                "SELECT pricing_unit::text FROM service_tasks WHERE id=$1", tarifables[1])
            await conn.execute(
                "INSERT INTO provider_service_rates (id, provider_id, task_id, unit, "
                " rate_cents, is_active, created_at, updated_at) "
                "VALUES ($1,$2,$3,$4::pricing_unit,5500,TRUE,now(),now())",
                uuid.uuid4(), prov_id, tarifables[1], unidad2)
            check(paso(await leer(), "rates")["status"] == "done",
                  "F: con todas las tarifas el paso debe estar hecho")
            step("F", "las 2 con precio → done")

            # ---- H: los cuatro estados de cobros ------------------------
            p = paso(await leer(), "payouts")
            check(p["status"] == "action_required" and p["meta"]["done"] == 0,
                  f"H: sin cuenta debería ser 0 de 5, es {p['meta']}")

            await conn.execute(
                "UPDATE provider_profiles SET stripe_account_id='acct_smoke', "
                "stripe_onboarding_step='bank' WHERE id=$1", prov_id)
            p = paso(await leer(), "payouts")
            check(p["meta"]["done"] == 2 and p["meta"]["resumeAt"] == "bank",
                  f"H: a medias debería reanudar en bank con 2 hechos, es {p['meta']}")

            await conn.execute(
                "UPDATE provider_profiles SET stripe_onboarding_step='complete' WHERE id=$1",
                prov_id)
            p = paso(await leer(), "payouts")
            check(p["status"] == "in_review",
                  f"H: entregado sin capabilities es revisión de Stripe, no tarea suya ({p['status']})")

            await conn.execute(
                """UPDATE provider_profiles SET stripe_capabilities =
                   '{"card_payments":"active","transfers":"active"}'::jsonb WHERE id=$1""",
                prov_id)
            check(paso(await leer(), "payouts")["status"] == "done",
                  "H: con las capabilities activas el paso está hecho")
            step("H", "cobros: 0 de 5 → reanuda en bank → in_review → done")

            # ---- I/J: perfil y final ------------------------------------
            d = await leer()
            check(paso(d, "profile")["status"] == "action_required", "I: sin bio")
            check(d["allDone"] is False, "J: falta el perfil, no puede estar todo hecho")
            check(d["nextKey"] == "profile",
                  f"J: sin bloqueantes, el siguiente es el recomendado, no {d['nextKey']!r}")

            await conn.execute(
                "UPDATE provider_profiles SET bio='Veinte años arreglando cosas.' WHERE id=$1",
                prov_id)
            d = await leer()
            check(paso(d, "profile")["status"] == "done",
                  "I: con la bio escrita el paso está hecho")
            check(paso(d, "profile")["meta"] == {"hasBio": True},
                  f"I: el paso es SOLO la bio, meta={paso(d, 'profile')['meta']}")
            check(d["allDone"] is True, "J: con todo entregado, el checklist desaparece")
            check(d["nextKey"] is None, f"J: nextKey debería ser None, es {d['nextKey']!r}")
            step("I", "la bio escrita → done (el paso es solo la bio)")
            step("J", f"allDone={d['allDone']}, nextKey={d['nextKey']} → el checklist se va")

            # ---- N: la puerta de la tarjeta -----------------------------
            # El cliente sembrado no tiene `stripe_customer_id`, así que
            # `customer_has_payment_method` devuelve False sin llamar a Stripe.
            tarea = await conn.fetchval(
                "SELECT id FROM service_tasks WHERE is_active ORDER BY id LIMIT 1")
            reserva = {
                "serviceTaskId": str(tarea),
                "locationAddress": "1 Test St, Toronto",
                "locationLat": 43.6532,
                "locationLng": -79.3832,
                "city": "Toronto",
                "provinceState": "ON",
                "postalZip": "M5H 2N2",
                "country": "CA",
            }
            r = await c.post(f"{API}/jobs/book", headers=hdr_c, json=reserva)
            check(r.status_code == 400,
                  f"N: reservar sin tarjeta dio {r.status_code}, esperaba 400 "
                  f"({r.text[:160]})")
            detalle = r.json()["detail"]
            check(isinstance(detalle, dict) and detalle.get("code") == "payment_method_required",
                  f"N: el motivo tiene que venir con código para que la app sepa "
                  f"llevarle a la tarjeta, llegó {detalle!r}")
            step("N", "sin tarjeta no se publica el trabajo → 400 payment_method_required")

            # CONTROL de coherencia: el checklist dice lo mismo, en el mismo
            # instante y por el mismo predicado.
            check(paso(await leer(hdr_c, "customer"), "payment_method")["status"]
                  == "action_required",
                  "N: la reserva rechaza por falta de tarjeta y el checklist la da "
                  "por puesta — hay dos fuentes de verdad")
            step("N", "y el checklist marca el mismo paso pendiente: una sola fuente")

            # ---- K: el cliente ------------------------------------------
            d = await leer(hdr_c, "customer")
            check([p["key"] for p in d["steps"]] ==
                  ["customer_address", "payment_method", "phone"],
                  f"K: pasos del cliente {[p['key'] for p in d['steps']]}")
            check(paso(d, "customer_address")["status"] == "action_required",
                  "K: cliente sin dirección")
            check(paso(d, "phone")["blocking"] is False, "K: el teléfono no bloquea")
            check(paso(d, "phone")["status"] == "done", "K: el usuario sembrado tiene teléfono")
            step("K", f"cliente: {d['doneCount']}/{d['totalCount']}, siguiente={d['nextKey']}")

            await conn.execute(
                "UPDATE users SET default_address_latitude=43.65, "
                "default_address_longitude=-79.38, default_address_city='Toronto' WHERE id=$1",
                cust_uid)
            d = await leer(hdr_c, "customer")
            check(paso(d, "customer_address")["status"] == "done", "K: con dirección, hecho")
            check(d["blockingCount"] == 1, f"K: solo debe faltar la tarjeta ({d['blockingCount']})")
            step("K", "con dirección → solo falta la tarjeta")

            r = await c.get(f"{API}/users/me/readiness?role=provider", headers=hdr_c)
            check(r.status_code == 403, f"K: un cliente puro pidiendo lista de proveedor → {r.status_code}")
            step("K", "cliente pidiendo la lista de proveedor → 403")

        print(f"\nSMOKE PASS — {_checks} comprobaciones")
        return 0

    except SmokeError as exc:
        print(f"\nSMOKE FAIL — {exc}", file=sys.stderr)
        return 1
    finally:
        await conn.execute("DELETE FROM provider_service_rates WHERE provider_id=$1", prov_id)
        await conn.execute("DELETE FROM provider_task_qualifications WHERE provider_id=$1", prov_id)
        await conn.execute("DELETE FROM provider_credentials WHERE provider_id=$1", prov_id)
        for uid in usuarios:
            await conn.execute("DELETE FROM jobs WHERE customer_id=$1", uid)
            await conn.execute("DELETE FROM legal_consents WHERE user_id=$1", uid)
            await conn.execute("DELETE FROM provider_profiles WHERE user_id=$1", uid)
            await conn.execute("DELETE FROM users WHERE id=$1", uid)
        for f in archivos:
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
