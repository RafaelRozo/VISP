"""Smoke de denunciar y bloquear (Apple 1.2). Plan: docs/plan-denunciar-bloquear.md

SOLO contra `visp_demo`. No toca Stripe: los trabajos se siembran sin retención.

    cd visp-tasker/backend
    DATABASE_URL=postgresql+asyncpg://…/visp_demo ./venv/bin/python scripts/smoke_report_block.py

  A — Denunciar: el cliente denuncia el perfil de quien le ofertó (con copia de
      la bio); un proveedor SIN relación con el trabajo recibe 403; "otro" sin
      nota da 400.
  B — Chat: un insulto abre una denuncia AUTO_FILTER y el mensaje se entrega.
      El cliente lo denuncia y deja de verlo; el proveedor lo sigue viendo.
  C — Con un trabajo ASIGNADO no se bloquea directamente: 409 job_active con el
      jobId, también desde la casilla de la denuncia, y sin dejar nada guardado.
  D — Bloquear desde el menú (trabajo terminado): la oferta viva se retira y no
      sale en la lista, el chat da 403 user_blocked a LOS DOS por REST y por
      SOCKET, el historial dice blocked=true, `provider_can_bid` da `blocked`,
      la bolsa del proveedor no enseña el trabajo y el matching no lo incluye.
  E — Botón de pánico con "bloquear también": cancela, bloquea (PANIC, enlazado
      al reporte) y la cola de cancelaciones lo marca.
  F — Admin: contadores, la cola, quitar el mensaje (deja de salir a los dos),
      un admin normal NO puede banear.
  G — Admin desbloquea: sin nota 422; con nota se borra, queda la foto en
      moderation_actions y el chat y la bolsa vuelven a funcionar.
  H — Banear: la cuenta queda BANNED y sus peticiones dan 401/403.

Todo lo sembrado se borra al final.
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402
from sqlalchemy import select  # noqa: E402

from src.core.config import settings  # noqa: E402

_DSN = settings.database_url.replace("postgresql+asyncpg://", "postgresql://")
if "visp_demo" not in _DSN:
    print("REFUSING TO RUN: hace falta DATABASE_URL a visp_demo", file=sys.stderr)
    sys.exit(2)

from src.api.deps import async_session_factory  # noqa: E402
from src.main import app  # noqa: E402
from src.models.job import Job  # noqa: E402
from src.models.provider import ProviderProfile  # noqa: E402
from src.models.superuser import SuperUser  # noqa: E402
from src.realtime.handlers import chatHandler  # noqa: E402
from src.services import auth_service, matchingEngine  # noqa: E402
from src.services.admin_service import create_admin_tokens  # noqa: E402

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


async def _usuario(conn, tag: str, *, provider: bool) -> tuple[uuid.UUID, str]:
    uid = uuid.uuid4()
    email = f"smoke-mod-{tag}-{uuid.uuid4().hex[:8]}@visp.test"
    await conn.execute(
        """INSERT INTO users (id, email, password_hash, first_name, last_name, phone,
                              auth_provider, role_customer, role_provider, role_admin,
                              status, email_verified, phone_verified, recovery_code)
           VALUES ($1,$2,$3,'Smoke',$4,$5,'EMAIL',TRUE,$6,FALSE,'ACTIVE'::user_status,
                   TRUE,FALSE,$7)""",
        uid, email, auth_service.hash_password("SmokeMod123!"), tag,
        "+1416" + str(uid.int)[-7:], provider, uuid.uuid4().hex[:12].upper(),
    )
    return uid, email


async def _perfil(conn, uid, task_id, bio: str) -> uuid.UUID:
    pid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO provider_profiles (id, user_id, status, home_latitude, home_longitude,
                                          service_radius_km, bio, home_address)
           VALUES ($1,$2,'ACTIVE'::provider_profile_status,43.65,-79.38,50,$3,'1 Provider St')""",
        pid, uid, bio)
    await conn.execute(
        "INSERT INTO provider_task_qualifications (provider_id, task_id, qualified) VALUES ($1,$2,TRUE)",
        pid, task_id)
    return pid


