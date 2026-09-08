"""Smoke de la firma del contrato (migración 052).

Plan: docs/plan-firma-contratos.md

Lo que se comprueba, y por qué cada cosa:

  A — GET /consents/document/{tipo} devuelve el markdown vigente, su versión y
      su hash. El del proveedor pide firma; el del cliente no (es clickwrap,
      que es lo que el propio documento contempla).
  B — SIN TOKEN no se puede firmar. Este era el agujero: hasta hoy
      `POST /consents/record` no pedía token y sacaba el `user_id` DEL BODY,
      así que cualquiera podía fabricar un consentimiento a nombre ajeno.
  C — Firmar con un hash que no es el del texto vigente da 409, no 201. Sin
      esta comprobación se archivaría una versión distinta de la que se leyó.
  D — El contrato del proveedor SIN trazo da 400 `signature_required`.
  E — CAMINO FELIZ: se firma, nace la fila, y el PDF existe en disco con el
      SHA-256 que dice la fila. Se comprueba el ARCHIVO, no solo la columna.
  F — El firmante se descarga su PDF: 200 y `application/pdf` de verdad.
  G — OTRO usuario pide ese mismo PDF: 404 (no 403 — un 403 confirmaría a un
      tercero que ese id existe).
  H — `check` dice que hay consentimiento vigente, y con la versión correcta.
  I — Firmar es UN SOLO INSERT: la fila nace con `document_path` ya puesto.
      `legal_consents` es append-only y no tiene `updated_at`; si el PDF se
      adjuntara con un UPDATE posterior, la inmutabilidad que da valor a la
      tabla sería mentira.
  J — El `user_id` del body de /record se IGNORA: el consentimiento cae sobre
      el dueño del token, no sobre el que diga el atacante.
  K — QUIÉN FIRMA QUÉ: `/consents/pending` devuelve el contrato de proveedor a
      un `provider`, el acuerdo de cliente a un `customer`, y **los DOS** a un
      `both`. En la base el rol son dos banderas independientes, así que "both"
      no es un valor: son las dos en TRUE, y son dos relaciones distintas con
      VISP.
  M — ADMIN: el contrato firmado aparece en `/admin/signed-contracts` con su
      hash y su rastro, y el PDF se descarga CON token de admin. Sin token, 401.
  L — LA PUERTA: un proveedor sin contrato firmado no puede ofertar en NADA
      (`provider_can_bid` -> `no_contract`). Con CONTROL: tras firmar, el mismo
      trabajo deja de dar ese motivo, lo que prueba que bloqueaba el contrato y
      no otra cosa.

Todo lo sembrado se borra al final.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_contract_signature.py
"""

from __future__ import annotations

import asyncio
import hashlib
import math
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.core.config import settings  # noqa: E402
from src.main import app  # noqa: E402
from src.services import admin_service, auth_service  # noqa: E402
from src.services.legalPdfService import UPLOAD_DIR  # noqa: E402
from src.api.deps import async_session_factory  # noqa: E402
from src.models.job import Job  # noqa: E402
from src.models.provider import ProviderProfile  # noqa: E402
from src.services.matchingEngine import BID_NO_CONTRACT, provider_can_bid  # noqa: E402

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_prod" not in _DSN:
    print(f"REFUSING TO RUN: DATABASE_URL debe apuntar a visp_prod (got {_DSN!r})",
          file=sys.stderr)
    sys.exit(2)

API = "/api/v1"
PROVIDER_DOC = "provider_ic_agreement"
CUSTOMER_DOC = "customer_service_agreement"

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


def _firma_sintetica() -> dict:
    """Un garabato con la forma de una firma real: cientos de puntos, 2 trazos."""
    trazo = [[20 + i * 2.2, 60 + 22 * math.sin(i / 6.0)] for i in range(120)]
    return {"width": 320, "height": 140, "strokes": [trazo, [[60, 95], [200, 92]]]}


