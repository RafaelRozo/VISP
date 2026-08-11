# VISP/Tasker Platform — CLAUDE.md

## Project Overview
VISP (Verified Independent Service Provider), marketed as **Tasker**, is a next-generation home services marketplace. iOS mobile app (React Native) + Web Dashboard + Python/FastAPI backend + PostgreSQL database. Target markets: Canada (Ontario focus) & USA.

## Tech Stack
- **Backend**: Python 3.11+, FastAPI, SQLAlchemy, PostgreSQL (RDS), Redis, Celery, Elasticsearch
- **Mobile**: React Native (iOS-first), Zustand, react-native-keychain, Socket.io
- **Infrastructure**: AWS (ECS Fargate, Lambda, API Gateway, S3, CloudFront, Secrets Manager)
- **CI/CD**: GitHub Actions
- **Maps**: Google Maps API / Mapbox
- **Payments**: Stripe
- **Push**: Firebase Cloud Messaging
- **Real-time**: WebSockets (Socket.io)

## Project Structure
```
visp-tasker/
├── CLAUDE.md                          # This file
├── backend/
│   ├── src/
│   │   ├── api/routes/                # FastAPI route handlers
│   │   ├── services/                  # Business logic services
│   │   ├── models/                    # SQLAlchemy models
│   │   ├── algorithms/               # Matching, scoring algorithms
│   │   ├── integrations/             # External service integrations
│   │   ├── realtime/                 # WebSocket handlers
│   │   ├── events/                   # Event system
│   │   └── jobs/                     # Scheduled/background jobs
│   ├── migrations/                   # Alembic SQL migrations
│   ├── seeds/                        # Seed data JSON files
│   ├── tests/
│   │   ├── unit/
│   │   └── e2e/
│   └── requirements.txt
├── mobile/
│   ├── src/
│   │   ├── screens/
│   │   │   ├── auth/
│   │   │   ├── customer/
│   │   │   ├── provider/
│   │   │   ├── emergency/
│   │   │   └── profile/
│   │   ├── components/
│   │   ├── services/
│   │   ├── stores/
│   │   ├── hooks/
│   │   ├── navigation/
│   │   └── theme/
│   └── package.json
├── dashboard/                        # Admin web dashboard
│   ├── src/
│   └── package.json
├── content/
│   └── legal/                        # Legal consent text files
├── infrastructure/
│   ├── terraform/
│   └── docker/
└── docs/
    ├── architecture.md
    ├── api-spec.md
    └── sub-agents.md
```

## Available Custom Agents
Use these agents via the Task tool for specialized work. Match each to the VISP module it handles best:

| Agent | Role | VISP Modules |
|-------|------|-------------|
| `backend-architect` | System design, API structure, service patterns | VISP-BE-* (all backend), architecture decisions |
| `database-admin` | Schema design, migrations, constraints | VISP-DB-SCHEMA-001, VISP-DB-SEED-002 |
| `database-optimization` | Query optimization, indexing | Performance tuning across all DB queries |
| `database-optimizer` | Schema normalization, data modeling | VISP-DB-SCHEMA-001 refinement |
| `ios-developer` | iOS-specific React Native, native modules | VISP-FE-* (all mobile screens) |
| `mobile-developer` | Cross-platform React Native, navigation | VISP-FE-* (all mobile screens) |
| `frontend-developer` | Web dashboard, React components | Dashboard admin panel |
| `ui-ux-designer` | Design systems, UX flows, accessibility | All UI/UX review, emergency flow UX |
| `performance-engineer` | Load testing, optimization, caching | Backend + DB performance |
| `cloud-architect` | AWS infrastructure, deployment | Infrastructure, CI/CD |
| `command-expert` | CLI tools, scripts, DevOps commands | Build scripts, seed scripts, deployment |

## Available Skills
- `skill-creator` — For creating new specialized skills
- `mcp-builder` — For building MCP server integrations
- `frontend-design-pro` — For production-grade UI with distinctive aesthetics

## Critical Business Rules (NON-NEGOTIABLE)
1. **Closed Task Catalog** — the unit of work ALWAYS comes from `service_tasks`. Never free text, because level, price, duration and SLA are all derived from the catalog row. Customers pick a service; they never describe one.
   - **Booking details and evidence are NOT an exception to this** (client decision, 2026-08-11). After the service is selected and priced, the customer may add free-text details, up to 5 evidence photos, and an extra note. Their purpose is **decision support for the provider**: seeing the house, the lawn, the actual conditions, so they can accept or reject at their price range. They do not define, expand, or reprice the work.
   - Consequences that must hold: the text never feeds pricing; the provider sees details + evidence **before** accepting (they must ship in the job-offer payload, not just sit on the job row); and if the job turns out bigger than described, the correct path is the provider's accept+reprice flow, never the text.
   - Per-service `details_prompt_en/fr` (admin-editable) keeps the field inside the rule by steering customers to describe **scale and access** of the chosen service instead of requesting extra tasks. A generic placeholder invites out-of-scope requests.
   - `requires_details` / `requires_evidence` on `service_tasks` make each one mandatory per service. Two independent flags on purpose: dog walking needs a note but no details; damage repair needs the photo more than the prose.
2. **Levels as Business Rule** — `service_tasks.level` MUST match `provider_levels.level`
3. **Auditable Legal Consents** — Every consent logged with version, timestamp, IP, hash
4. **SLA Snapshot** — Terms copied to job at creation time (immutable after)
5. **Auto-Escalation** — Keywords trigger automatic level escalation
6. **Provider Cannot Decide Scope** — No additional services without a new job
7. **Automatic Qualification Blocks** — Missing qualifications = blocked assignment

## The Level System (L0–L3 — restructured 2026-08-04, see `visp-tasker/docs/plan-niveles-l0-l3.md`)

