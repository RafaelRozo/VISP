# Design Spec — Provider-Set Pricing, Flexible Quantity & Tax/Commission Split

- **Date:** 2026-06-22
- **Branch:** Test-version
- **Status:** Design approved (4 decisions), pending implementation plan (SP-by-SP)
- **Depends on:** VISP for Business B2B layer (companies, company_members, company_service rates pattern), Stripe Connect v2.

---

## 1. Goal

Let each **provider (B2C) and company (B2B)** define **their own price** for the services they offer (e.g. "Luis Lopez Cleaning — $10 CAD/hr + tax"), pick the right **unit of charge** per service (hour / piece / m² / linear-m / visit / quote), let customers **request a flexible quantity** that reconciles to actuals at completion, and compute a correct **tax + commission + payout split** so we always know: what the customer pays, what VISP earns, and what reaches the provider/company.

## 2. Decisions (locked 2026-06-22)

| # | Decision | Choice |
|---|---|---|
| D1 | Who sets the price | **Provider/company, with guardrails** — price validated within the task's `base_price_min/max` (level stays the guardrail; closed catalog preserved). |
| D2 | Scope | **B2C and B2B at the same time** — `provider_service_rates` + reuse/extend `company_service_rates`. |
| D3 | Tax / Merchant of Record (CA) | **Provider/company remits** (Phase 1). VISP calculates + displays + stores tax, routes service-tax to the provider/company. VISP only invoices GST/HST on its own commission (Phase 2). |
| D4 | Time/quantity overrun | **Pre-authorize + capture actual** — Stripe manual capture: authorize `estimate × (1+buffer)`, capture the real amount at close; overage above the ceiling needs customer approval. |

## 3. Non-negotiable business rules respected

- **Closed Task Catalog** — the *unit of charge* is a property of the **task**, not chosen freely by the provider. Provider only sets the *rate* for the task's unit.
- **Levels as business rule** — provider rate is clamped to `service_tasks.base_price_min_cents..base_price_max_cents`. Out-of-range rate = rejected.
- **Provider cannot decide scope** — more *quantity of the same task* is allowed (with customer approval on overage); a *different* service = a new job.
- **Auditable** — every price/tax computation snapshotted immutably (extend `pricing_events`).
- **Additive / non-destructive** — providers' existing flow must keep working; new pricing is opt-in per provider/company per task.

---

## 4. Reto 1 — Unit of charge per service

### 4.1 `pricing_unit` enum (property of the task)

| Unit | Meaning | Provider sets |
|---|---|---|
| `HOURLY` | time-driven labor | $/hour |
| `PER_UNIT` | discrete items (fixtures, furniture) | $/piece |
| `PER_AREA` | surfaces (m²) | $/m² |
| `PER_LINEAR_M` | edges/fences/mouldings | $/linear m |
| `PER_VISIT` / `FLAT_PACKAGE` | fixed visit or package | $ flat |
| `CUSTOM_QUOTE` | large/regulated/emergency (existing `NEGOTIATED`) | quote agreed before start |

### 4.2 Catalog mapping (default unit per category)

| Category | Default unit | Exceptions |
|---|---|---|
| Cleaning (L1) | `HOURLY` | Carpet Steam → `PER_AREA`; Mold/Asbestos/Lead/Biohazard (L3) → `CUSTOM_QUOTE` |
| Assembly | `PER_UNIT` | Cabinet/Structural (L3) → `CUSTOM_QUOTE` |
| Gardening | `HOURLY`/`PER_VISIT` | Lawn mowing → `PER_AREA`; Sod/Pressure-wash (L2) → `PER_AREA`; Edging/Fence/Retaining wall → `PER_LINEAR_M`; Deck/Patio/Pool (L3) → `CUSTOM_QUOTE` |
| Moving & Hauling | `HOURLY` | Junk removal → `FLAT_PACKAGE` (by load) |
| Seasonal | `HOURLY`/`PER_VISIT` | Roofing (L3) → `PER_AREA`/`CUSTOM_QUOTE`; Gutter → `PER_LINEAR_M` |
| Pet Care | `PER_VISIT` | Dog walk 30/60 = fixed duration; sitting → per day |
| Painting | `PER_AREA` | Touch-up → `FLAT_PACKAGE`; full renovation (L3) → `CUSTOM_QUOTE` |
| Errands & Delivery | `HOURLY` + distance fee | use existing `pricing_rules.DISTANCE_ADJUSTMENT` |
| Events | `HOURLY` / `FLAT_PACKAGE` | — |
| Plumbing/Electrical/HVAC (L2) | `PER_UNIT` (fixture/outlet) | — |
| Plumbing/Electrical/HVAC (L3) | `CUSTOM_QUOTE` | already `NEGOTIATED` |
| Plumbing/Electrical/HVAC (L4 emergency) | call-out fee + `HOURLY` + parts | already `EMERGENCY_NEGOTIATED` |

### 4.3 Schema changes

- `service_tasks`: add `pricing_unit` (enum, NOT NULL, default per migration backfill from table above), `allows_quantity` (bool), `min_quantity` (numeric).
- `provider_service_rates` (B2C): `(id, provider_id FK, task_id FK, unit, rate_cents, min_charge_cents, is_active, created_at, updated_at)`, unique `(provider_id, task_id)`.
- `company_service_rates` (B2B): same shape keyed by `company_id`. (Reuse / extend the existing `company_services` enablement table from B2B SP1.)
- **Validation:** on insert/update, clamp `rate_cents` to `[base_price_min_cents, base_price_max_cents]` of the task; reject 422 with `price_out_of_range` (4xx, not 5xx — Cloudflare rule).

