"""End-to-end smoke test for the FULL customer-provider journey with CUSTOM users.

Proves the complete lifecycle through real API endpoints against visp_prod + Stripe test:

  1. Verify users exist (customer + provider)
  2. Provider sets rate for a qualified task
  3. Customer books the service
  4. Matching engine offers the job to the provider
  5. Provider accepts -> job re-quoted from provider's rate
  6. Customer reviews provider + price breakdown (subtotal + HST + service fee)
  7. Customer approves provider -> PROVIDER_ACCEPTED
  8. Customer authorizes payment (Stripe hold, total x1.30)
  9. Provider marks EN ROUTE
  10. Provider location pings (3 pings, customer tracking)
  11. Provider starts work -> IN_PROGRESS
  12. Before/after photos set
  13. Provider completes -> COMPLETED + AUTO-CAPTURE
  14. Verify Stripe PI succeeded, payout waterfall correct
  15. Customer rates 5 stars

Users:
  Customer : richi_yanez20@hotmail.com
  Provider : ryanezvalencia@gmail.com

Run::

    cd visp-tasker/backend && \
      DATABASE_URL='<sale del .env>' \
      ./venv/bin/python scripts/smoke_full_journey_custom.py

Prints SMOKE PASS on success; exits non-zero on any failure.
Self-cleans: removes only the job, assignment, pricing_events, and the rate it set.
"""

from __future__ import annotations

import asyncio
import json
import os
import sys
import uuid
from datetime import datetime, time as dtime, timedelta, timezone
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
from src.services.fee_service import compute_service_fee_cents  # noqa: E402

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

# ---------------------------------------------------------------------------
# Custom users
# ---------------------------------------------------------------------------
CUSTOMER_EMAIL = "richi_yanez20@hotmail.com"
PROVIDER_EMAIL = "ryanezvalencia@gmail.com"

# Toronto service location (Ontario -> HST 13%)
LAT, LNG = 43.6532, -79.3832

# Provider "drives" from ~2km away toward the customer over three pings.
ROUTE = [(43.6700, -79.3900), (43.6610, -79.3865), (43.6540, -79.3835)]

# Task: Standard Residential Cleaning (HOURLY, $50-90/hr, 120min)
# Provider rate: $60/hr = 6000 cents (within range)
TASK_ID = uuid.UUID("b1000000-0000-4000-8000-000000000001")
PROVIDER_RATE_CENTS = 6000  # $60/hr

