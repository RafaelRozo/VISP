"""Smoke del MOTIVO DE RECHAZO de la verificación de identidad del proveedor.

Existe por un caso real: una proveedora del equipo subió su documento, la página
embebida le dijo "All done" y la app siguió diciéndole que le faltaba algo.
Stripe daba el motivo desde el primer momento —`document_name_mismatch`, el
nombre de la cuenta no coincide con el del documento— pero no salía de los logs,
así que ella reintentaba la foto, que no arregla nada.

Lo que se comprueba:

  A — El extractor: el veredicto de la PERSONA (`individual.verification`) manda
      sobre el del documento, porque es el que explica el fallo cuando el
      archivo se subió bien pero el nombre no cuadra. Si no hay uno, se usa el
      otro. Cuenta limpia → nada, para no inventar avisos.
  B — CRUZANDO CAPAS: `GET /payouts/v2/status` de verdad, por HTTP, con la
      respuesta de Stripe simulada. Lo único que se finge es el tercero; ruta,
      servicio y serialización son los reales. Probar solo el extractor habría
      dejado pasar que el campo no llegara al JSON, que es justo lo que pasó.
  C — Cuenta sana → los dos campos a null. Un aviso falso en esta pantalla manda
      al proveedor a cambiarse el nombre sin motivo.
  D — El atajo de "todavía sin cuenta de cobros" devuelve LAS MISMAS claves que
      el camino normal. Está escrito a mano y ya se quedó corto una vez.
  E — La página embebida ya no canta éxito en `onExit`: ese evento salta también
      cuando el proveedor abandona a medias. Debe consultar el estado y contar
      los dos desenlaces.
  F — Contra Stripe de VERDAD (si hay cuentas): ninguna cuenta con cobros
      activos inventa un motivo, y si alguna está rechazada, el motivo se lee.
      Esta es la única parte que habla con Stripe, y es de solo lectura.

No mueve dinero y no toca ninguna cuenta de Stripe. Todo lo sembrado se borra.

    cd visp-tasker/backend && ./venv/bin/python scripts/smoke_payout_verification.py
"""

from __future__ import annotations

import asyncio
import sys
import uuid
from pathlib import Path
from types import SimpleNamespace

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))

import asyncpg  # noqa: E402
import stripe  # noqa: E402
from httpx import ASGITransport, AsyncClient  # noqa: E402

from src.core.config import settings  # noqa: E402
from src.integrations.stripe import connectV2Service as c2  # noqa: E402
from src.main import app  # noqa: E402
from src.services import auth_service  # noqa: E402

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


def _cuenta(
    *,
    persona: tuple[str | None, str | None] = (None, None),
    documento: tuple[str | None, str | None] = (None, None),
    payouts: bool = False,
    due: tuple[str, ...] = (),
) -> SimpleNamespace:
    """Una cuenta de Stripe con la forma que devuelve el SDK v1.

    `individual.verification` lleva el veredicto de la persona y
    `.verification.document` el del archivo. Los dos con `details_code` y
    `details`, que es de donde sale el motivo.
    """
    p_code, p_msg = persona
    d_code, d_msg = documento
    return SimpleNamespace(
        id="acct_smoke",
        payouts_enabled=payouts,
        details_submitted=True,
        capabilities={"transfers": "active"} if payouts else {},
        requirements=SimpleNamespace(
            currently_due=list(due), past_due=[], disabled_reason=None,
        ),
        individual=SimpleNamespace(
            verification=SimpleNamespace(
                details_code=p_code,
                details=p_msg,
                document=SimpleNamespace(details_code=d_code, details=d_msg),
            ),
        ),
    )


