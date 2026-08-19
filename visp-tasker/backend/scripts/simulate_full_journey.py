"""FULL end-to-end customer↔provider journey simulation (no device needed).

Because the app is geo-locked to Canada and cannot be exercised from Mexico,
this script drives the ENTIRE real lifecycle through the actual API endpoints
(in-process ASGI against the deployed code) + the real visp_prod DB + Stripe
test mode, so we can prove the whole flow runs with no errors and see the
receipt/invoice + payout math.

Scenario (real seed data):
  Customer  bob.singh@test.tasker.ca  books  "Bed Frame Assembly" x2  in Toronto, ON
  Provider  provider.l1.omar@test...  (L1, tax-registered, $42.50/unit, Stripe acct)

Journey (each step = a real endpoint call unless noted):
   1. Customer books                POST /jobs/book                       -> PENDING_MATCH
   2. Matching offers the job       [DB seed: OFFERED assignment]         (geo/zone engine stand-in)
   3. Provider accepts              POST /provider/offers/{id}/accept     -> PENDING_APPROVAL + reprice
   4. Customer reviews provider     GET  /jobs/{id}/pending-provider      (price + HST + fee breakdown)
   5. Customer approves provider    POST /jobs/{id}/approve-provider      -> PROVIDER_ACCEPTED
   6. Customer authorizes a hold    POST /jobs/{id}/authorize-payment     -> hold total x1.30 (Stripe)
   7. Provider en route             PATCH /jobs/{id}/update-status        -> PROVIDER_EN_ROUTE
   8. Provider location pings       POST /jobs/provider-location  x3  +   GET /jobs/{id}/tracking (Mapbox)
   9. Provider starts work          PATCH /jobs/{id}/update-status        -> IN_PROGRESS
  10. Before/after photos           [DB set: photos_before/after_json]    (no upload endpoint yet)
  11. Provider completes            PATCH /jobs/{id}/update-status        -> COMPLETED + AUTO-CAPTURE
  12. Verify money                  Stripe PI succeeded, payout waterfall
  13. Receipt / invoice             generated -> printed + saved to file
  14. Customer rates 5*             POST /jobs/{id}/rating                -> Review row

Run::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/simulate_full_journey.py
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, timedelta, timezone
from decimal import ROUND_HALF_UP, Decimal
from pathlib import Path

_BACKEND_ROOT = Path(__file__).resolve().parent.parent
if str(_BACKEND_ROOT) not in sys.path:
    sys.path.insert(0, str(_BACKEND_ROOT))


import asyncpg  # noqa: E402
import stripe  # noqa: E402
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

if not (settings.stripe_secret_key or "").startswith(("sk_test", "rk_test")):
    print("REFUSING TO RUN: not a Stripe TEST key.", file=sys.stderr)
    sys.exit(2)
stripe.api_key = settings.stripe_secret_key

API = settings.api_v1_prefix

PROVIDER_EMAIL = "provider.l1.omar@test.tasker.ca"
CUSTOMER_EMAIL = "bob.singh@test.tasker.ca"
QTY = 2

# Toronto service location (Ontario -> HST 13%)
LAT, LNG = 43.6532, -79.3832
# Provider "drives" from ~2km away toward the customer over three pings.
ROUTE = [(43.6700, -79.3900), (43.6610, -79.3865), (43.6540, -79.3835)]

GREEN, RED, DIM, BOLD, RESET = "\033[92m", "\033[91m", "\033[2m", "\033[1m", "\033[0m"


class SimError(AssertionError):
    pass


def ok(msg: str) -> None:
    print(f"  {GREEN}✓{RESET} {msg}")


def check(cond: bool, msg: str) -> None:
    if not cond:
        raise SimError(msg)


def step(n: int, title: str) -> None:
    print(f"\n{BOLD}[{n:>2}] {title}{RESET}")


def money(cents) -> str:
    return f"${(cents or 0) / 100:,.2f}"


async def run() -> None:
    conn = await asyncpg.connect(_DSN)
    job_id: uuid.UUID | None = None
    review_id = None
    try:
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "wrong DB")

        # --- resolve the real seed actors -------------------------------------
        prov = await conn.fetchrow(
            """SELECT pp.id AS provider_id, pp.user_id, pp.stripe_account_id, pp.tax_registered,
                      u.email AS email, r.task_id, r.rate_cents, r.unit,
                      st.name AS task_name, st.base_price_min_cents, st.base_price_max_cents
               FROM provider_profiles pp
               JOIN users u ON u.id = pp.user_id
               JOIN provider_service_rates r ON r.provider_id = pp.id AND r.is_active
               JOIN service_tasks st ON st.id = r.task_id AND st.is_active
               WHERE u.email = $1 LIMIT 1""",
            PROVIDER_EMAIL,
        )
        check(prov is not None, f"provider {PROVIDER_EMAIL} with an active rate not found")
        customer = await conn.fetchrow("SELECT id, email FROM users WHERE email = $1", CUSTOMER_EMAIL)
        check(customer is not None, f"customer {CUSTOMER_EMAIL} not found")

        provider_id = prov["provider_id"]
        task_id = prov["task_id"]

        print(f"{BOLD}VISP — Full journey simulation{RESET}  {DIM}(visp_prod · Stripe TEST · in-process real API){RESET}")
        print(f"  Customer : {customer['email']}")
        print(f"  Provider : {PROVIDER_EMAIL}  ({money(prov['rate_cents'])}/{prov['unit']}, "
              f"tax_registered={prov['tax_registered']}, acct {prov['stripe_account_id']})")
        print(f"  Service  : {prov['task_name']}  ×{QTY}   @ Toronto, ON")

        token_cust, _ = auth_service.create_access_token(customer["id"])
        token_prov, _ = auth_service.create_access_token(prov["user_id"])
        H_CUST = {"Authorization": f"Bearer {token_cust}"}
        H_PROV = {"Authorization": f"Bearer {token_prov}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://sim", timeout=30.0) as client:

            # 1 --------------------------------------------------------------
            step(1, "Customer books the service")
            # El servicio lo impone el proveedor de la simulación, así que puede
            # exigir detalles, foto o preguntas. Se rellena todo: aquí se simula el
            # RECORRIDO completo, no el formulario, y el catálogo cambia cada semana.
            preguntas = await conn.fetch(
                "SELECT id, answer_type, options FROM service_task_questions "
                "WHERE task_id=$1 AND is_active AND is_required", task_id)
            import json as _json

            respuestas = []
            for q in preguntas:
                opts = _json.loads(q["options"]) if isinstance(q["options"], str) else (q["options"] or [])
                if q["answer_type"] == "SINGLE_CHOICE" and opts:
                    valor = opts[0].get("en", "n/a")
                elif q["answer_type"] == "IMAGE":
                    valor = "https://sim.invalid/foto.jpg"
                else:
                    valor = "simulación"
                respuestas.append({"questionId": str(q["id"]), "answer": valor})

            r = await client.post(f"{API}/jobs/book", headers=H_CUST, json={
                "serviceTaskId": str(task_id),
                "locationAddress": "1 Bloor St E", "locationLat": LAT, "locationLng": LNG,
                "city": "Toronto", "provinceState": "ON", "postalZip": "M4W 1A9", "country": "CA",
                "quantity": QTY,
                "details": "Simulación del recorrido completo.",
                "evidence": ["https://sim.invalid/foto.jpg"],
                "answers": respuestas,
            })
            check(r.status_code in (200, 201), f"book -> {r.status_code}: {r.text}")
            payload = r.json()["data"]
            job_id = uuid.UUID(payload["job"]["id"])
            ref = await conn.fetchval("SELECT reference_number FROM jobs WHERE id=$1", job_id)
            ok(f"job {ref} created, status = PENDING_MATCH")

            # 2 --------------------------------------------------------------
            step(2, "Matching engine offers the job to the provider")
            now = datetime.now(timezone.utc)
            offer = None
            for _ in range(20):  # matching runs on the pending_match transition
                offer = await conn.fetchrow(
                    "SELECT status FROM job_assignments WHERE job_id=$1 AND provider_id=$2",
                    job_id, provider_id)
                if offer is not None:
                    break
                await asyncio.sleep(0.25)
            check(offer is not None,
                  "matching did not offer the job to the provider (check zone/radius seed)")
            check(str(offer["status"]).upper().endswith("OFFERED"),
                  f"assignment is {offer['status']}, expected OFFERED")
            ok("real matching engine offered the job to the provider (OFFERED)")

            # 3 --------------------------------------------------------------
            # Ofertas v2 (2026-08-19): el proveedor OFERTA aportando la magnitud; su
            # tarifa sale del perfil, ya validada contra el rango del catálogo.
            step(3, "Provider makes an offer")
            r = await client.post(
                f"{API}/provider/open-jobs/{job_id}/offer", headers=H_PROV,
                json={"magnitude": 2},
            )
            check(r.status_code == 201, f"offer -> {r.status_code}: {r.text}")
            offer_id = r.json()["data"]["offerId"]
            ok("provider offered from their own rate")

            # 4 --------------------------------------------------------------
            step(4, "Customer reviews the offers")
            r = await client.get(f"{API}/jobs/{job_id}/offers", headers=H_CUST)
            check(r.status_code == 200, f"offers -> {r.status_code}: {r.text}")
            ofertas = r.json()["data"]["offers"]
            check(len(ofertas) >= 1, "no offers to choose from")
            pp = next(o for o in ofertas if o["offerId"] == offer_id)
            subtotal = pp["subtotalCents"]
            tax = pp["serviceTaxCents"] or 0
            fee = pp["serviceFeeCents"] or 0
            total = pp["totalCents"]
            ok(f"{pp['displayName']}  ·  L{pp['level']}  ·  "
               f"{money(pp['rateCents'])}/{pp['unit']} ×{pp['magnitude']}")
            print(f"       {DIM}subtotal {money(subtotal)}  +  HST {money(tax)}"
                  f"  +  service fee {money(fee)}  =  {BOLD}total {money(total)}{RESET}")
            ceiling = int((Decimal(total) * Decimal("1.30")).quantize(Decimal("1"), ROUND_HALF_UP))

            # 5 --------------------------------------------------------------
            step(5, "Customer accepts the offer")
            r = await client.post(
                f"{API}/jobs/{job_id}/offers/{offer_id}/accept", headers=H_CUST)
            check(r.status_code == 200, f"accept-offer -> {r.status_code}: {r.text}")
            st_row = await conn.fetchrow(
                "SELECT status, quoted_price_cents, service_tax_cents, service_fee_cents, "
                "total_charged_cents, commission_amount_cents, provider_payout_cents, "
                "tax_rate_applied, tax_jurisdiction FROM jobs WHERE id=$1", job_id)
            check(str(st_row["status"]).upper().endswith("SCHEDULED"),
                  f"expected SCHEDULED, got {st_row['status']}")
            ok("accepted → SCHEDULED, job priced from the chosen offer")

            # 6 --------------------------------------------------------------
            step(6, "Customer authorizes payment (hold, Stripe manual capture)")
            r = await client.post(f"{API}/jobs/{job_id}/authorize-payment", headers=H_CUST,
                                  json={"paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"authorize-payment -> {r.status_code}: {r.text}")
            auth = r.json()["data"]
            pi_id = auth["paymentIntentId"]
            check(auth["authorizedCents"] == ceiling, f"hold {auth['authorizedCents']} != ceiling {ceiling}")
            pi = stripe.PaymentIntent.retrieve(pi_id)
            check(pi.status == "requires_capture", f"PI should be requires_capture, is {pi.status}")
            ok(f"held {money(ceiling)} on {pi_id}  (total {money(total)} × 1.30 buffer, status={pi.status})")

            # 7 --------------------------------------------------------------
            step(7, "Provider marks EN ROUTE")
            r = await client.patch(f"{API}/jobs/{job_id}/update-status", headers=H_PROV,
                                   json={"status": "en_route"})
            check(r.status_code == 200, f"en_route -> {r.status_code}: {r.text}")
            ok("status = PROVIDER_EN_ROUTE")

            # 8 --------------------------------------------------------------
            step(8, "Provider location pings → customer live tracking (Mapbox)")
            for i, (plat, plng) in enumerate(ROUTE, 1):
                r = await client.post(f"{API}/jobs/provider-location", headers=H_PROV,
                                      json={"latitude": plat, "longitude": plng, "jobId": str(job_id)})
                check(r.status_code == 200, f"location ping {i} -> {r.status_code}: {r.text}")
                t = await client.get(f"{API}/jobs/{job_id}/tracking", headers=H_CUST)
                check(t.status_code == 200, f"tracking {i} -> {t.status_code}: {t.text}")
                td = t.json()["data"]
                ok(f"ping {i}: provider at ({plat:.4f},{plng:.4f})  ·  tracking status={td.get('status')}")

            # 9 --------------------------------------------------------------
            step(9, "Provider arrives & starts work")
            r = await client.patch(f"{API}/jobs/{job_id}/update-status", headers=H_PROV,
                                   json={"status": "in_progress"})
            check(r.status_code == 200, f"in_progress -> {r.status_code}: {r.text}")
            ok("status = IN_PROGRESS  (work started)")

            # 10 -------------------------------------------------------------
            step(10, "Before/after photos uploaded  (persisted on the job)")
            before = [{"url": "https://cdn.tasker/jobs/before1.jpg", "at": now.isoformat()}]
            after = [{"url": "https://cdn.tasker/jobs/after1.jpg", "at": now.isoformat()}]
            await conn.execute(
                "UPDATE jobs SET photos_before_json=$2::jsonb, photos_after_json=$3::jsonb WHERE id=$1",
                job_id, json.dumps(before), json.dumps(after))
            ok("1 before + 1 after photo stored on the job "
               f"{DIM}(note: no dedicated upload endpoint yet — set directly){RESET}")

            # 11 -------------------------------------------------------------
            step(11, "Provider completes the job → payment auto-captured")
            r = await client.patch(f"{API}/jobs/{job_id}/update-status", headers=H_PROV,
                                   json={"status": "completed"})
            check(r.status_code == 200, f"completed -> {r.status_code}: {r.text}")
            fin = await conn.fetchrow(
                "SELECT status, final_price_cents, completed_at, stripe_payment_intent_id, "
                "commission_amount_cents, provider_payout_cents, service_tax_cents, service_fee_cents "
                "FROM jobs WHERE id=$1", job_id)
            check(str(fin["status"]).upper().endswith("COMPLETED"), f"status {fin['status']}")
            check(fin["completed_at"] is not None, "completed_at not set")
            ok("status = COMPLETED, completed_at set")

            # 12 -------------------------------------------------------------
            step(12, "Verify the money (Stripe + payout waterfall)")
            pi = stripe.PaymentIntent.retrieve(pi_id)
            check(pi.status == "succeeded", f"PI status {pi.status} != succeeded")
            check(pi.amount_received == total, f"captured {pi.amount_received} != total {total}")
            commission = fin["commission_amount_cents"] or 0
            payout = total - commission - fee  # provider keeps subtotal+tax minus VISP commission
            ok(f"Stripe PI {pi.status}: captured exactly {money(total)} (released the {money(ceiling - total)} buffer)")
            ok(f"VISP commission {money(commission)}  ·  service fee {money(fee)}  ·  provider net {money(payout)}")

            # 13 -------------------------------------------------------------
            step(13, "Generate receipt / invoice")
            receipt = build_receipt(ref, prov, customer, pp, subtotal, tax, fee, total,
                                    commission, payout, pi_id)
            out_dir = Path(os.environ.get("SIM_OUT_DIR",
                        "/private/tmp/claude-501/-Volumes-MachintoshHD-Cursos-VISP/"
                        "1e5600e8-a258-4cd5-8dbb-3123909432ef/scratchpad"))
            out_dir.mkdir(parents=True, exist_ok=True)
            out_file = out_dir / f"receipt_{ref}.txt"
            out_file.write_text(receipt)
            print(receipt)
            ok(f"receipt saved → {out_file}")

            # 14 -------------------------------------------------------------
            step(14, "Customer rates the job 5★")
            r = await client.post(f"{API}/jobs/{job_id}/rating", headers=H_CUST,
                                  json={"rating": 5, "tags": ["punctual", "professional"],
                                        "feedback": "Great job assembling the bed frame!"})
            check(r.status_code == 200, f"rating -> {r.status_code}: {r.text}")
            review_id = r.json()["data"]["reviewId"]
            rev = await conn.fetchrow("SELECT overall_rating, status FROM reviews WHERE id=$1",
                                      uuid.UUID(review_id))
            check(rev is not None and int(rev["overall_rating"]) == 5, "review not stored as 5★")
            ok(f"review {review_id} — 5★ published")

        print(f"\n{GREEN}{BOLD}★ FULL JOURNEY PASSED — every stage ran with no errors.{RESET}")

    finally:
        print(f"\n{DIM}[cleanup] removing simulation data …{RESET}")
        try:
            if review_id:
                await conn.execute("DELETE FROM reviews WHERE id=$1", uuid.UUID(review_id))
            if job_id:
                await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", job_id)
                await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
                await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)
            print(f"{DIM}[cleanup] visp_prod is clean (seed users/rates untouched).{RESET}")
        finally:
            await conn.close()


def build_receipt(ref, prov, customer, pp, subtotal, tax, fee, total, commission, payout, pi_id) -> str:
    W = 58
    line = "─" * W
    L = []
    L.append("┌" + line + "┐")
    L.append("│" + "TASKER — OFFICIAL RECEIPT".center(W) + "│")
    L.append("├" + line + "┤")
    L.append(f"│ Receipt / Job    {ref:<39}│")
    L.append(f"│ Service          {prov['task_name'][:39]:<39}│")
    L.append(f"│ Provider         {prov['email'][:39]:<39}│")
    L.append(f"│ Customer         {customer['email'][:39]:<39}│")
    L.append("├" + line + "┤")
    L.append("│" + " CUSTOMER CHARGE".ljust(W) + "│")
    q = pp.get("estimatedQuantity")
    rate = money(pp.get("rateCents"))
    L.append(_row(f"  {rate}/{pp.get('pricingUnit')} × {q}   (subtotal)", money(subtotal), W))
    L.append(_row(f"  HST 13% ({pp.get('taxJurisdiction') or 'ON'})", money(tax), W))
    L.append(_row("  Service fee", money(fee), W))
    L.append("│" + " " + "-" * (W - 2) + " │")
    L.append(_row(f"  TOTAL CHARGED", money(total), W, bold=True))
    L.append("├" + line + "┤")
    L.append("│" + " PAYOUT WATERFALL".ljust(W) + "│")
    L.append(_row("  Provider net payout", money(payout), W))
    L.append(_row("  VISP commission", money(commission), W))
    L.append(_row("  Service fee (covers Stripe)", money(fee), W))
    L.append("├" + line + "┤")
    L.append("│" + " TAX NOTE".ljust(W) + "│")
    L.append("│  Merchant of record: the provider. VISP collects &   │")
    L.append("│  remits nothing — the provider declares their own    │")
    L.append("│  earnings & the HST shown above (Uber-style).        │")
    L.append("├" + line + "┤")
    L.append(f"│ Stripe PaymentIntent  {pi_id[:34]:<34}│")
    L.append("└" + line + "┘")
    return "\n".join(L)


def _row(label: str, amount: str, W: int, bold: bool = False) -> str:
    pad = W - len(label) - len(amount) - 1
    inner = f" {label}{' ' * max(1, pad)}{amount} "
    return "│" + inner[:W] + "│"


def main() -> None:
    try:
        asyncio.run(run())
    except BaseException as exc:  # noqa: BLE001
        print(f"\n{RED}SIM FAILED: {type(exc).__name__}: {exc}{RESET}", file=sys.stderr)
        sys.exit(1)


if __name__ == "__main__":
    main()