The level is **no longer global per provider**. It is per **category** for L1 and per
**individual service** for L2/L3. A profile reads "L2: Plumbing", not "L2 Worker".

- **Level 0 (Base)**: 18+, safety orientation, driver's licence as ID, ToS. Prices/commissions inherited from L1.
- **Level 1 (Skilled, non-regulated)** — *per category*: provider uploads experience evidence (portfolio + bio) → **VISP validates the documents** (not competence) → category unlocks. $25-45/hr, 15-20% commission.
- **Level 2 (Credentialed)** — *per service*: the exact credential the job requires (306A, ESA_LEC, Smart Serve…), verified against the official registry, + CGL insurance. $55-90/hr, 12-18% commission.
- **Level 3 (Advanced, business-based)** — *per service*: L2 requirements **plus** membership in a company with a verified Ontario BIN/OCN. An individual provider cannot take any L3 service. $80-150/hr, 10-15% commission.
- **Level 4 (Emergency)**: **DEAD.** Removed from the product. The enum value survives (Postgres can't drop it) but no active service or provider may use it; the admin rejects level 4 with 422.

**v1 beta ships with L0 and L1 only.** L2/L3 services stay `is_active=false` and are
enabled per service as the client decides. Insurance (CGL) is required **per service at
any level**, via a checkbox in the admin — it is not tied to a level.

Requirements live in **one place**: `service_credential_requirements` (service → code),
where `credential_requirements.kind` routes the check — `CREDENTIAL` →
`provider_credentials`, `INSURANCE` → `provider_insurance_policies`, `PERMIT` → required
per booking, never held in advance. Never add a parallel boolean flag for a requirement
that this table can express.

## Service Zones — how to launch in a new area

VISP launches area by area, Uber-style. **Never gate the service area by province** —
Ontario alone spans 1,400 km, so a province filter permits exactly the isolated
far-away registration the zone model exists to prevent. And **never gate on device
GPS**: it blocks our own testing from outside Canada and is trivially spoofed.

The gate is `service_zones` (migration 036): centre lat/lng + `radius_km` + `is_active`.
It is enforced on the **service address** (where the work happens) and on the
**provider's home/base address** — not on the device's location. GPS only centres the
map and shows a non-blocking notice.

**To expand coverage, no deploy is needed:**
- *Grow an existing area* → raise `radius_km` on that row (e.g. GTA 60 → 90 km to pull Barrie in).
- *Add a new city* → `INSERT` a row with its centre and radius (Ottawa, Montreal…).
- *Pause an area* → `is_active = false`. Existing jobs are untouched; new ones are refused.

Seed zone: `GTA`, centre Toronto (43.6532, -79.3832), radius 60 km — verified to cover
Toronto, Mississauga, Brampton, Markham, Vaughan, Richmond Hill, Oakville, Pickering and
Hamilton (59.2 km, just inside). Barrie falls 25 km short.

Why this beats a province filter, concretely: **Thunder Bay is in Ontario and sits 864 km
outside the GTA zone.** A `province = 'ON'` gate would have accepted it.

`GET /api/v1/geo/service-area?lat=&lng=` is the non-blocking check for the UI (warn in the
address picker); the hard gate lives in job creation and returns **400**, never 5xx.

Province strings are normalized to 2-letter codes (`Ontario` → `ON`) by migration 036's
`normalize_ca_province()`. The column had mixed full names and codes, which made every
province filter fail silently — keep writing codes, not names.

## Design System
```css
--primary: #4A90E2;
--primary-dark: #2E6AB3;
--emergency-red: #E74C3C;
--level-1: #27AE60;  /* Green - Helper */
--level-2: #F39C12;  /* Yellow - Experienced */
--level-3: #9B59B6;  /* Purple - Certified */
--level-4: #E74C3C;  /* Red - Emergency */
--background: #1A1A2E;
--surface: #16213E;
--text-primary: #FFFFFF;
--text-secondary: #A0A0A0;
```

## Code Style
- **Python**: Black formatter, isort, type hints everywhere, pydantic for validation
- **TypeScript/React**: ESLint + Prettier, strict TypeScript, functional components + hooks
- **SQL**: Uppercase keywords, snake_case naming, UUID primary keys, always `created_at`/`updated_at`
- **Testing**: pytest (backend), Jest + React Testing Library (frontend)

## Commands
- **Lint**: `cd backend && ruff check .` / `cd mobile && npx eslint .`
- **Type check**: `cd backend && mypy src/` / `cd mobile && npx tsc --noEmit`
- **Test**: `cd backend && pytest` / `cd mobile && npx jest`
- **Migrate**: `cd backend && alembic upgrade head`
- **Seed**: `cd backend && python scripts/seed.py`

## Dependency Graph (Build Order)
```
Phase 1: VISP-DB-SCHEMA-001 → VISP-DB-SEED-002
Phase 2: VISP-BE-TAXONOMY-001 → VISP-BE-LEGAL-007 → VISP-BE-VERIFICATION-004
Phase 3: VISP-BE-JOBS-002 → VISP-BE-MATCHING-003 → VISP-BE-SCORING-005 → VISP-BE-PRICING-006 → VISP-BE-ESCALATION-008
Phase 4: VISP-INT-MAPS-001 → VISP-INT-PAYMENTS-002 → VISP-INT-NOTIFICATIONS-003 → VISP-INT-REALTIME-004
Phase 5: VISP-FE-AUTH-001 → VISP-FE-HOME-002 → VISP-FE-TASK-003 → VISP-FE-EMERGENCY-004 → VISP-FE-PROVIDER-005 → VISP-FE-PROFILE-006
Phase 6: VISP-TEST-UNIT-002 → VISP-TEST-E2E-001
```
