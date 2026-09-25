"""Smoke de los comprobantes de trabajo (migración 053).

Plan: docs/plan-facturas.md

  A — Se emiten DOS documentos al capturar: factura del cliente y liquidación
      del proveedor, con números de la serie de VISP.
  B — El PDF existe en disco y su SHA-256 es el que dice la fila. Se comprueba
      el ARCHIVO, no solo la columna.
  C — IDEMPOTENTE: emitir dos veces no crea dos facturas con números distintos
      para el mismo cobro. Es el fallo que deja a un cliente con dos recibos.
  D — Las cifras se congelan en `totals_json`: si luego cambia el trabajo, el
      comprobante ya emitido sigue contando lo que contaba.
  E — CADA PARTE VE SOLO EL SUYO. El cliente recibe la factura; el proveedor,
      la liquidación. Un tercero recibe 404, no 403: un 403 confirmaría que el
      trabajo existe.
  F — Sin comprobante todavía -> 404 con explicación, no un 500.
  G — La línea de impuesto NO aparece si no se cobró impuesto. Hoy los
      proveedores individuales no están registrados fiscalmente.

Todo lo sembrado se borra al final.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_invoices.py
"""

from __future__ import annotations

import asyncio
import hashlib
import sys
import uuid
from pathlib import Path

_RAIZ = Path(__file__).resolve().parent.parent
if str(_RAIZ) not in sys.path:
    sys.path.insert(0, str(_RAIZ))

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.api.deps import async_session_factory  # noqa: E402
from src.core.config import settings  # noqa: E402
from src.main import app  # noqa: E402
from src.models.job import Job  # noqa: E402
from src.services import auth_service, invoiceService  # noqa: E402

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


