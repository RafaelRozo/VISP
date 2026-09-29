"""Smoke del borrado de cuenta. Plan: docs/plan-borrar-cuenta.md

SOLO contra `visp_demo` y con claves de TEST de Stripe: crea retenciones reales
en Stripe test para comprobar que se liberan. Se niega a correr si no.

    cd visp-tasker/backend
    DATABASE_URL=postgresql+asyncpg://…/visp_demo STRIPE_SECRET_KEY=sk_test_… \\
        ./venv/bin/python scripts/smoke_account_deletion.py

Lo que se comprueba:

  A — Sin token, 401/403.
  B — CLIENTE con un trabajo agendado a 5 min: bloquea (JOB_STARTS_SOON) y el
      POST da 409. CONTROL: el mismo trabajo a 2 h ya no bloquea. Es la regla de
      los 15 min, probada por los dos lados.
  C — Contraseña equivocada: 403 y la cuenta sigue viva.
  D — El borrado del cliente: el agendado y la solicitud sin proveedor se
      cancelan con motivo ACCOUNT_DELETED, la RETENCIÓN REAL de Stripe queda
      `canceled`, la oferta pendiente del proveedor caduca y el proveedor
      recibe su aviso. Queda el registro con IP.
  E — Las sesiones mueren (401 con el token de antes), el login explica que la
      cuenta se borró, y el registro con el mismo email también.
  F — Restaurar dentro del plazo: vuelve a entrar. Y se borra otra vez.
  G — PROVEEDOR: bloquea con un trabajo en curso, con un cobro sin capturar y
      con saldo Stripe > 0 (sustituido). Sin ellos, su trabajo agendado VUELVE
      AL MATCHING: PENDING_MATCH, sin oferta aceptada, oferta WITHDRAWN,
      asignación CANCELLED, retención real `canceled`, ventana de ofertas nueva
      y aviso al cliente. Sus ofertas en otros trabajos, retiradas.
  H — El matching lo excluye: `provider_can_bid` da `account_inactive`, y
      antes del borrado no (CONTROL).
  I — La purga: anonimiza, borra el customer de Stripe test, los archivos y los
      documentos; CONSERVA trabajos y consentimientos.
  J — El email queda libre: se puede registrar de nuevo.

Todo lo sembrado se borra al final.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from datetime import date, datetime, timedelta, timezone
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
import stripe  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.core.config import settings  # noqa: E402

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_demo" not in _DSN or not settings.stripe_secret_key.startswith("sk_test_"):
    print("REFUSING TO RUN: hace falta DATABASE_URL a visp_demo y STRIPE_SECRET_KEY sk_test_",
          file=sys.stderr)
    sys.exit(2)

from src.api.deps import async_session_factory  # noqa: E402
from src.main import app  # noqa: E402
from src.services import account_deletion_service as svc  # noqa: E402
from src.services import auth_service, jobSchedule  # noqa: E402

stripe.api_key = settings.stripe_secret_key

API = "/api/v1"
PASSWORD = "SmokeDelete123!"
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


def _local(dt: datetime) -> tuple[date, object]:
    """UTC -> (fecha, hora) locales del área, que es como `jobs` guarda la cita."""
    loc = dt.astimezone(jobSchedule.SERVICE_TIMEZONE)
    return loc.date(), loc.time().replace(microsecond=0)


def _hold_real() -> str:
    """Una retención de verdad en Stripe test, en `requires_capture`."""
    pi = stripe.PaymentIntent.create(
        amount=2500, currency="cad", capture_method="manual", confirm=True,
        payment_method="pm_card_visa", payment_method_types=["card"],
        description="smoke_account_deletion",
    )
    assert pi.status == "requires_capture", pi.status
    return pi.id


async def _usuario(conn, tag: str, *, provider: bool) -> tuple[uuid.UUID, str]:
    uid = uuid.uuid4()
    email = f"smoke-del-{tag}-{uuid.uuid4().hex[:8]}@visp.test"
    await conn.execute(
        """INSERT INTO users (id, email, password_hash, first_name, last_name, phone,
                              auth_provider, role_customer, role_provider, role_admin,
                              status, email_verified, phone_verified, recovery_code)
           VALUES ($1,$2,$3,'Smoke',$4,$5,'EMAIL',TRUE,$6,FALSE,'ACTIVE'::user_status,
                   TRUE,FALSE,$7)""",
        uid, email, auth_service.hash_password(PASSWORD), tag,
        "+1416" + str(uid.int)[-7:], provider, uuid.uuid4().hex[:12].upper(),
    )
    return uid, email


async def _job(conn, customer_id, task_id, *, estado: str, cuando: datetime | None,
               pi: str | None = None, completed_at=None) -> uuid.UUID:
    jid = uuid.uuid4()
    fecha, hora = _local(cuando) if cuando else (None, None)
    await conn.execute(
        """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                             service_latitude, service_longitude, service_address,
                             service_province_state, requested_date, requested_time_start,
                             stripe_payment_intent_id, authorized_amount_cents,
                             authorized_at, total_charged_cents, completed_at,
                             offers_close_at, commission_rate)
           VALUES ($1,$2,$3,$4,$5::job_status,43.65,-79.38,'1 Smoke St','ON',$6,$7,
                   $8,$9,$10,2000,$11, now() + interval '40 hours', 0.15)""",
        jid, f"DEL-{jid.hex[:8].upper()}", customer_id, task_id, estado, fecha, hora,
        pi, 2500 if pi else None, datetime.now(timezone.utc) if pi else None, completed_at,
    )
    return jid


async def _oferta(conn, job_id, prov_id, status: str) -> uuid.UUID:
    oid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO job_offers (id, job_id, provider_id, unit, rate_cents, magnitude,
                                   magnitude_source, subtotal_cents, total_cents, status)
           VALUES ($1,$2,$3,'FLAT_PACKAGE',2000,1,'FLAT',2000,2000,$4)""",
        oid, job_id, prov_id, status)
    return oid