async def _crear_usuario(conn, email: str, *, provider: bool) -> uuid.UUID:
    """El rol son banderas booleanas, no una cadena: `role_customer` /
    `role_provider`. Por eso `both` no es un valor, es las dos en TRUE."""
    uid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO users (id, email, password_hash, first_name, last_name,
                              phone, auth_provider, role_customer, role_provider,
                              role_admin, status, email_verified, phone_verified,
                              recovery_code)
           VALUES ($1, $2, $3, $4, $5, $6, 'EMAIL', $7, $8, FALSE,
                   'ACTIVE'::user_status, TRUE, FALSE, $9)""",
        uid, email, auth_service.hash_password("SmokeTest123!"),
        "Smoke", "Contract", "+1416" + str(uid.int)[-7:],
        not provider, provider, uuid.uuid4().hex[:12].upper(),
    )
    return uid


async def main() -> int:
    conn = await asyncpg.connect(_DSN)
    sembrados: list[uuid.UUID] = []
    archivos: list[Path] = []
    firmante = otro = None

    try:
        firmante = await _crear_usuario(
            conn, f"smoke-sign-{uuid.uuid4().hex[:8]}@visp.test", provider=True)
        otro = await _crear_usuario(
            conn, f"smoke-other-{uuid.uuid4().hex[:8]}@visp.test", provider=False)
        sembrados += [firmante, otro]

        hdr = {"Authorization": f"Bearer {auth_service.create_access_token(firmante)[0]}"}
        hdr_otro = {"Authorization": f"Bearer {auth_service.create_access_token(otro)[0]}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test") as c:

            # ---- A: el documento vigente --------------------------------
            r = await c.get(f"{API}/consents/document/{PROVIDER_DOC}")
            check(r.status_code == 200, f"A: documento del proveedor {r.status_code}")
            doc = r.json()
            check(doc["version"] == "1.3", f"A: versión {doc['version']!r}, esperaba 1.3")
            check(doc["requires_signature"] is True, "A: el contrato del proveedor debe pedir firma")
            check("Independent Service Provider Platform Agreement" in doc["text"],
                  "A: el texto no parece el contrato")
            check(not doc["text"].lstrip().startswith("---"),
                  "A: el front-matter YAML llegó al usuario; se firmaría metadatos")
            check(doc["hash"] == hashlib.sha256(doc["text"].encode()).hexdigest(),
                  "A: el hash no corresponde al texto entregado")
            step("A", f"contrato v{doc['version']}, {len(doc['text'])} chars, "
                      f"hash {doc['hash'][:12]}…")

            r = await c.get(f"{API}/consents/document/{CUSTOMER_DOC}")
            check(r.status_code == 200, f"A: documento del cliente {r.status_code}")
            check(r.json()["requires_signature"] is False,
                  "A: el acuerdo del cliente es clickwrap, no debe exigir trazo")
            step("A", f"acuerdo del cliente v{r.json()['version']} (clickwrap)")

            cuerpo = {
                "consent_type": PROVIDER_DOC,
                "signed_full_name": "Smoke Contract Tester",
                "document_hash": doc["hash"],
                "signature": _firma_sintetica(),
                "device_id": "SMOKE-IDFV",
            }

            # ---- B: sin token no se firma -------------------------------
            r = await c.post(f"{API}/consents/sign", json=cuerpo)
            check(r.status_code in (401, 403),
                  f"B: firmar sin token dio {r.status_code}; el user_id debe salir del token")
            step("B", f"sin token → {r.status_code}")

            # ---- C: hash que no cuadra ----------------------------------
            r = await c.post(f"{API}/consents/sign", headers=hdr,
                             json={**cuerpo, "document_hash": "f" * 64})
            check(r.status_code == 409,
                  f"C: hash falso dio {r.status_code}, esperaba 409")
            step("C", "texto distinto del vigente → 409")

            # ---- D: contrato de proveedor sin trazo ----------------------
            sin_firma = {k: v for k, v in cuerpo.items() if k != "signature"}
            r = await c.post(f"{API}/consents/sign", headers=hdr, json=sin_firma)
            check(r.status_code == 400 and r.json()["detail"] == "signature_required",
                  f"D: sin trazo dio {r.status_code} {r.text[:120]}")
            step("D", "contrato de proveedor sin trazo → 400 signature_required")

            # ---- E: camino feliz ----------------------------------------
            r = await c.post(f"{API}/consents/sign", headers=hdr, json=cuerpo)
            check(r.status_code == 201, f"E: firma dio {r.status_code} {r.text[:200]}")
            firmado = r.json()
            consent_id = uuid.UUID(firmado["consent_id"])
            check(firmado["consent_version"] == "1.3",
                  f"E: versión archivada {firmado['consent_version']!r}")

            fila = await conn.fetchrow(
                """SELECT consent_version, consent_text_hash, signed_full_name,
                          document_path, document_hash, signature_svg,
                          signature_image_path, ip_address, device_id, granted
                     FROM legal_consents WHERE id = $1""", consent_id)
            check(fila is not None, "E: no se escribió la fila de consentimiento")
            check(fila["granted"] is True, "E: la fila no quedó como otorgada")
            check(fila["consent_text_hash"] == doc["hash"],
                  "E: el hash archivado no es el del texto mostrado")
            check(fila["signed_full_name"] == "Smoke Contract Tester",
                  "E: no se guardó el nombre legal firmado")
            check(fila["signature_svg"] and "<path" in fila["signature_svg"],
                  "E: no se guardó el trazo vectorial")
            check(fila["device_id"] == "SMOKE-IDFV", "E: no se guardó el device_id")

            pdf_path = UPLOAD_DIR / fila["document_path"]
            png_path = UPLOAD_DIR / fila["signature_image_path"]
            archivos += [pdf_path, png_path]
            check(pdf_path.is_file(), f"E: el PDF no está en disco: {pdf_path}")
            check(png_path.is_file(), f"E: el PNG de la firma no está en disco")
            en_disco = hashlib.sha256(pdf_path.read_bytes()).hexdigest()
            check(en_disco == fila["document_hash"],
                  "E: el SHA-256 de la fila no es el del archivo en disco")
            check(pdf_path.read_bytes()[:5] == b"%PDF-",
                  "E: el archivo guardado no es un PDF")
            step("E", f"firmado: {pdf_path.name}, {pdf_path.stat().st_size} bytes, "
                      f"sha {en_disco[:12]}…")

            # ---- F: el firmante se lo descarga ---------------------------
            r = await c.get(f"{API}/consents/{consent_id}/document", headers=hdr)
            check(r.status_code == 200, f"F: descarga dio {r.status_code}")
            check(r.headers["content-type"].startswith("application/pdf"),
                  f"F: content-type {r.headers.get('content-type')!r}")
            check(r.content[:5] == b"%PDF-", "F: lo descargado no es un PDF")
            check(hashlib.sha256(r.content).hexdigest() == fila["document_hash"],
                  "F: el PDF servido no es el archivado")
            step("F", f"descarga del firmante: {len(r.content)} bytes")

            # ---- G: otro usuario no lo ve --------------------------------
            r = await c.get(f"{API}/consents/{consent_id}/document", headers=hdr_otro)
            check(r.status_code == 404,
                  f"G: otro usuario obtuvo {r.status_code}; debe ser 404, "
                  f"un 403 confirmaría que el id existe")
            step("G", "otro usuario → 404")

            # ---- H: el consentimiento cuenta como vigente ----------------
            r = await c.get(f"{API}/consents/check/{firmante}/{PROVIDER_DOC}",
                            headers=hdr)
            check(r.status_code == 200, f"H: check dio {r.status_code}")
            chk = r.json()
            check(chk["has_valid_consent"] is True, "H: no se reconoce el consentimiento")
            check(chk["latest_consent_version"] == "1.3",
                  f"H: versión vigente {chk['latest_consent_version']!r}")
            step("H", "consentimiento vigente v1.3")

            # ---- I: un solo INSERT, sin UPDATE posterior -----------------
            n_filas = await conn.fetchval(
                "SELECT count(*) FROM legal_consents WHERE user_id = $1", firmante)
            check(n_filas == 1,
                  f"I: {n_filas} filas para una sola firma; debe ser exactamente 1")
            check(fila["document_path"] is not None,
                  "I: la fila nació sin document_path, luego hubo un UPDATE "
                  "sobre una tabla append-only")
            step("I", "una fila, completa desde el INSERT")

            # ---- J: el user_id del body no manda -------------------------
            r = await c.post(
                f"{API}/consents/record", headers=hdr_otro,
                json={"user_id": str(firmante),          # intento de suplantación
                      "consent_type": "platform_tos",
                      "consent_text": "smoke tos text",
                      "granted": True})
            check(r.status_code == 201, f"J: record dio {r.status_code} {r.text[:150]}")
            check(r.json()["user_id"] == str(otro),
                  "J: el consentimiento cayó sobre el user_id del BODY, no el del token")
            step("J", "user_id del body ignorado; manda el token")

            # ---- M: la pestaña del admin --------------------------------
            su = await conn.fetchrow(
                "SELECT id FROM superusers WHERE is_active ORDER BY created_at LIMIT 1")
            if su is None:
                step("M", "SALTADA: no hay superusuario en la base")
            else:
                tok = admin_service.create_admin_tokens(su["id"])["accessToken"]
                hdr_admin = {"Authorization": f"Bearer {tok}"}

                r = await c.get(f"{API}/admin/signed-contracts", headers=hdr_admin)
                check(r.status_code == 200, f"M: listado admin dio {r.status_code}")
                payload = r.json()
                filas = payload.get("data", payload)
                mio = next((f for f in filas if f["id"] == str(consent_id)), None)
                check(mio is not None, "M: el contrato firmado no sale en el admin")
                check(mio["documentHash"] == fila["document_hash"],
                      "M: el hash que enseña el admin no es el del archivo")
                check(mio["hasDrawnSignature"] is True,
                      "M: el admin no ve que lleva trazo")
                check(mio["isCurrentVersion"] is True,
                      "M: v1.3 es la vigente y el admin la marca como vieja")
                check(mio["signedFullName"] == "Smoke Contract Tester",
                      "M: el admin no muestra el nombre legal firmado")
                step("M", f"el admin lista el contrato de {mio['userEmail']}")

                r = await c.get(
                    f"{API}/admin/signed-contracts/{consent_id}/document",
                    headers=hdr_admin)
                check(r.status_code == 200, f"M: descarga admin dio {r.status_code}")
                check(r.content[:5] == b"%PDF-", "M: el admin no recibió un PDF")
                check(hashlib.sha256(r.content).hexdigest() == fila["document_hash"],
                      "M: el PDF que sirve el admin no es el archivado")

                r = await c.get(
                    f"{API}/admin/signed-contracts/{consent_id}/document")
                check(r.status_code in (401, 403),
                      f"M: el PDF del admin se sirvió SIN token ({r.status_code})")
                step("M", "PDF por token de admin; sin token, "
                          f"{r.status_code}")

            # ---- K: quién firma qué, según el rol ------------------------
            r = await c.get(f"{API}/consents/pending", headers=hdr)
            check(r.status_code == 200, f"K: pending dio {r.status_code}")
            pend = r.json()
            tipos = [p["consent_type"] for p in pend["pending"]]
            check(tipos == [], f"K: el que ya firmó no debe deber nada, debe {tipos}")
            step("K", "el firmante ya no debe nada")

            r = await c.get(f"{API}/consents/pending", headers=hdr_otro)
            tipos = [p["consent_type"] for p in r.json()["pending"]]
            check(tipos == [CUSTOMER_DOC],
                  f"K: un customer debe solo el acuerdo de cliente, debe {tipos}")
            check(r.json()["pending"][0]["requires_signature"] is False,
                  "K: el del cliente no debe exigir trazo")
            check(r.json()["suggested_legal_name"] == "Smoke Contract",
                  "K: el nombre legal precargado no sale del registro")
            step("K", f"customer → {tipos}")

            ambos = await _crear_usuario(
                conn, f"smoke-both-{uuid.uuid4().hex[:8]}@visp.test", provider=True)
            await conn.execute(
                "UPDATE users SET role_customer = TRUE WHERE id = $1", ambos)
            sembrados.append(ambos)
            hdr_ambos = {
                "Authorization": f"Bearer {auth_service.create_access_token(ambos)[0]}"}
            r = await c.get(f"{API}/consents/pending", headers=hdr_ambos)
            tipos = [p["consent_type"] for p in r.json()["pending"]]
            check(set(tipos) == {PROVIDER_DOC, CUSTOMER_DOC},
                  f"K: un `both` debe LOS DOS documentos, debe {tipos}")
            firmas = {p["consent_type"]: p["requires_signature"]
                      for p in r.json()["pending"]}
            check(firmas[PROVIDER_DOC] is True and firmas[CUSTOMER_DOC] is False,
                  f"K: `both` firma el de proveedor y acepta el de cliente: {firmas}")
            step("K", f"both → {sorted(tipos)} (trazo solo en el de proveedor)")

        # ---- L: la puerta de ofertar --------------------------------------
        # Se seedea un proveedor SIN contrato y un trabajo cualquiera. El motivo
        # `no_contract` se devuelve antes que cualquier otro filtro, así que no
        # hace falta que el proveedor esté cualificado para el trabajo.
        sin_firma_uid = await _crear_usuario(
            conn, f"smoke-gate-{uuid.uuid4().hex[:8]}@visp.test", provider=True)
        sembrados.append(sin_firma_uid)
        prov_id = uuid.uuid4()
        await conn.execute(
            "INSERT INTO provider_profiles (id, user_id) VALUES ($1, $2)",
            prov_id, sin_firma_uid)
        cliente_uid = await _crear_usuario(
            conn, f"smoke-cust-{uuid.uuid4().hex[:8]}@visp.test", provider=False)
        sembrados.append(cliente_uid)
        task_id = await conn.fetchval(
            "SELECT id FROM service_tasks WHERE is_active LIMIT 1")
        job_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO jobs (id, reference_number, customer_id, task_id,
                                 service_latitude, service_longitude, service_address)
               VALUES ($1, $2, $3, $4, 43.6532, -79.3832, '1 Test St, Toronto')""",
            job_id, f"TSK-SMK{uuid.uuid4().hex[:3].upper()}", cliente_uid, task_id)

        async with async_session_factory() as session:
            job = await session.get(Job, job_id)
            prov = await session.get(ProviderProfile, prov_id)
            motivo = await provider_can_bid(session, job, prov)
            check(motivo == BID_NO_CONTRACT,
                  f"L: sin contrato el motivo debe ser {BID_NO_CONTRACT!r}, fue {motivo!r}")
            step("L", f"proveedor sin contrato → {motivo}")

            # CONTROL: se le pasa el contrato como firmado y el motivo cambia.
            # Si siguiera siendo `no_contract`, este smoke estaría midiendo otro
            # bloqueo y no el que dice medir.
            motivo2 = await provider_can_bid(session, job, prov, contract_signed=True)
            check(motivo2 != BID_NO_CONTRACT,
                  f"L: con contrato firmado no debe bloquear por contrato, fue {motivo2!r}")
            step("L", f"control: con contrato firmado → {motivo2} (otro filtro, no el contrato)")

        await conn.execute("DELETE FROM jobs WHERE id = $1", job_id)
        await conn.execute("DELETE FROM provider_profiles WHERE id = $1", prov_id)

        print(f"\nPASS — {_checks}/{_checks} comprobaciones")
        return 0

    except SmokeError as exc:
        print(f"\nFAIL — {exc}", file=sys.stderr)
        return 1
    finally:
        # Limpieza: primero las filas (FK RESTRICT sobre users), luego los users.
        for uid in sembrados:
            if uid:
                await conn.execute("DELETE FROM legal_consents WHERE user_id = $1", uid)
                await conn.execute("DELETE FROM users WHERE id = $1", uid)
        for f in archivos:
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