async def _usuario(conn, email: str, *, provider: bool) -> uuid.UUID:
    uid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO users (id, email, password_hash, first_name, last_name, phone,
                              auth_provider, role_customer, role_provider, role_admin,
                              status, email_verified, phone_verified, recovery_code,
                              default_address_street, default_address_city,
                              default_address_province, default_address_postal_code)
           VALUES ($1,$2,$3,$4,$5,$6,'EMAIL',$7,$8,FALSE,'ACTIVE'::user_status,
                   TRUE,FALSE,$9,'12 Lakeshore Rd','Burlington','ON','L7T 1A1')""",
        uid, email, auth_service.hash_password("SmokeTest123!"),
        "Smoke", "Invoice", "+1416" + str(uid.int)[-7:],
        not provider, provider, uuid.uuid4().hex[:12].upper(),
    )
    return uid


async def main() -> int:  # noqa: C901
    conn = await asyncpg.connect(_DSN)
    usuarios: list[uuid.UUID] = []
    prov_id = uuid.uuid4()
    job_id = uuid.uuid4()
    ficheros: list[Path] = []

    try:
        cust = await _usuario(conn, f"smoke-inv-c-{uuid.uuid4().hex[:8]}@visp.test", provider=False)
        prov = await _usuario(conn, f"smoke-inv-p-{uuid.uuid4().hex[:8]}@visp.test", provider=True)
        otro = await _usuario(conn, f"smoke-inv-x-{uuid.uuid4().hex[:8]}@visp.test", provider=False)
        usuarios += [cust, prov, otro]

        await conn.execute(
            "INSERT INTO provider_profiles (id, user_id, home_city, home_province_state) "
            "VALUES ($1,$2,'Burlington','ON')", prov_id, prov)

        task_id = await conn.fetchval(
            "SELECT id FROM service_tasks WHERE is_active ORDER BY id LIMIT 1")
        await conn.execute(
            """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                                 service_latitude, service_longitude, service_address,
                                 requested_date, quantity, hourly_rate_cents,
                                 total_charged_cents, actual_total_cents,
                                 materials_spent_cents, tip_cents, service_fee_cents,
                                 service_tax_cents, commission_amount_cents,
                                 provider_payout_cents, currency)
               VALUES ($1,$2,$3,$4,'COMPLETED'::job_status,43.32,-79.80,'12 Lakeshore Rd',
                       CURRENT_DATE,3.0,4500,19583,19583,1840,1500,490,0,2025,18155,'CAD')""",
            job_id, f"TSK-INV{uuid.uuid4().hex[:3].upper()}", cust, task_id)
        await conn.execute(
            """INSERT INTO job_assignments (id, job_id, provider_id, status,
                                            offered_at, responded_at, created_at, updated_at)
               VALUES ($1,$2,$3,'ACCEPTED'::assignment_status,now(),now(),now(),now())""",
            uuid.uuid4(), job_id, prov_id)

        # ---- A: se emiten los dos -----------------------------------------
        async with async_session_factory() as s:
            job = await s.get(Job, job_id)
            emitidos = await invoiceService.emitir_comprobantes(s, job)
            await s.commit()
        check(len(emitidos) == 2, f"A: se esperaban 2 documentos, salieron {len(emitidos)}")
        tipos = {e["kind"] for e in emitidos}
        check(tipos == {"customer", "provider"}, f"A: tipos {tipos}")
        filas = await conn.fetch(
            "SELECT kind, number, document_path, document_hash, totals_json FROM job_invoices WHERE job_id=$1",
            job_id)
        nums = {r["kind"]: r["number"] for r in filas}
        check(nums["customer"].startswith("VISP-"), f"A: número raro {nums['customer']}")
        check(nums["provider"] == nums["customer"] + "-P",
              f"A: el del proveedor debe ser el mismo con -P ({nums})")
        step("A", f"dos documentos: {nums['customer']} y {nums['provider']}")

        # ---- B: el fichero existe y el hash cuadra --------------------------
        for r in filas:
            ruta = _RAIZ / r["document_path"]
            ficheros.append(ruta)
            check(ruta.is_file(), f"B: no existe el PDF {ruta}")
            real = hashlib.sha256(ruta.read_bytes()).hexdigest()
            check(real == r["document_hash"],
                  f"B: el hash de {r['kind']} no corresponde al fichero")
            check(ruta.read_bytes()[:4] == b"%PDF", f"B: {r['kind']} no es un PDF")
            check(ruta.stat().st_size < 120_000,
                  f"B: {r['kind']} pesa {ruta.stat().st_size} — ¿se coló una imagen?")
        step("B", f"los 2 PDF en disco, hash correcto, "
                  f"{filas[0]['document_path'].split('/')[-1][:12]}… "
                  f"({ficheros[0].stat().st_size // 1024} KB)")

        # ---- C: idempotente -------------------------------------------------
        async with async_session_factory() as s:
            job = await s.get(Job, job_id)
            otra_vez = await invoiceService.emitir_comprobantes(s, job)
            await s.commit()
        total = await conn.fetchval("SELECT count(*) FROM job_invoices WHERE job_id=$1", job_id)
        check(total == 2, f"C: emitir dos veces creó {total} documentos; deben seguir 2")
        check({e["number"] for e in otra_vez} == set(nums.values()),
              "C: la segunda emisión devolvió números distintos")
        step("C", "emitir dos veces no duplica: mismos números")

        # ---- D: cifras congeladas -------------------------------------------
        import json
        t = json.loads([r for r in filas if r["kind"] == "customer"][0]["totals_json"])
        check(t["total_cents"] == 19583, f"D: total congelado {t['total_cents']}")
        check(t["materials_cents"] == 1840 and t["tip_cents"] == 1500,
              f"D: materiales/propina {t}")
        check(t["provider_net_cents"] == 18155, f"D: neto del proveedor {t}")
        step("D", f"cifras congeladas en totals_json (total {t['total_cents']}c)")

        # ---- E/F/G: la ruta ---------------------------------------------------
        transporte = ASGITransport(app=app)
        async with AsyncClient(transport=transporte, base_url="http://t", timeout=60) as c:
            h = lambda u: {"Authorization": f"Bearer {auth_service.create_access_token(u)[0]}"}
            tk = lambda u: auth_service.create_access_token(u)[0]

            r = await c.get(f"{API}/jobs/{job_id}/invoice?t={tk(cust)}")
            check(r.status_code == 200, f"E: el cliente no recibe su factura ({r.status_code})")
            check(r.headers["content-type"] == "application/pdf", "E: no es un PDF")
            check(nums["customer"] in r.headers.get("content-disposition", ""),
                  "E: el fichero debería llamarse como el número de factura")
            pdf_cliente = r.content
            step("E", f"el cliente recibe {nums['customer']}.pdf ({len(pdf_cliente)//1024} KB)")

            r = await c.get(f"{API}/jobs/{job_id}/invoice?t={tk(prov)}")
            check(r.status_code == 200, f"E: el proveedor no recibe su liquidación ({r.status_code})")
            check(r.content != pdf_cliente, "E: le están dando el MISMO documento a los dos")
            step("E", f"el proveedor recibe {nums['provider']}.pdf, distinto del anterior")

            r = await c.get(f"{API}/jobs/{job_id}/invoice?t={tk(otro)}")
            check(r.status_code == 404,
                  f"E: un tercero recibió {r.status_code}; debe ser 404, no 403")
            step("E", "un tercero → 404 (un 403 confirmaría que el trabajo existe)")

            r = await c.get(f"{API}/jobs/{job_id}/invoice?t=basura")
            check(r.status_code == 401, f"E: token inválido → {r.status_code}, esperaba 401")

            # Y la ruta autenticada que fabrica la URL para el navegador.
            r = await c.post(f"{API}/jobs/{job_id}/invoice-url", headers=h(cust))
            check(r.status_code == 200, f"E: invoice-url → {r.status_code}")
            url = r.json()["data"]["url"]
            check(f"/jobs/{job_id}/invoice?t=" in url, f"E: URL rara {url[:80]}")
            r2 = await c.get(url.replace("http://t", ""))
            check(r2.status_code == 200 and r2.content[:4] == b"%PDF",
                  "E: la URL fabricada no devuelve el PDF")
            step("E", "invoice-url devuelve una URL que abre el PDF en el navegador")

            vacio = uuid.uuid4()
            await conn.execute(
                """INSERT INTO jobs (id, reference_number, customer_id, task_id,
                                     service_latitude, service_longitude, service_address)
                   VALUES ($1,$2,$3,$4,43.32,-79.80,'x')""",
                vacio, f"TSK-NOI{uuid.uuid4().hex[:3].upper()}", cust, task_id)
            r = await c.get(f"{API}/jobs/{vacio}/invoice?t={tk(cust)}")
            check(r.status_code == 404, f"F: trabajo sin comprobante → {r.status_code}")
            check("captured" in r.json()["detail"],
                  "F: el 404 debe explicar que se emite al capturar el cobro")
            await conn.execute("DELETE FROM jobs WHERE id=$1", vacio)
            step("F", "sin comprobante → 404 explicando cuándo se emite")

        # ---- G: sin impuesto, sin línea de impuesto --------------------------
        texto = pdf_cliente.decode("latin-1", errors="ignore")
        check("GST/HST No." not in texto,
              "G: aparece un número fiscal y este proveedor no está registrado")
        step("G", "sin impuesto cobrado → el PDF no lleva línea de impuesto")

        print(f"\nSMOKE PASS — {_checks} comprobaciones")
        return 0

    except SmokeError as exc:
        print(f"\nSMOKE FAIL — {exc}", file=sys.stderr)
        return 1
    finally:
        await conn.execute("DELETE FROM job_invoices WHERE job_id=$1", job_id)
        await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
        await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)
        await conn.execute("DELETE FROM provider_profiles WHERE id=$1", prov_id)
        for u in usuarios:
            await conn.execute("DELETE FROM jobs WHERE customer_id=$1", u)
            await conn.execute("DELETE FROM users WHERE id=$1", u)
        for f in ficheros:
            try:
                f.unlink(missing_ok=True)
            except OSError:
                pass
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