async def _asignar(conn, job_id, prov_id, status="ACCEPTED") -> None:
    await conn.execute(
        """INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, responded_at)
           VALUES ($1,$2,$3,$4::assignment_status,now(),now())""",
        uuid.uuid4(), job_id, prov_id, status)


async def main() -> int:  # noqa: C901 — un smoke es una lista de comprobaciones
    conn = await asyncpg.connect(_DSN)
    check(await conn.fetchval("SELECT current_database()") == "visp_demo", "BD equivocada")
    usuarios: list[uuid.UUID] = []
    perfiles: list[uuid.UUID] = []
    archivos: list[Path] = []
    stripe_customers: list[str] = []
    original_balance = svc.stripe_pending_balance

    task_id = await conn.fetchval(
        "SELECT id FROM service_tasks WHERE is_active ORDER BY created_at LIMIT 1")
    now = datetime.now(timezone.utc)

    try:
        cust_uid, cust_email = await _usuario(conn, "c", provider=False)
        cust2_uid, _ = await _usuario(conn, "c2", provider=False)
        prov_uid, _ = await _usuario(conn, "p", provider=True)
        usuarios += [cust_uid, cust2_uid, prov_uid]
        prov_id = uuid.uuid4()
        perfiles.append(prov_id)
        await conn.execute(
            """INSERT INTO provider_profiles (id, user_id, status, home_latitude, home_longitude,
                                              service_radius_km, bio, home_address)
               VALUES ($1,$2,'ACTIVE'::provider_profile_status,43.65,-79.38,50,
                       'Smoke bio','1 Provider St')""",
            prov_id, prov_uid)
        await conn.execute(
            """INSERT INTO provider_task_qualifications (provider_id, task_id, qualified)
               VALUES ($1,$2,TRUE)""", prov_id, task_id)

        # Customer de Stripe test para comprobar que la purga lo borra.
        cus = stripe.Customer.create(email=cust_email, description="smoke_account_deletion")
        stripe_customers.append(cus.id)
        await conn.execute("UPDATE users SET stripe_customer_id=$1 WHERE id=$2", cus.id, cust_uid)

        # Archivo propio del cliente (avatar) y del proveedor (documento).
        avatar = _BACKEND_ROOT / "uploads" / "avatars" / str(cust_uid) / "a.jpg"
        doc = _BACKEND_ROOT / "uploads" / "provider_documents" / str(prov_id) / "d.pdf"
        for f in (avatar, doc):
            f.parent.mkdir(parents=True, exist_ok=True)
            f.write_bytes(b"smoke")
            archivos.append(f)
        await conn.execute(
            "INSERT INTO provider_documents (provider_id, name, document_url) VALUES ($1,'d',$2)",
            prov_id, f"/uploads/provider_documents/{prov_id}/d.pdf")

        tok_c = auth_service.create_access_token(cust_uid)[0]
        tok_p = auth_service.create_access_token(prov_uid)[0]
        H_C = {"Authorization": f"Bearer {tok_c}"}
        H_P = {"Authorization": f"Bearer {tok_p}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=90) as c:

            async def plan(h) -> dict:
                r = await c.get(f"{API}/users/me/deletion-check", headers=h)
                check(r.status_code == 200, f"deletion-check {r.status_code}: {r.text[:200]}")
                return r.json()["data"]

            def codigos(p: dict) -> list[str]:
                return [b["code"] for b in p["blockers"]]

            # ---- A ----------------------------------------------------------
            r = await c.get(f"{API}/users/me/deletion-check")
            check(r.status_code in (401, 403), f"A: sin token {r.status_code}")
            step("A", f"sin token → {r.status_code}")

            # ---- B: la regla de los 15 min ----------------------------------
            pi1 = _hold_real()
            j1 = await _job(conn, cust_uid, task_id, estado="SCHEDULED",
                            cuando=now + timedelta(minutes=5), pi=pi1)
            await _asignar(conn, j1, prov_id)
            p = await plan(H_C)
            check(p["canDelete"] is False and codigos(p) == ["JOB_STARTS_SOON"],
                  f"B: a 5 min debe bloquear: {p['blockers']}")
            r = await c.post(f"{API}/users/me/deletion", headers=H_C, json={"password": PASSWORD})
            check(r.status_code == 409 and r.json()["detail"]["code"] == "deletion_blocked",
                  f"B: POST bloqueado {r.status_code} {r.text[:200]}")
            step("B", "agendado a 5 min → bloquea (check y POST 409)")

            fecha, hora = _local(now + timedelta(hours=2))
            await conn.execute(
                "UPDATE jobs SET requested_date=$1, requested_time_start=$2 WHERE id=$3",
                fecha, hora, j1)
            j2 = await _job(conn, cust_uid, task_id, estado="PENDING_MATCH", cuando=None)
            of2 = await _oferta(conn, j2, prov_id, "pending")
            p = await plan(H_C)
            cambios = {(w.get("jobId"), w["action"]) for w in p["willChange"]}
            check(p["canDelete"] is True, f"B: a 2 h no debe bloquear: {p['blockers']}")
            check({(str(j1), "cancel"), (str(j2), "cancel")} <= cambios, f"B: willChange {cambios}")
            step("B", "CONTROL: el mismo trabajo a 2 h → no bloquea, se cancelará")

            # ---- C ----------------------------------------------------------
            r = await c.post(f"{API}/users/me/deletion", headers=H_C, json={"password": "mal"})
            check(r.status_code == 403 and r.json()["detail"]["code"] == "wrong_password",
                  f"C: {r.status_code} {r.text[:160]}")
            check(await conn.fetchval("SELECT status::text FROM users WHERE id=$1", cust_uid)
                  == "ACTIVE", "C: la cuenta no debe cambiar")
            step("C", "contraseña mala → 403, la cuenta sigue activa")

            # ---- D: el borrado del cliente ----------------------------------
            r = await c.post(f"{API}/users/me/deletion", headers={**H_C, "X-Forwarded-For": "203.0.113.7"},
                             json={"password": PASSWORD})
            check(r.status_code == 200, f"D: borrar {r.status_code} {r.text[:300]}")
            d = r.json()["data"]
            check(len(d["jobActions"]) == 2, f"D: jobActions {d['jobActions']}")
            for jid in (j1, j2):
                row = await conn.fetchrow(
                    "SELECT status::text AS s, cancellation_reason AS r, cancelled_at FROM jobs WHERE id=$1", jid)
                check(row["s"].startswith("CANCELLED") and row["r"] == "ACCOUNT_DELETED"
                      and row["cancelled_at"] is not None, f"D: job {jid} quedó {dict(row)}")
            check(stripe.PaymentIntent.retrieve(pi1).status == "canceled",
                  "D: la retención real NO se liberó")
            check(await conn.fetchval("SELECT status FROM job_offers WHERE id=$1", of2) == "expired",
                  "D: la oferta pendiente del proveedor no caducó")
            u = await conn.fetchrow("SELECT status::text AS s, deleted_at FROM users WHERE id=$1", cust_uid)
            check(u["s"] == "DEACTIVATED" and u["deleted_at"] is not None, f"D: usuario {dict(u)}")
            rec = await conn.fetchrow(
                "SELECT ip_address, purge_after, requested_at FROM account_deletions WHERE user_id=$1",
                cust_uid)
            check(rec is not None and rec["ip_address"] == "203.0.113.7", f"D: registro {rec}")
            check(timedelta(days=29) < rec["purge_after"] - rec["requested_at"] <= timedelta(days=30),
                  "D: la purga debe quedar a 30 días")
            avisos = await conn.fetchval(
                "SELECT count(*) FROM notifications WHERE user_id=$1 AND body LIKE '%closed their VISP account%'",
                prov_uid)
            check(avisos >= 1, f"D: el proveedor no recibió aviso ({avisos})")
            step("D", "2 trabajos cancelados, retención Stripe canceled, oferta caducada, "
                      "aviso al proveedor, registro con IP y purga a 30 días")

            # ---- E: sesiones, login y registro ------------------------------
            r = await c.get(f"{API}/users/me/deletion-check", headers=H_C)
            check(r.status_code == 401, f"E: el token viejo sigue vivo ({r.status_code})")
            r = await c.post(f"{API}/auth/login", json={"email": cust_email, "password": PASSWORD})
            check(r.status_code == 401 and "deleted" in r.text, f"E: login {r.status_code} {r.text[:160]}")
            r = await c.post(f"{API}/auth/register", json={
                "email": cust_email, "password": PASSWORD, "firstName": "X", "lastName": "Y",
                "role": "customer"})
            check(r.status_code == 409 and "deleted" in r.text, f"E: registro {r.status_code} {r.text[:160]}")
            step("E", "token viejo → 401; login y registro explican que se borró")

            # ---- F: restaurar y volver a borrar -----------------------------
            async with async_session_factory() as db:
                from src.models import User
                await svc.restore_account(db, await db.get(User, cust_uid))
                await db.commit()
            r = await c.post(f"{API}/auth/login", json={"email": cust_email, "password": PASSWORD})
            check(r.status_code == 200, f"F: tras restaurar no entra ({r.status_code})")
            r = await c.post(f"{API}/users/me/deletion", headers=H_C, json={"password": PASSWORD})
            check(r.status_code == 200, f"F: segundo borrado {r.status_code} {r.text[:200]}")
            step("F", "restaurada → entra; borrada otra vez")

            # ---- G: el proveedor --------------------------------------------
            j3 = await _job(conn, cust2_uid, task_id, estado="IN_PROGRESS",
                            cuando=now - timedelta(minutes=30))
            await _asignar(conn, j3, prov_id)
            j4 = await _job(conn, cust2_uid, task_id, estado="COMPLETED", cuando=now - timedelta(hours=3),
                            pi="pi_smoke_uncaptured", completed_at=now - timedelta(hours=1))
            await _asignar(conn, j4, prov_id)
            await conn.execute("UPDATE provider_profiles SET stripe_account_id='acct_smoke_del' WHERE id=$1",
                               prov_id)

            async def saldo_falso(_acct):
                return saldo_falso.valor, "2026-10-02"
            saldo_falso.valor = 1500
            svc.stripe_pending_balance = saldo_falso

            p = await plan(H_P)
            check(set(codigos(p)) == {"JOB_UNDERWAY", "PAYMENT_PENDING", "PAYOUT_PENDING"},
                  f"G: bloqueos del proveedor {codigos(p)}")
            check(p["pendingBalanceCents"] == 1500 and p["expectedPayoutDate"] == "2026-10-02",
                  "G: saldo y fecha")
            step("G", "en curso + cobro sin capturar + saldo $15 → bloquean los tres")

            await conn.execute("UPDATE jobs SET status='COMPLETED', final_price_cents=2000 "
                               "WHERE id = ANY($1)", [j3, j4])
            saldo_falso.valor = 0

            # El trabajo que vuelve al matching, con su retención real y oferta aceptada.
            pi5 = _hold_real()
            j5 = await _job(conn, cust2_uid, task_id, estado="SCHEDULED",
                            cuando=now + timedelta(hours=3), pi=pi5)
            of5 = await _oferta(conn, j5, prov_id, "accepted")
            await conn.execute("UPDATE jobs SET accepted_offer_id=$1, price_agreed_at=now(), "
                               "offers_close_at=now() - interval '1 hour' WHERE id=$2", of5, j5)
            await _asignar(conn, j5, prov_id)
            # Y una oferta suya en otro trabajo abierto.
            j6 = await _job(conn, cust2_uid, task_id, estado="PENDING_MATCH", cuando=None)
            of6 = await _oferta(conn, j6, prov_id, "pending")

            # ---- H (control): antes del borrado el matching no lo excluye por cuenta
            from src.models import Job, ProviderProfile
            from src.services.matchingEngine import BID_ACCOUNT_INACTIVE, provider_can_bid
            async with async_session_factory() as db:
                antes = await provider_can_bid(db, await db.get(Job, j6), await db.get(ProviderProfile, prov_id))
            check(antes != BID_ACCOUNT_INACTIVE, f"H: antes del borrado ya daba {antes}")

            p = await plan(H_P)
            check(p["canDelete"] is True, f"G: debería poder borrar ya: {p['blockers']}")
            r = await c.post(f"{API}/users/me/deletion", headers=H_P, json={"password": PASSWORD})
            check(r.status_code == 200, f"G: borrar proveedor {r.status_code} {r.text[:300]}")

            row = await conn.fetchrow(
                "SELECT status::text AS s, accepted_offer_id, price_agreed_at, stripe_payment_intent_id AS pi, "
                "offers_close_at FROM jobs WHERE id=$1", j5)
            check(row["s"] == "PENDING_MATCH", f"G: el trabajo quedó {row['s']}")
            check(row["accepted_offer_id"] is None and row["price_agreed_at"] is None and row["pi"] is None,
                  f"G: quedó a medias {dict(row)}")
            check(row["offers_close_at"] > datetime.now(timezone.utc), "G: sin ventana de ofertas nueva")
            check(stripe.PaymentIntent.retrieve(pi5).status == "canceled", "G: la retención real no se liberó")
            check(await conn.fetchval("SELECT status FROM job_offers WHERE id=$1", of5) == "withdrawn",
                  "G: la oferta aceptada no quedó withdrawn")
            check(await conn.fetchval("SELECT status FROM job_offers WHERE id=$1", of6) == "withdrawn",
                  "G: su oferta en otro trabajo no se retiró")
            check(await conn.fetchval(
                "SELECT status::text FROM job_assignments WHERE job_id=$1 AND provider_id=$2", j5, prov_id)
                == "CANCELLED", "G: la asignación sigue ACCEPTED")
            check(await conn.fetchval("SELECT status::text FROM provider_profiles WHERE id=$1", prov_id)
                  == "INACTIVE", "G: el perfil no quedó INACTIVE")
            check(await conn.fetchval(
                "SELECT count(*) FROM notifications WHERE user_id=$1 AND title LIKE '%no longer available%'",
                cust2_uid) >= 1, "G: el cliente no recibió aviso")
            from src.services.offerService import _job_is_open
            async with async_session_factory() as db:
                check(_job_is_open(await db.get(Job, j5)), "G: el trabajo no admite ofertas")
            step("G", "sin bloqueos → su trabajo vuelve al matching (PENDING_MATCH, oferta "
                      "withdrawn, retención canceled, aviso al cliente); ofertas retiradas")

            # ---- H: el matching lo excluye ----------------------------------
            async with async_session_factory() as db:
                despues = await provider_can_bid(db, await db.get(Job, j5),
                                                 await db.get(ProviderProfile, prov_id))
            check(despues == BID_ACCOUNT_INACTIVE, f"H: provider_can_bid dio {despues}")
            step("H", f"provider_can_bid: {antes} antes → {despues} después")

            # ---- I: la purga ------------------------------------------------
            await conn.execute(
                "INSERT INTO legal_consents (user_id, consent_type, consent_version, consent_text_hash, "
                "consent_text, granted) VALUES ($1,'PLATFORM_TOS','smoke','h','t',TRUE)", prov_uid)
            async with async_session_factory() as db:
                for uid in (cust_uid, prov_uid):
                    res = await svc.purge_due_accounts(db, user_id=uid)
                    check(res["purged"] == 1, f"I: purga {uid} → {res}")
                await db.commit()
            u = await conn.fetchrow("SELECT * FROM users WHERE id=$1", cust_uid)
            check(u["email"] == f"deleted+{cust_uid}@invalid" and u["first_name"] == "Deleted"
                  and u["phone"] is None and u["password_hash"] is None
                  and u["stripe_customer_id"] is None, "I: el cliente no quedó anónimo")
            check(getattr(stripe.Customer.retrieve(cus.id), "deleted", False) is True,
                  "I: el customer de Stripe sigue vivo")
            check(not avatar.exists() and not doc.exists(), "I: quedan archivos")
            pp = await conn.fetchrow("SELECT bio, home_address, stripe_account_id FROM provider_profiles "
                                     "WHERE id=$1", prov_id)
            check(pp["bio"] is None and pp["home_address"] is None and pp["stripe_account_id"] is None,
                  f"I: perfil {dict(pp)}")
            check(await conn.fetchval("SELECT count(*) FROM provider_documents WHERE provider_id=$1",
                                      prov_id) == 0, "I: quedan documentos")
            check(await conn.fetchval("SELECT count(*) FROM jobs WHERE customer_id=$1", cust_uid) == 2,
                  "I: los trabajos del cliente deben conservarse")
            check(await conn.fetchval("SELECT count(*) FROM legal_consents WHERE user_id=$1", prov_uid) == 1,
                  "I: el consentimiento debe conservarse")
            nota = await conn.fetchval("SELECT purge_notes FROM account_deletions WHERE user_id=$1 "
                                       "AND purged_at IS NOT NULL", prov_uid)
            step("I", f"anonimizados, customer Stripe borrado, archivos y documentos fuera; "
                      f"trabajos y consentimiento conservados. Nota Stripe: {nota!r:.80}")

            # ---- J: el email queda libre ------------------------------------
            r = await c.post(f"{API}/auth/register", json={
                "email": cust_email, "password": PASSWORD, "firstName": "Otra", "lastName": "Vez",
                "role": "customer"})
            check(r.status_code == 201, f"J: registrar de nuevo {r.status_code} {r.text[:160]}")
            nuevo = await conn.fetchval("SELECT id FROM users WHERE email=$1", cust_email)
            usuarios.append(nuevo)
            step("J", "el email vuelve a estar libre tras la purga")

        print(f"\nSMOKE PASS — {_checks} comprobaciones")
        return 0

    except SmokeError as exc:
        print(f"\nSMOKE FAIL — {exc}", file=sys.stderr)
        return 1
    finally:
        svc.stripe_pending_balance = original_balance
        ids = [u for u in usuarios if u]
        jobs = [r["id"] for r in await conn.fetch("SELECT id FROM jobs WHERE customer_id = ANY($1)", ids)]
        await conn.execute("UPDATE jobs SET accepted_offer_id=NULL WHERE id = ANY($1)", jobs)
        await conn.execute("DELETE FROM job_offers WHERE job_id = ANY($1)", jobs)
        await conn.execute("DELETE FROM job_assignments WHERE job_id = ANY($1)", jobs)
        await conn.execute("DELETE FROM jobs WHERE id = ANY($1)", jobs)
        await conn.execute("DELETE FROM job_assignments WHERE provider_id = ANY($1)", perfiles)
        await conn.execute("DELETE FROM account_deletions WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM legal_consents WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM provider_profiles WHERE id = ANY($1)", perfiles)
        await conn.execute("DELETE FROM users WHERE id = ANY($1)", ids)
        for f in archivos:
            try:
                f.unlink(missing_ok=True)
                f.parent.rmdir()
            except OSError:
                pass
        for cid in stripe_customers:
            try:
                stripe.Customer.delete(cid)
            except Exception:  # noqa: BLE001 — ya borrado por la purga
                pass
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