### 4.4 Phasing
- **Phase 1 units:** `HOURLY`, `PER_UNIT`, `FLAT_PACKAGE`, `CUSTOM_QUOTE` (≈80% of catalog).
- **Phase 2 units:** `PER_AREA`, `PER_LINEAR_M`.

---

## 5. Reto 2 — Flexible quantity & overrun (D4)

Customer declares an **estimated quantity** at booking → this is an **estimate, not the final charge**. Reconciled to actuals at close, gated by customer approval for overage.

### Flow
1. **Booking:** customer picks estimated qty (hours / m² / pieces). `quoted_price_cents = qty × rate` (respect `min_charge_cents`).
2. **Authorize (Stripe manual capture):** authorize `quoted × (1 + buffer)` (default buffer **30%**, configurable). Card held, not charged.
3. **Execution:** provider marks start/stop (HOURLY → reuse `started_at`/`completed_at`/`actual_duration_minutes`) or confirms real qty (area/pieces) with photo/note evidence.
4. **Close & capture:**
   - `actual ≤ authorized` → **capture actual** (rounding policy: HOURLY rounds to 15 min, minimum 1–2 hr configurable).
   - `actual > authorized` → **customer approves overage** in-app (push + confirm) before capture; if not approved, capture up to ceiling, remainder → support/dispute.
5. **Scope guard:** extra quantity of the *same* task = allowed with approval; a *different* service = new job (rule preserved).

### Schema/flow changes
- `jobs`: add `estimated_quantity`, `actual_quantity`, `pricing_unit` (snapshot from task), `authorized_amount_cents`, `capture_buffer_pct`, `overage_approved_at`.
- Stripe: switch from immediate `PaymentIntent` to **`capture_method=manual`** (authorize) → capture at completion. Incremental auth if overage approved beyond ceiling.

---

## 6. Reto 3 — Tax + commission + payout split (D3)

### 6.1 Two tax layers (Canada)
- **Layer A — service tax (customer → provider):** GST/HST/PST/QST by province on the subtotal. Provider/company is MoR and remits (D3). Small-supplier threshold $30k CAD → provider may be non-registered; store a `tax_registered` flag per provider/company and only add tax when registered.
- **Layer B — tax on VISP commission (VISP → provider):** GST/HST on the platform fee (VISP's B2B service is taxable). **Phase 2** — flag now, implement later.

### 6.2 Money waterfall (per job, snapshotted in `pricing_events`)
```
subtotal_cents          = qty × rate                       (provider-defined)
+ service_tax_cents     = subtotal × tax_rate              (GST/HST/PST by province; 0 if provider not tax-registered)
+ tip_cents
= total_charged_cents    ← customer pays

From subtotal:
  platform_fee_cents     = subtotal × commission_rate       (VISP earns; existing commission_rate by level)
  (Phase 2) platform_fee_tax_cents = platform_fee × gst_rate
  provider_payout_cents  = subtotal − platform_fee_cents
service_tax_cents        → routed to provider/company (they remit)
```

### 6.3 Schema changes
- `jobs` + mirror in `pricing_events` (immutable): `subtotal_cents`, `tax_country`, `tax_region`, `tax_rate` (Numeric), `service_tax_cents`, `total_charged_cents`, `tax_breakdown_json` (GST/PST split for invoice).
- Keep existing `commission_rate`, `commission_amount_cents`, `provider_payout_cents`, `tip_cents`.
- `provider_profiles` / `companies`: add `tax_registered` (bool), `tax_number` (GST/HST #, nullable).

### 6.4 Stripe mechanism
- Migrate to **destination charge with `application_fee_amount`** = `platform_fee_cents` (+ Phase 2 its tax) → commission lands in VISP balance; remainder transfers to the provider/company Connect account automatically.
- Reuse the B2B `resolve_payout_account()` to route destination to company vs provider.
- Tax computation: **Phase 1** = own province rate table (CA provinces + US states placeholder); **Phase 2** = evaluate Stripe Tax.

---

## 7. Proposed sub-projects (build order)

- **PP1 · Catalog units** — `pricing_unit` enum + backfill migration from §4.2; `service_tasks` fields. No UI.
- **PP2 · Provider/company rate tables** — `provider_service_rates` + `company_service_rates`; CRUD endpoints with guardrail validation; reuse B2B services enablement.
- **PP3 · Tax engine** — province rate table, `tax_registered` flags, money-waterfall computation in pricing service, extend `pricing_events`.
- **PP4 · Booking quantity + Stripe auth/capture** — estimate flow, manual-capture migration, overage approval gate, webhook updates.
- **PP5 · UI** — provider/company "set my rates" screens (mobile + `/business` web); customer quantity picker + overage approval; admin/console visibility.

Order: PP1 → PP2 → PP3 → PP4 → PP5. PP3 and PP4 can overlap after PP2.

## 8. Open items needing external input

1. **Legal MoR confirmation** with an accountant before PP3 ships (D3 Phase 1 assumes provider remits).
2. **Capture buffer %** default (proposed 30%) and **HOURLY rounding/minimum** policy (proposed 15-min, 1–2 hr min) — product decision.
3. **US tax** handling (sales tax by state) — Phase 2.
4. Whether the existing `pricing_rules` engine (surge/peak/distance multipliers) still stacks **on top** of provider-set rates, or is bypassed when a provider rate exists. (Recommendation: provider rate = base; surcharges like distance/holiday may still stack; demand-surge OFF for provider-priced jobs.)