async def _job(conn, customer_id, task_id, estado: str) -> uuid.UUID:
    jid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO jobs (id, reference_number, customer_id, task_id, status,
                             service_latitude, service_longitude, service_address,
                             service_province_state, customer_details,
                             offers_close_at, commission_rate)
           VALUES ($1,$2,$3,$4,$5::job_status,43.65,-79.38,'1 Smoke St','ON',
                   'Two-storey house, big backyard', now() + interval '40 hours', 0.15)""",
        jid, f"MOD-{jid.hex[:8].upper()}", customer_id, task_id, estado)
    return jid


async def _oferta(conn, job_id, prov_id) -> uuid.UUID:
    oid = uuid.uuid4()
    await conn.execute(
        """INSERT INTO job_offers (id, job_id, provider_id, unit, rate_cents, magnitude,
                                   magnitude_source, subtotal_cents, total_cents, status)
           VALUES ($1,$2,$3,'FLAT_PACKAGE',2000,1,'FLAT',2000,2000,'pending')""",
        oid, job_id, prov_id)
    return oid


async def _asignar(conn, job_id, prov_id, status: str) -> None:
    await conn.execute(
        """INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, responded_at)
           VALUES ($1,$2,$3,$4::assignment_status,now(),now())""",
        uuid.uuid4(), job_id, prov_id, status)


async def main() -> int:  # noqa: C901 — un smoke es una lista de comprobaciones
    conn = await asyncpg.connect(_DSN)
    check(await conn.fetchval("SELECT current_database()") == "visp_demo", "BD equivocada")
    usuarios: list[uuid.UUID] = []
    perfiles: list[uuid.UUID] = []
    jobs: list[uuid.UUID] = []

    task_id = await conn.fetchval(
        "SELECT id FROM service_tasks WHERE is_active ORDER BY created_at LIMIT 1")

    # El socket: sin conexión real, se le da la identidad y se anula el broadcast.
    original_meta, original_broadcast = chatHandler.get_sid_meta, chatHandler.broadcast_to_job

    try:
        cust_uid, cust_email = await _usuario(conn, "c", provider=False)
        cust2_uid, _ = await _usuario(conn, "c2", provider=False)
        prov_uid, _ = await _usuario(conn, "p", provider=True)
        otro_uid, _ = await _usuario(conn, "u", provider=True)
        usuarios += [cust_uid, cust2_uid, prov_uid, otro_uid]
        prov_id = await _perfil(conn, prov_uid, task_id, "Smoke bio — offensive text")
        otro_id = await _perfil(conn, otro_uid, task_id, "Unrelated")
        perfiles += [prov_id, otro_id]

        j_open = await _job(conn, cust_uid, task_id, "PENDING_MATCH")
        j_other = await _job(conn, cust_uid, task_id, "PENDING_MATCH")
        j_done = await _job(conn, cust_uid, task_id, "COMPLETED")
        j_live = await _job(conn, cust_uid, task_id, "IN_PROGRESS")
        j_live2 = await _job(conn, cust2_uid, task_id, "IN_PROGRESS")
        jobs += [j_open, j_other, j_done, j_live, j_live2]
        o_open = await _oferta(conn, j_open, prov_id)
        await _asignar(conn, j_done, prov_id, "COMPLETED")
        await _asignar(conn, j_live, prov_id, "ACCEPTED")
        await _asignar(conn, j_live2, prov_id, "ACCEPTED")

        def h(uid) -> dict:
            return {"Authorization": f"Bearer {auth_service.create_access_token(uid)[0]}"}

        H_C, H_C2, H_P, H_U = h(cust_uid), h(cust2_uid), h(prov_uid), h(otro_uid)

        async with async_session_factory() as db:
            sup = (await db.execute(
                select(SuperUser).where(SuperUser.role == "super_admin", SuperUser.is_active)
                .limit(1))).scalar_one()
            adm = (await db.execute(
                select(SuperUser).where(SuperUser.role == "admin").limit(1))).scalar_one_or_none()
        H_SUP = {"Authorization": f"Bearer {create_admin_tokens(sup.id)['accessToken']}"}
        H_ADM = (
            {"Authorization": f"Bearer {create_admin_tokens(adm.id)['accessToken']}"} if adm else None
        )

        async def can_bid(job_id) -> str | None:
            async with async_session_factory() as db:
                return await matchingEngine.provider_can_bid(
                    db, await db.get(Job, job_id), await db.get(ProviderProfile, prov_id))

        async def matching_ids(job_id) -> set[str]:
            async with async_session_factory() as db:
                res = await matchingEngine.find_matching_providers(db, await db.get(Job, job_id))
            return {str(m.get("provider_id") or m.get("providerId")) for m in res["matches"]}

        async def socket_send(uid, job_id, text) -> dict:
            async def _noop(*a, **k):
                return None
            chatHandler.get_sid_meta = lambda sid: {"user_id": str(uid)}
            chatHandler.broadcast_to_job = _noop
            try:
                return await chatHandler.handle_send_message(
                    "smoke-sid", {"job_id": str(job_id), "message_text": text})
            finally:
                chatHandler.get_sid_meta = original_meta
                chatHandler.broadcast_to_job = original_broadcast

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://test", timeout=60) as c:

            async def report(hdr, **body):
                return await c.post(f"{API}/reports", headers=hdr, json=body)

            async def mensajes(hdr, job_id) -> dict:
                r = await c.get(f"{API}/jobs/{job_id}/messages", headers=hdr)
                check(r.status_code == 200, f"messages {r.status_code}: {r.text[:200]}")
                return r.json()["data"]

            async def enviar(hdr, job_id, text):
                return await c.post(f"{API}/jobs/{job_id}/messages", headers=hdr,
                                    json={"message": text})

            # ---- A: denunciar ------------------------------------------------
            r = await report(H_C, jobId=str(j_open), offerId=str(o_open),
                             contentType="PROFILE", reason="OFFENSIVE")
            check(r.status_code == 201, f"A: perfil {r.status_code} {r.text[:200]}")
            rep_perfil = r.json()["data"]["reportId"]
            snap = await conn.fetchval("SELECT snapshot->>'bio' FROM content_reports WHERE id=$1",
                                       uuid.UUID(rep_perfil))
            check(snap == "Smoke bio — offensive text", f"A: snapshot bio {snap!r}")
            check(await conn.fetchval("SELECT reported_user_id FROM content_reports WHERE id=$1",
                                      uuid.UUID(rep_perfil)) == prov_uid,
                  "A: el denunciado tiene que salir de la OFERTA, no de la app")
            step("A", "cliente denuncia el perfil del que ofertó → 201, con copia de la bio")

            r = await report(H_U, jobId=str(j_open), contentType="JOB_DETAILS", reason="SCAM")
            check(r.status_code == 403 and r.json()["detail"]["code"] == "not_related",
                  f"A: sin relación {r.status_code} {r.text[:200]}")
            r = await report(H_P, jobId=str(j_open), contentType="JOB_DETAILS", reason="OTHER")
            check(r.status_code == 400, f"A: OTHER sin nota {r.status_code}")
            r = await report(H_P, jobId=str(j_open), contentType="JOB_DETAILS",
                             reason="INAPPROPRIATE_PHOTO", note="Photos are not of the house")
            check(r.status_code == 201, f"A: proveedor denuncia detalles {r.status_code} {r.text[:200]}")
            step("A", "proveedor sin relación → 403; OTHER sin nota → 400; con oferta → 201")

            # ---- B: chat + filtro automático ---------------------------------
            r = await enviar(H_P, j_done, "you are a bitch")
            check(r.status_code == 201, f"B: insulto se entrega {r.status_code} {r.text[:200]}")
            msg_id = r.json()["data"]["id"]
            auto = await conn.fetchval(
                "SELECT count(*) FROM content_reports WHERE source='AUTO_FILTER' AND content_id=$1",
                uuid.UUID(msg_id))
            check(auto == 1, f"B: AUTO_FILTER {auto}")
            r = await enviar(H_P, j_done, "I'll bring the caulking gun, the fire exit is clear")
            check(r.status_code == 201, "B: mensaje normal")
            limpio = await conn.fetchval(
                "SELECT count(*) FROM content_reports WHERE content_id=$1",
                uuid.UUID(r.json()["data"]["id"]))
            check(limpio == 0, "B: 'gun' y 'fire' del oficio no deben abrir denuncia")
            step("B", "insulto → entregado + denuncia AUTO_FILTER; 'caulking gun'/'fire' → nada")

            r = await report(H_C, jobId=str(j_done), contentType="CHAT_MESSAGE",
                             contentId=msg_id, reason="HARASSMENT")
            check(r.status_code == 201, f"B: denunciar mensaje {r.status_code} {r.text[:200]}")
            ids_c = {m["id"] for m in (await mensajes(H_C, j_done))["items"]}
            ids_p = {m["id"] for m in (await mensajes(H_P, j_done))["items"]}
            check(msg_id not in ids_c, "B: el denunciante ya no ve el mensaje")
            check(msg_id in ids_p, "B: el autor lo sigue viendo")
            r = await report(H_P, jobId=str(j_done), contentType="CHAT_MESSAGE",
                             contentId=msg_id, reason="HARASSMENT")
            check(r.status_code == 403, f"B: denunciar tu propio mensaje {r.status_code}")
            step("B", "denunciado → se le oculta al cliente, el autor lo ve; el propio → 403")

            # ---- C: con un trabajo asignado no se bloquea directo ------------
            antes_rows = await conn.fetchval("SELECT count(*) FROM content_reports")
            r = await c.post(f"{API}/blocks", headers=H_C, json={"jobId": str(j_done)})
            check(r.status_code == 409 and r.json()["detail"]["code"] == "job_active"
                  and r.json()["detail"]["jobId"] == str(j_live),
                  f"C: 409 job_active {r.status_code} {r.text[:200]}")
            r = await report(H_C, jobId=str(j_done), contentType="USER", reason="HARASSMENT", block=True)
            check(r.status_code == 409, f"C: denuncia+bloqueo con trabajo vivo {r.status_code}")
            check(await conn.fetchval("SELECT count(*) FROM content_reports") == antes_rows,
                  "C: el 409 no debe dejar la denuncia guardada")
            check(await conn.fetchval("SELECT count(*) FROM user_blocks WHERE blocker_id=$1",
                                      cust_uid) == 0, "C: ningún bloqueo")
            step("C", "trabajo asignado → 409 job_active (con jobId), nada guardado")

            # Se cierra el trabajo vivo de C con P (sin bloquear) para poder seguir.
            await conn.execute("UPDATE jobs SET status='COMPLETED'::job_status WHERE id=$1", j_live)

            # ---- D: bloquear desde el menú -----------------------------------
            check(await can_bid(j_other) != matchingEngine.BID_BLOCKED, "D: CONTROL can_bid")
            antes_match = str(prov_id) in await matching_ids(j_other)
            r = await c.post(f"{API}/blocks", headers=H_C, json={"jobId": str(j_done)})
            check(r.status_code == 201, f"D: bloquear {r.status_code} {r.text[:200]}")
            check(await conn.fetchval("SELECT status FROM job_offers WHERE id=$1", o_open) == "withdrawn",
                  "D: la oferta viva se retira")
            r = await c.get(f"{API}/jobs/{j_open}/offers", headers=H_C)
            check(r.status_code == 200 and r.json()["data"]["count"] == 0,
                  f"D: la oferta no sale {r.text[:200]}")
            for quien, hdr in (("proveedor", H_P), ("cliente", H_C)):
                r = await enviar(hdr, j_done, "hello")
                check(r.status_code == 403 and r.json()["detail"]["code"] == "user_blocked",
                      f"D: REST {quien} {r.status_code} {r.text[:200]}")
                res = await socket_send(prov_uid if hdr is H_P else cust_uid, j_done, "hello")
                check(res == {"ok": False, "error": "user_blocked"}, f"D: socket {quien} {res}")
            check((await mensajes(H_C, j_done))["blocked"] is True, "D: blocked=true en el historial")
            check(await can_bid(j_other) == matchingEngine.BID_BLOCKED, "D: can_bid != blocked")
            r = await c.get(f"{API}/provider/open-jobs", headers=H_P)
            check(r.status_code == 200, f"D: bolsa {r.status_code}")
            check(str(j_other) not in r.text, "D: la bolsa no enseña el trabajo del que bloqueó")
            check(str(prov_id) not in await matching_ids(j_other), "D: el matching lo excluye")
            step("D", f"menú → oferta retirada, chat 403 a los dos (REST+socket), can_bid=blocked, "
                      f"fuera de bolsa y matching (estaba antes: {antes_match})")

            # ---- E: botón de pánico con bloquear -----------------------------
            r = await c.post(f"{API}/jobs/{j_live2}/cancel-with-reason", headers=H_C2,
                             json={"reasonCode": "FELT_UNSAFE", "block": True})
            check(r.status_code == 200 and r.json()["data"]["blocked"] is True,
                  f"E: pánico {r.status_code} {r.text[:300]}")
            fila = await conn.fetchrow(
                "SELECT source, cancellation_report_id FROM user_blocks WHERE blocker_id=$1 AND blocked_id=$2",
                cust2_uid, prov_uid)
            check(fila is not None and fila["source"] == "PANIC" and fila["cancellation_report_id"],
                  f"E: bloqueo PANIC {fila}")
            check(await conn.fetchval("SELECT status::text FROM jobs WHERE id=$1", j_live2)
                  == "CANCELLED_BY_CUSTOMER", "E: cancelado")
            r = await c.get(f"{API}/admin/cancellation-reports", headers=H_SUP)
            fila_adm = next(x for x in r.json()["data"] if x["jobId"] == str(j_live2))
            check(fila_adm["blocked"] is True, "E: la cola del pánico lo marca")
            step("E", "pánico + bloquear → cancelado, bloqueo PANIC enlazado, marcado en la cola")

            # ---- F: admin ----------------------------------------------------
            r = await c.get(f"{API}/admin/reports/summary", headers=H_SUP)
            check(r.status_code == 200 and r.json()["data"]["open"] >= 4,
                  f"F: summary {r.text[:200]}")
            r = await c.get(f"{API}/admin/reports", headers=H_SUP)
            nuestros = [x for x in r.json()["data"] if x["reported"] and x["reported"]["id"] == str(prov_uid)]
            check(len(nuestros) >= 3, f"F: cola {len(nuestros)}")
            auto_id = next(x["id"] for x in nuestros if x["source"] == "AUTO_FILTER")
            r = await c.post(f"{API}/admin/reports/{auto_id}/resolve", headers=H_SUP,
                             json={"action": "remove_content", "note": "insult"})
            check(r.status_code == 200 and r.json()["data"]["status"] == "ACTIONED", f"F: {r.text[:200]}")
            check(msg_id not in {m["id"] for m in (await mensajes(H_P, j_done))["items"]},
                  "F: el mensaje quitado ya no lo ve ni su autor")
            r = await c.post(f"{API}/admin/reports/{auto_id}/resolve", headers=H_SUP,
                             json={"action": "dismiss"})
            check(r.status_code == 400, "F: resolver dos veces → 400")
            if H_ADM:
                r = await c.post(f"{API}/admin/reports/{rep_perfil}/resolve", headers=H_ADM,
                                 json={"action": "ban"})
                check(r.status_code == 403, f"F: admin normal no banea {r.status_code}")
            step("F", "contadores y cola OK; quitar mensaje → fuera para los dos; admin normal no banea")

            # ---- G: desbloquear desde el admin -------------------------------
            r = await c.get(f"{API}/admin/blocks", headers=H_SUP, params={"q": cust_email})
            bloqueos = r.json()["data"]
            check(len(bloqueos) == 1 and bloqueos[0]["blocked"]["id"] == str(prov_uid),
                  f"G: buscar por email {bloqueos}")
            r = await c.get(f"{API}/admin/blocks", headers=H_SUP, params={"q": "Smoke p"})
            check(any(b["id"] == bloqueos[0]["id"] for b in r.json()["data"]),
                  "G: buscar por nombre del BLOQUEADO también lo encuentra")
            r = await c.post(f"{API}/admin/blocks/{bloqueos[0]['id']}/unblock", headers=H_SUP, json={})
            check(r.status_code == 422, f"G: sin nota {r.status_code}")
            r = await c.post(f"{API}/admin/blocks/{bloqueos[0]['id']}/unblock", headers=H_SUP,
                             json={"note": "Customer asked via support"})
            check(r.status_code == 200, f"G: desbloquear {r.status_code} {r.text[:200]}")
            foto = await conn.fetchval(
                "SELECT block_snapshot->>'blockerId' FROM moderation_actions WHERE action='unblock' "
                "AND target_user_id=$1", prov_uid)
            check(foto == str(cust_uid), f"G: foto del bloqueo {foto}")
            r = await enviar(H_P, j_done, "thanks again")
            check(r.status_code == 201, f"G: el chat vuelve {r.status_code}")
            check(await can_bid(j_other) != matchingEngine.BID_BLOCKED, "G: can_bid vuelve")
            step("G", "admin: buscar por email/nombre, sin nota 422, con nota → desbloqueado y registrado")

            # ---- H: banear ---------------------------------------------------
            r = await c.post(f"{API}/admin/reports/{rep_perfil}/resolve", headers=H_SUP,
                             json={"action": "ban", "note": "smoke"})
            check(r.status_code == 200, f"H: ban {r.status_code} {r.text[:200]}")
            check(await conn.fetchval("SELECT status::text FROM users WHERE id=$1", prov_uid) == "BANNED",
                  "H: BANNED")
            r = await c.get(f"{API}/jobs/{j_done}/messages", headers=H_P)
            check(r.status_code in (401, 403), f"H: baneado sigue entrando {r.status_code}")
            step("H", f"ban → BANNED y sus peticiones dan {r.status_code}")

        print(f"\nSMOKE PASS — {_checks} checks")
        return 0
    except SmokeError as e:
        print(f"\nSMOKE FAIL after {_checks} checks: {e}", file=sys.stderr)
        return 1
    finally:
        chatHandler.get_sid_meta, chatHandler.broadcast_to_job = original_meta, original_broadcast
        ids = usuarios
        await conn.execute(
            "DELETE FROM moderation_actions WHERE target_user_id = ANY($1)", ids)
        await conn.execute(
            "DELETE FROM user_blocks WHERE blocker_id = ANY($1) OR blocked_id = ANY($1)", ids)
        await conn.execute(
            "DELETE FROM content_reports WHERE reported_user_id = ANY($1) OR reporter_id = ANY($1)", ids)
        await conn.execute("DELETE FROM chat_messages WHERE job_id = ANY($1)", jobs)
        await conn.execute("DELETE FROM job_cancellation_reports WHERE job_id = ANY($1)", jobs)
        await conn.execute("DELETE FROM job_offers WHERE job_id = ANY($1)", jobs)
        await conn.execute("DELETE FROM job_assignments WHERE job_id = ANY($1)", jobs)
        await conn.execute("DELETE FROM notifications WHERE user_id = ANY($1)", ids)
        await conn.execute("DELETE FROM jobs WHERE id = ANY($1)", jobs)
        await conn.execute("DELETE FROM provider_task_qualifications WHERE provider_id = ANY($1)", perfiles)
        await conn.execute("DELETE FROM provider_profiles WHERE id = ANY($1)", perfiles)
        await conn.execute("DELETE FROM users WHERE id = ANY($1)", ids)
        await conn.close()


if __name__ == "__main__":
    sys.exit(asyncio.run(main()))