async def main() -> int:  # noqa: C901 — un smoke es una lista de comprobaciones
    conn = await asyncpg.connect(_DSN)
    usuarios: list[uuid.UUID] = []
    retrieve_real = stripe.Account.retrieve
    sesion_real = getattr(stripe, "AccountSession", None)

    try:
        # ---- A: el extractor, sin red -------------------------------------
        code, msg = c2._extract_verification_error(
            _cuenta(persona=("document_name_mismatch",
                             "The name on the document does not match the name on the account."))
        )
        check(code == "document_name_mismatch", f"A: código mal leído: {code!r}")
        check(msg is not None and "does not match" in msg, "A: mensaje perdido")

        code, _ = c2._extract_verification_error(
            _cuenta(documento=("document_too_large", "The uploaded file is too large."))
        )
        check(code == "document_too_large", f"A: no cae al veredicto del documento: {code!r}")

        code, _ = c2._extract_verification_error(
            _cuenta(persona=("document_name_mismatch", "x"),
                    documento=("document_too_large", "y"))
        )
        check(code == "document_name_mismatch",
              "A: con los dos presentes debe mandar el de la persona, no el del archivo")

        check(c2._extract_verification_error(_cuenta(payouts=True)) == (None, None),
              "A: cuenta limpia inventando un motivo")
        check(c2._extract_verification_error(SimpleNamespace(id="x")) == (None, None),
              "A: sin `individual` debe callarse, no petar")
        step("A", "extractor: manda el veredicto de la persona, cae al del documento, calla si no hay")

        # ---- semilla: un proveedor con cuenta de cobros -------------------
        uid = uuid.uuid4()
        await conn.execute(
            """INSERT INTO users (id, email, password_hash, first_name, last_name,
                                  phone, auth_provider, role_customer, role_provider,
                                  role_admin, status, email_verified, phone_verified,
                                  recovery_code)
               VALUES ($1,$2,$3,'Smoke','Verify',$4,'EMAIL',FALSE,TRUE,FALSE,
                       'ACTIVE'::user_status,TRUE,FALSE,$5)""",
            uid, f"smoke-verif-{uuid.uuid4().hex[:8]}@visp.test",
            auth_service.hash_password("SmokeTest123!"),
            "+1416" + str(uid.int)[-7:], uuid.uuid4().hex[:12].upper(),
        )
        usuarios.append(uid)
        prof_id = uuid.uuid4()
        await conn.execute(
            """INSERT INTO provider_profiles (id, user_id, stripe_account_id)
               VALUES ($1,$2,'acct_smoke')""", prof_id, uid)

        hdr = {"Authorization": f"Bearer {auth_service.create_access_token(uid)[0]}"}
        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://smoke") as cli:

            # ---- B: el motivo llega al JSON, por HTTP ---------------------
            stripe.Account.retrieve = lambda *a, **k: _cuenta(  # type: ignore[assignment]
                persona=("document_name_mismatch",
                         "The name on the document does not match the name on the account."),
                due=("individual.verification.proof_of_liveness",),
            )
            r = await cli.get(f"{API}/provider/payouts/v2/status", headers=hdr)
            check(r.status_code == 200, f"B: status devolvió {r.status_code}: {r.text[:200]}")
            d = r.json()["data"]
            check(d["verificationCode"] == "document_name_mismatch",
                  f"B: el código no llega al JSON: {d.get('verificationCode')!r}")
            check("does not match" in (d["verificationMessage"] or ""),
                  "B: el mensaje de Stripe no llega al JSON")
            check(d["payoutsEnabled"] is False, "B: no debería dar los cobros por activos")
            step("B", "GET /payouts/v2/status trae el motivo hasta el JSON (ruta+servicio reales)")

            # ---- C: cuenta sana, sin aviso falso -------------------------
            stripe.Account.retrieve = lambda *a, **k: _cuenta(payouts=True)  # type: ignore[assignment]
            d = (await cli.get(f"{API}/provider/payouts/v2/status", headers=hdr)).json()["data"]
            check(d["verificationCode"] is None and d["verificationMessage"] is None,
                  f"C: cuenta verificada con aviso falso: {d['verificationCode']!r}")
            check(d["payoutsEnabled"] is True, "C: cuenta buena marcada como no habilitada")
            step("C", "cuenta verificada: sin motivo, sin aviso falso")

            # ---- E: la página embebida no canta éxito --------------------
            if sesion_real is not None:
                stripe.AccountSession.create = lambda *a, **k: SimpleNamespace(  # type: ignore[assignment]
                    client_secret="cs_smoke_123")
                u = await cli.post(f"{API}/provider/payouts/v2/embed-url", headers=hdr)
                check(u.status_code == 200, f"E: embed-url devolvió {u.status_code}")
                token = u.json()["data"]["url"].split("t=")[1]
                pag = await cli.get(f"{API}/provider/payouts/v2/embed?t={token}")
                check(pag.status_code == 200, f"E: la página devolvió {pag.status_code}")
                html = pag.text
                check("All done. You can close" not in html,
                      "E: sigue cantando éxito al salir, aunque el proveedor abandone")
                check("payouts/v2/status" in html,
                      "E: al salir no consulta el estado real")
                check("You're verified" in html and "Not finished yet" in html,
                      "E: falta uno de los dos desenlaces")
                step("E", "la página consulta el estado al salir en vez de dar por bueno")

        # ---- D: el atajo sin cuenta trae las mismas claves ---------------
        await conn.execute(
            "UPDATE provider_profiles SET stripe_account_id = NULL WHERE id = $1", prof_id)
        async with AsyncClient(transport=transport, base_url="http://smoke") as cli:
            sin = (await cli.get(f"{API}/provider/payouts/v2/status", headers=hdr)).json()["data"]
        stripe.Account.retrieve = lambda *a, **k: _cuenta(payouts=True)  # type: ignore[assignment]
        await conn.execute(
            "UPDATE provider_profiles SET stripe_account_id='acct_smoke' WHERE id=$1", prof_id)
        async with AsyncClient(transport=transport, base_url="http://smoke") as cli:
            con_cuenta = (await cli.get(f"{API}/provider/payouts/v2/status",
                                        headers=hdr)).json()["data"]
        faltan = set(con_cuenta) - set(sin)
        check(not faltan, f"D: al atajo sin cuenta le faltan claves: {sorted(faltan)}")
        check(sin["verificationCode"] is None, "D: el atajo debe devolver null, no omitir la clave")
        step("D", f"el atajo sin cuenta devuelve las {len(sin)} claves del camino normal")

        # ---- F: contra Stripe de verdad, solo lectura --------------------
        stripe.Account.retrieve = retrieve_real  # type: ignore[assignment]
        reales = await conn.fetch(
            """SELECT u.email, p.stripe_account_id
               FROM provider_profiles p JOIN users u ON u.id = p.user_id
               WHERE p.stripe_account_id IS NOT NULL
                 AND p.stripe_account_id <> 'acct_smoke'
               ORDER BY u.email""")
        if not reales:
            step("F", "sin cuentas reales en la base: nada que contrastar (no es fallo)")
        else:
            for f in reales:
                res = await c2.get_account_status(f["stripe_account_id"])
                if res.payouts_enabled:
                    check(res.verification_code is None,
                          f"F: {f['email']} cobra y aun así reporta "
                          f"{res.verification_code!r}")
                    print(f"      {f['email']}: cobros activos, sin motivo — ok")
                else:
                    motivo = res.verification_code or res.verification_message
                    print(f"      {f['email']}: bloqueada — "
                          f"{motivo or 'sin motivo de Stripe (falta un paso, no un rechazo)'}")
            check(True, "F: leídas todas las cuentas reales sin petar")
            step("F", f"{len(reales)} cuentas reales leídas: ninguna verificada inventa motivo")

    finally:
        stripe.Account.retrieve = retrieve_real  # type: ignore[assignment]
        if sesion_real is not None:
            stripe.AccountSession = sesion_real  # type: ignore[assignment]
        for u in usuarios:
            await conn.execute("DELETE FROM provider_profiles WHERE user_id = $1", u)
            await conn.execute("DELETE FROM users WHERE id = $1", u)
        await conn.close()

    print(f"\nSMOKE PASS — {_checks} comprobaciones")
    return 0


if __name__ == "__main__":
    try:
        raise SystemExit(asyncio.run(main()))
    except SmokeError as exc:
        print(f"\nSMOKE FAIL — {exc}", file=sys.stderr)
        raise SystemExit(1) from exc