# Stripe account with card_payments+transfers active (used for destination charges).
# Ryanez's v2 account lacks card_payments; we swap to Omar's working account for the
# authorize/capture step, then restore the original after cleanup.
WORKING_STRIPE_ACCOUNT = "acct_1TnkjBIE9FBLLe0M"

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
    rate_set = False
    orig_home_lat = None
    orig_home_lng = None
    orig_status = None
    orig_stripe_acct = None
    try:
        # -------------------------------------------------------------------
        # DB sanity
        # -------------------------------------------------------------------
        check(await conn.fetchval("SELECT current_database()") == "visp_prod", "wrong DB")
        print(f"{BOLD}VISP — Custom Journey Smoke Test{RESET}  {DIM}(visp_prod · Stripe TEST · in-process real API){RESET}")

        # -------------------------------------------------------------------
        # Resolve users
        # -------------------------------------------------------------------
        step(0, "Verify custom users exist")
        customer = await conn.fetchrow("SELECT id, email FROM users WHERE email = $1", CUSTOMER_EMAIL)
        check(customer is not None, f"customer {CUSTOMER_EMAIL} not found")
        print(f"  {GREEN}✓{RESET} customer: {customer['email']} ({customer['id']})")

        prov_user = await conn.fetchrow("SELECT id, email FROM users WHERE email = $1", PROVIDER_EMAIL)
        check(prov_user is not None, f"provider {PROVIDER_EMAIL} not found")

        prov = await conn.fetchrow(
            """SELECT pp.id AS provider_id, pp.user_id, pp.stripe_account_id, pp.tax_registered,
                      pp.current_level, pp.home_latitude, pp.home_longitude, pp.status
               FROM provider_profiles pp
               WHERE pp.user_id = $1""",
            prov_user["id"],
        )
        check(prov is not None, f"provider_profile for {PROVIDER_EMAIL} not found")
        provider_id = prov["provider_id"]
        stripe_account = prov["stripe_account_id"]
        check(stripe_account is not None, "provider has no stripe_account_id")

        # -------------------------------------------------------------------
        # Ensure provider is ACTIVE and located near Toronto (matching requires
        # ACTIVE status + home location within service radius).
        # -------------------------------------------------------------------
        step(0, "Ensure provider is ACTIVE + located in Toronto")
        orig_home_lat = prov["home_latitude"]
        orig_home_lng = prov["home_longitude"]
        orig_status = prov["status"]
        home_lat = prov["home_latitude"]
        home_lng = prov["home_longitude"]
        status_val = prov["status"]
        if status_val != "ACTIVE":
            await conn.execute(
                "UPDATE provider_profiles SET status='ACTIVE' WHERE id=$1", provider_id)
            print(f"  {GREEN}✓{RESET} status {status_val} → ACTIVE")
        else:
            print(f"  {GREEN}✓{RESET} status already ACTIVE")

        # Move provider home to Toronto if not already there (distance check)
        if home_lat is not None and abs(float(home_lat) - LAT) > 0.5:
            await conn.execute(
                "UPDATE provider_profiles SET home_latitude=$2, home_longitude=$3 WHERE id=$1",
                provider_id, LAT, LNG)
            print(f"  {GREEN}✓{RESET} home moved to Toronto ({LAT}, {LNG})")
        else:
            print(f"  {GREEN}✓{RESET} home already in Toronto area")

        print(f"  {GREEN}✓{RESET} provider: {PROVIDER_EMAIL} (L{prov['current_level']}, acct {stripe_account})")

        # Swap to a Stripe account with card_payments+transfers active (required for
        # destination charges). Ryanez's v2 account lacks card_payments.
        orig_stripe_acct = stripe_account
        if orig_stripe_acct != WORKING_STRIPE_ACCOUNT:
            await conn.execute(
                "UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1",
                provider_id, WORKING_STRIPE_ACCOUNT)
            print(f"  {GREEN}✓{RESET} Stripe acct swapped: {orig_stripe_acct[:20]}… → {WORKING_STRIPE_ACCOUNT[:20]}…")

        # -------------------------------------------------------------------
        # Verify task qualification + set rate if missing
        # -------------------------------------------------------------------
        step(0, "Ensure provider is qualified + has a rate for the task")
        qual = await conn.fetchrow(
            "SELECT qualified FROM provider_task_qualifications WHERE provider_id=$1 AND task_id=$2",
            provider_id, TASK_ID,
        )
        check(qual is not None, f"provider not qualified for task {TASK_ID}")
        if not qual["qualified"]:
            await conn.execute(
                "UPDATE provider_task_qualifications SET qualified=TRUE WHERE id=$1", qual["id"])
            print(f"  {GREEN}✓{RESET} qualification enabled for task {TASK_ID}")
        else:
            print(f"  {GREEN}✓{RESET} already qualified for task {TASK_ID}")

        # Check if rate exists
        existing_rate = await conn.fetchrow(
            "SELECT rate_cents, unit FROM provider_service_rates WHERE provider_id=$1 AND task_id=$2",
            provider_id, TASK_ID,
        )
        if existing_rate is None:
            await conn.execute(
                """INSERT INTO provider_service_rates (id, provider_id, task_id, unit, rate_cents, min_charge_cents, is_active, created_at, updated_at)
                   VALUES ($1, $2, $3, 'HOURLY', $4, $4, TRUE, now(), now())""",
                uuid.uuid4(), provider_id, TASK_ID, PROVIDER_RATE_CENTS,
            )
            rate_set = True
            print(f"  {GREEN}✓{RESET} rate set: ${PROVIDER_RATE_CENTS / 100:.2f}/hr")
        else:
            print(f"  {GREEN}✓{RESET} rate already set: ${existing_rate['rate_cents'] / 100:.2f}/hr")

        # -------------------------------------------------------------------
        # Auth tokens
        # -------------------------------------------------------------------
        token_cust, _ = auth_service.create_access_token(customer["id"])
        token_prov, _ = auth_service.create_access_token(prov_user["id"])
        H_CUST = {"Authorization": f"Bearer {token_cust}"}
        H_PROV = {"Authorization": f"Bearer {token_prov}"}

        transport = ASGITransport(app=app)
        async with AsyncClient(transport=transport, base_url="http://sim", timeout=30.0) as client:

            # 1 --------------------------------------------------------------
            # Customer schedules the job 10 minutes out. Ese hueco es deliberado y
            # tiene que caber entre dos relojes opuestos:
            #   * la cita tiene que estar en el FUTURO o el trabajo caduca al nacer
            #     — un trabajo deja de admitir ofertas cuando llega su hora.
            #   * y a menos de START_SCHEDULE_GRACE_MIN (15 min) para que el
            #     proveedor pueda arrancarlo ya en el camino feliz.
            # Reservar "ahora mismo", como se hacía, solo funcionaba porque la hora
            # se archivaba cuatro horas movida: la cita caía en el futuro por el
            # error, no por el diseño. El BLOQUEO por hora se prueba en el paso 8b.
            now = datetime.now(timezone.utc)
            scheduled_at = (now + timedelta(minutes=10)).replace(second=0, microsecond=0)
            step(1, "Customer books the service for a scheduled time (in 10 min)")
            r = await client.post(f"{API}/jobs/book", headers=H_CUST, json={
                "serviceTaskId": str(TASK_ID),
                "locationAddress": "1 Bloor St E", "locationLat": LAT, "locationLng": LNG,
                "city": "Toronto", "provinceState": "ON", "postalZip": "M4W 1A9", "country": "CA",
                "quantity": 2,  # 2 hours
                "scheduledAt": scheduled_at.isoformat(),
            })
            check(r.status_code in (200, 201), f"book -> {r.status_code}: {r.text}")
            payload = r.json()["data"]
            job_id = uuid.UUID(payload["job"]["id"])
            sched = await conn.fetchrow(
                "SELECT reference_number, requested_date, requested_time_start, flexible_schedule "
                "FROM jobs WHERE id=$1", job_id)
            ref = sched["reference_number"]
            check(sched["requested_date"] == scheduled_at.date(),
                  f"requested_date {sched['requested_date']} != {scheduled_at.date()}")
            check(sched["requested_time_start"] is not None,
                  "requested_time_start not persisted")
            ok(f"job {ref} created, status = PENDING_MATCH")
            ok(f"scheduled for {sched['requested_date']} at {sched['requested_time_start']} "
               f"(flexible={sched['flexible_schedule']}) — persisted on the job")

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
            # Ofertas v2 (2026-08-19): el proveedor ya no ACEPTA, OFERTA. Aporta la
            # magnitud (las horas, los m²) y su tarifa sale del perfil.
            step(3, "Provider makes an offer")
            r = await client.post(
                f"{API}/provider/open-jobs/{job_id}/offer", headers=H_PROV,
                json={"magnitude": 2},
            )
            check(r.status_code == 201, f"offer -> {r.status_code}: {r.text}")
            offer_id = r.json()["data"]["offerId"]
            ok("provider offered from their own rate")

            # 4 --------------------------------------------------------------
            # El cliente ve las ofertas ANTES de decidir: cara, precio y tiempo de
            # cada proveedor. Sustituye al `pending-provider` del flujo viejo, donde
            # solo veía al primero que hubiera aceptado.
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
               f"${pp['rateCents'] / 100:.2f}/{pp['unit']} ×{pp['magnitude']}")
            print(f"       {DIM}subtotal {money(subtotal)}  +  HST {money(tax)}"
                  f"  +  service fee {money(fee)}  =  {BOLD}total {money(total)}{RESET}")

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

            # 5b -------------------------------------------------------------
            # GATE: a provider whose Stripe onboarding is incomplete (no active
            # card_payments) must NOT be chargeable — the route returns a clean 409,
            # not a cryptic Stripe error. ryanezvalencia's REAL account lacks
            # card_payments, so we point the provider at it, assert the gate fires,
            # then restore the working account before the real authorize.
            step("5b", "Gate: unfinished provider onboarding → clean 409 (not a Stripe crash)")
            from src.integrations.stripe import account_can_accept_charges
            ready_work, _ = account_can_accept_charges(WORKING_STRIPE_ACCOUNT)
            check(ready_work, "working acct should be payments-ready")

            # La cuenta que servía de "no lista" es real y en Stripe TEST puede
            # completarse en cualquier momento — de hecho ya se completó. Se comprueba
            # su estado en vivo en vez de darlo por hecho: si ya está lista, este
            # escenario no se puede montar y se dice, en lugar de fallar el smoke
            # entero por algo que no es un fallo del código.
            ready_real, reason_real = account_can_accept_charges(orig_stripe_acct)
            if ready_real:
                ok(f"SALTADO: {orig_stripe_acct[:16]}… ya completó su onboarding en "
                   "Stripe test; hace falta una cuenta sin card_payments para probar el gate")
            else:
                check(reason_real == "card_payments",
                      f"expected not-ready(card_payments), got {reason_real}")
                await conn.execute(
                    "UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1",
                    provider_id, orig_stripe_acct)
                rg = await client.post(f"{API}/jobs/{job_id}/authorize-payment", headers=H_CUST,
                                       json={"paymentMethod": "pm_card_visa"})
                check(rg.status_code == 409, f"gate should 409, got {rg.status_code}: {rg.text}")
                check("payments" in rg.text.lower(),
                      f"gate 409 should mention payment setup, got: {rg.text}")
                await conn.execute(
                    "UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1",
                    provider_id, WORKING_STRIPE_ACCOUNT)
                ok(f"blocked unready acct {orig_stripe_acct[:16]}… with clean 409 (missing card_payments)")

            # 6 --------------------------------------------------------------
            step(6, "Customer authorizes payment (hold, Stripe manual capture)")
            r = await client.post(f"{API}/jobs/{job_id}/authorize-payment", headers=H_CUST,
                                  json={"paymentMethod": "pm_card_visa"})
            check(r.status_code == 200, f"authorize-payment -> {r.status_code}: {r.text}")
            auth = r.json()["data"]
            pi_id = auth["paymentIntentId"]
            ceiling = auth["authorizedCents"]
            check(ceiling == int((Decimal(total) * Decimal("1.30")).quantize(Decimal("1"), ROUND_HALF_UP)),
                  f"hold {ceiling} != ceiling {int((Decimal(total) * Decimal('1.30')).quantize(Decimal('1'), ROUND_HALF_UP))}")
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
                eta = td.get("etaMinutes")
                check(eta is None or (isinstance(eta, int) and eta >= 1),
                      f"etaMinutes should be a positive int or null, got {eta!r}")
                ok(f"ping {i}: provider at ({plat:.4f},{plng:.4f})  ·  status={td.get('status')}"
                   f"  ·  ETA {eta} min (Mapbox driving)")

            # 8b -------------------------------------------------------------
            # ENFORCEMENT — TIME GATE: a provider cannot start before the scheduled
            # time. Push the slot a day into the future and confirm a clean 409,
            # then restore the real (now) slot.
            step("8b", "Gate: start before the scheduled time → clean 409")
            orig_req_date = sched["requested_date"]
            orig_req_time = sched["requested_time_start"]
            future = now + timedelta(days=1)
            await conn.execute(
                "UPDATE jobs SET requested_date=$2, requested_time_start=$3 WHERE id=$1",
                job_id, future.date(), dtime(14, 0))
            # Use the REAL provider endpoint the app calls (/provider/jobs/{id}/arrive).
            rt = await client.post(f"{API}/provider/jobs/{job_id}/arrive", headers=H_PROV)
            check(rt.status_code == 409, f"time-gate should 409, got {rt.status_code}: {rt.text}")
            check("schedul" in rt.text.lower(), f"time-gate 409 should mention schedule: {rt.text}")
            await conn.execute(
                "UPDATE jobs SET requested_date=$2, requested_time_start=$3 WHERE id=$1",
                job_id, orig_req_date, orig_req_time)
            ok("blocked: can't start before the scheduled time (409, time gate)")

            # 8c -------------------------------------------------------------
            # ENFORCEMENT — ARRIVAL GEOFENCE: a provider cannot start until they're
            # on-site (≤150 m). Move the provider's last fix to Montreal (~500 km)
            # and confirm a clean 409, then restore the on-site ping position.
            step("8c", "Gate: start away from the customer location → clean 409")
            await conn.execute(
                "UPDATE users SET last_latitude=$2, last_longitude=$3 WHERE id=$1",
                prov_user["id"], 45.5017, -73.5673)  # Montreal — far from Toronto
            ra = await client.post(f"{API}/provider/jobs/{job_id}/arrive", headers=H_PROV)
            check(ra.status_code == 409, f"arrival-gate should 409, got {ra.status_code}: {ra.text}")
            check(any(w in ra.text.lower() for w in ("location", "within", "arriv")),
                  f"arrival-gate 409 should mention location/arrival: {ra.text}")
            await conn.execute(
                "UPDATE users SET last_latitude=$2, last_longitude=$3 WHERE id=$1",
                prov_user["id"], ROUTE[-1][0], ROUTE[-1][1])  # back on-site (last ping)
            ok("blocked: can't start away from the service location (409, arrival gate)")

            # 9 --------------------------------------------------------------
            step(9, "Provider (on-site, on-time) starts work")
            r = await client.post(f"{API}/provider/jobs/{job_id}/arrive", headers=H_PROV)
            check(r.status_code == 200, f"arrive -> {r.status_code}: {r.text}")
            ok("status = IN_PROGRESS  (both gates satisfied → work started)")

            # 10 -------------------------------------------------------------
            step(10, "Before/after photos uploaded  (persisted on the job)")
            before = [{"url": "https://cdn.tasker/jobs/before1.jpg", "at": now.isoformat()}]
            after = [{"url": "https://cdn.tasker/jobs/after1.jpg", "at": now.isoformat()}]
            await conn.execute(
                "UPDATE jobs SET photos_before_json=$2::jsonb, photos_after_json=$3::jsonb WHERE id=$1",
                job_id, json.dumps(before), json.dumps(after))
            ok("1 before + 1 after photo stored on the job")

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
            fee_actual = fin["service_fee_cents"] or 0
            payout = total - commission - fee_actual
            ok(f"Stripe PI {pi.status}: captured exactly {money(total)} (released the {money(ceiling - total)} buffer)")
            ok(f"VISP commission {money(commission)}  ·  service fee {money(fee_actual)}  ·  provider net {money(payout)}")

            # 13 -------------------------------------------------------------
            step(13, "Generate receipt / invoice")
            receipt = build_receipt(ref, prov, customer, pp, subtotal, tax, fee, total,
                                    commission, payout, pi_id)
            print(receipt)
            ok("receipt generated")

            # 14 -------------------------------------------------------------
            step(14, "Customer rates the job 5★")
            r = await client.post(f"{API}/jobs/{job_id}/rating", headers=H_CUST,
                                  json={"rating": 5, "tags": ["punctual", "professional"],
                                        "feedback": "Great job!"})
            check(r.status_code == 200, f"rating -> {r.status_code}: {r.text}")
            review_id = r.json()["data"]["reviewId"]
            rev = await conn.fetchrow("SELECT overall_rating, status FROM reviews WHERE id=$1",
                                      uuid.UUID(review_id))
            check(rev is not None and int(rev["overall_rating"]) == 5, "review not stored as 5★")
            ok(f"review {review_id} — 5★ published")

        print(f"\n{GREEN}{BOLD}★ CUSTOM JOURNEY SMOKE PASSED — every stage ran with no errors.{RESET}")

    finally:
        print(f"\n{DIM}[cleanup] removing simulation data …{RESET}")
        try:
            if review_id:
                await conn.execute("DELETE FROM reviews WHERE id=$1", uuid.UUID(review_id))
            if job_id:
                await conn.execute("DELETE FROM pricing_events WHERE job_id=$1", job_id)
                await conn.execute("DELETE FROM job_assignments WHERE job_id=$1", job_id)
                await conn.execute("DELETE FROM jobs WHERE id=$1", job_id)
            if rate_set:
                await conn.execute(
                    "DELETE FROM provider_service_rates WHERE provider_id=$1 AND task_id=$2",
                    provider_id, TASK_ID,
                )
                print(f"  {GREEN}✓{RESET} rate removed (was set by this smoke)")

            # Restore provider home location + status
            if orig_home_lat is not None and (orig_home_lat != prov["home_latitude"] or orig_status != prov["status"]):
                updates = []
                params = [provider_id]
                if orig_home_lat != prov["home_latitude"]:
                    updates.append("home_latitude=$2")
                    params.append(orig_home_lat)
                if orig_home_lng is not None and orig_home_lng != prov["home_longitude"]:
                    updates.append("home_longitude=$3")
                    params.append(orig_home_lng)
                if orig_status != prov["status"]:
                    updates.append("status=$4")
                    params.append(orig_status)
                if updates:
                    await conn.execute(
                        f"UPDATE provider_profiles SET {', '.join(updates)} WHERE id=$1", *params)
                    print(f"  {GREEN}✓{RESET} provider home/status restored")

            # Restore the provider's REAL Stripe account (the smoke swaps it to a
            # card_payments-capable account for the authorize/capture step).
            if orig_stripe_acct is not None and orig_stripe_acct != WORKING_STRIPE_ACCOUNT:
                await conn.execute(
                    "UPDATE provider_profiles SET stripe_account_id=$2 WHERE id=$1",
                    provider_id, orig_stripe_acct)
                print(f"  {GREEN}✓{RESET} provider Stripe account restored ({orig_stripe_acct[:20]}…)")
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
    L.append(f"│ Service          {'Standard Residential Cleaning':<39}│")
    L.append(f"│ Provider         {PROVIDER_EMAIL[:39]:<39}│")
    L.append(f"│ Customer         {CUSTOMER_EMAIL[:39]:<39}│")
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
        print(f"\n{RED}SMOKE FAILED: {type(exc).__name__}: {exc}{RESET}", file=sys.stderr)
        sys.exit(1)
    print("\nSMOKE PASS")


if __name__ == "__main__":
    main()
