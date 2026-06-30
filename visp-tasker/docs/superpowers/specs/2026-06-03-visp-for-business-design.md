# VISP for Business — Design Spec

**Date:** 2026-06-03
**Status:** Approved (overall decomposition + SP1 foundation). SP2–SP4 are high-level here; each gets its own spec before implementation.
**Dev database:** `Visp2026` on `192.168.1.94:5432` (separate from production `visp_tasker`; all SP1 schema changes target Visp2026 until promoted).

## 1. Goal

Add a B2B layer on top of the existing VISP marketplace so **companies** can register, get verified, and have their **collaborators** perform jobs through the existing app — with payment flowing to the company. Reuse existing infrastructure; do not build separate apps.

## 2. Scope decomposition (build order)

The work is too large for one spec. It is split into sub-projects, built in order. Each SP after SP1 gets its own spec.

- **SP1 · Backend multi-tenant foundation** (this spec, detailed). Everything depends on it.
- **SP2 · `/business` web** — new route tree (register + login + company dashboard) **inside the existing `admin/` Vite app**, with standard VISP user auth (not admin JWT). Linked from the landing via a "Register for Business" button. Company dashboard: VISP summaries (jobs done, money earned), enable services (checkboxes), manage members + generate invite codes.
- **SP3 · `/console` validation section** — new "Businesses" section in the existing internal admin (`/admin`). Lists pending company applications; review each document; approve / reject / flag-what's-wrong. Reuses the existing `Documents` approve/reject-with-note UX.
- **SP4 · Mobile** — (a) "Register with company code" entry under Create Account (code-based registration only; afterwards collaborators use the **standard login**), (b) new role "Collaborator of [company]", (c) collaborators see only company-enabled services, (d) work-assignment flow (supervisor accepts → assigns to a collaborator who holds the required cert → notify → schedule → customer sees assignee), (e) job payout routed to the company Stripe account.

**Not separate apps:** `/console` stays the internal dashboard (just gains a Businesses section). `/business` is a new route tree in the same web app. The landing is the React landing already implemented in `admin/` (the `newdesign` design).

## 3. Role model (decision: Option A)

- Company owner and collaborators are **normal VISP users** (`users` table), linked to a `Company` via a `company_members` row carrying a company role: `admin` | `supervisor` | `collaborator`.
- A **collaborator reuses the existing `provider_profiles`** machinery (level, matching, credentials) but is **scoped to the services the company enabled**.
- **Payouts go to the company's Stripe Connect account.** Collaborators have **no individual `stripe_account_id`**; when a company job is paid, the transfer targets `companies.stripe_account_id`. This reuses the existing Stripe Connect v2 onboarding flow, applied to the company instead of an individual.

## 4. SP1 — data model (new tables, target DB `Visp2026`)

Mirror existing conventions: UUID PKs via `gen_random_uuid()`, `created_at`/`updated_at`, async SQLAlchemy models under `backend/src/models/`, raw SQL migration under `backend/migrations/`.

1. **`companies`** — `id`, legal_name, trade_name (nullable), business_address, phone, email, website (nullable), `status` enum `draft|pending_review|validated|rejected` (default `draft`), `stripe_account_id` (nullable), `rejection_reason` (nullable), timestamps.
2. **`company_members`** — `id`, `company_id` FK→companies (cascade), `user_id` FK→users (cascade), `role` enum `admin|supervisor|collaborator`, `status` enum `active|invited|disabled`, timestamps. Unique (`company_id`, `user_id`).
3. **`company_documents`** — mirrors `ProviderCredential`: `id`, `company_id` FK, `doc_type` enum (the 10 categories — see §5), `document_url`, `document_hash`, `status` enum `pending|approved|rejected` (default `pending`), `verified_by` (nullable, admin user), `verified_at` (nullable), `rejection_reason` (nullable), timestamps. Uploads via existing `file_service.save_upload_file`.
4. **`company_services`** — `id`, `company_id` FK, `task_id` FK→service_tasks (or `category_id`), timestamps. Unique (`company_id`, `task_id`). "Enable all" inserts every task in the catalog. Collaborators only see services present here.
5. **`company_invites`** — `id`, `company_id` FK, `email`, `role` enum (default `collaborator`), `code` (short, unique), `status` enum `pending|redeemed|expired`, `expires_at`, `redeemed_by` (nullable user), timestamps. **Single-use, bound to the invited email, with expiry** (per approved decision). Admin adds an email → code generated → collaborator redeems it during mobile registration → their user is linked to the company with the invite's role.

## 5. Document categories (`doc_type` enum)

Canada-focused. From the business requirements:
`legal_info`, `business_registration` (Articles of Incorporation / Master Business Licence / Business Name Registration / Sole Proprietorship / Partnership / Corporation Profile Report), `business_number_tax` (CRA Business Number, GST/HST), `owner_id` (driver's licence / passport / provincial ID), `authority_proof` (authorization letter / corporate resolution / signed internal doc), `address_proof` (utility bill / lease / bank statement / govt letter / insurance / business licence), `banking` (void cheque / direct deposit form / bank confirmation), `insurance` (general/professional liability, WSIB clearance, contractor insurance), `license_cert` (trade licences / professional certs), `operational_profile` (services, zones, hours, pricing, work photos, logo, description, policies — profile data, not strictly a legal doc).

## 6. SP1 — endpoints (base CRUD)

Under `/api/v1`, standard-user auth unless noted. Exact shapes finalized in the implementation plan.

- `POST /companies` — create company (status `draft`), creator becomes `admin` member.
- `GET /companies/me` — the caller's company + members + status.
- `POST /companies/me/documents` — upload a document (multipart → file_service).
- `POST /companies/me/submit` — move `draft` → `pending_review`.
- `PUT /companies/me/services` — set enabled services (list of task_ids, or "all").
- `POST /companies/me/invites` — create invite (email + role) → returns code.
- `POST /companies/redeem-invite` — redeem code (mobile registration); links user as member.
- **Admin (admin JWT):** `GET /admin/companies?status=pending_review`, `GET /admin/companies/{id}`, `POST /admin/companies/{id}/documents/{doc_id}/approve`, `.../reject` (with reason), `POST /admin/companies/{id}/validate`, `.../reject`.

## 7. What SP1 explicitly does NOT include

- The supervisor→collaborator **job-assignment flow** and **payout routing in the job lifecycle** (SP4 — model is prepared to support it, behavior is not built here).
- Any `/business` web UI (SP2) or `/console` UI (SP3) — SP1 is backend + schema + endpoints only.
- Mobile UI (SP4).

## 8. Reuse / conventions

- Document review: reuse `ProviderCredential` status pattern + admin `Documents` page approve/reject-with-note UX.
- File upload: `backend/src/services/file_service.py`.
- Company Stripe Connect: reuse the v2 onboarding (`connectV2Service.py`) applied to a company.
- Migrations: raw SQL in `backend/migrations/` (next sequential number), applied to `Visp2026`.
- Backend deploy: user applies migration / restarts; Claude lists changed files.

## 9. Open items for the implementation plan

- Final endpoint request/response schemas (Pydantic).
- Whether `company_services` keys on `task_id` vs `category_id` (leaning `task_id` for level/cert precision).
- Migration number + whether to also seed an enum type for `doc_type`.
