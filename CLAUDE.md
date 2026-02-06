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
1. **Closed Task Catalog** — NO free text task descriptions. Predefined selection ONLY.
2. **Levels as Business Rule** — `service_tasks.level` MUST match `provider_levels.level`
3. **Auditable Legal Consents** — Every consent logged with version, timestamp, IP, hash
4. **SLA Snapshot** — Terms copied to job at creation time (immutable after)
5. **Auto-Escalation** — Keywords trigger automatic level escalation
6. **Provider Cannot Decide Scope** — No additional services without a new job
7. **Automatic Qualification Blocks** — Missing qualifications = blocked assignment

## The 4-Level System
- **Level 1 (Helper)**: Basic tasks, $25-45/hr, 15-20% commission, CRC required
- **Level 2 (Experienced)**: Technical light, $60-90/hr, 12-18% commission, portfolio required
- **Level 3 (Certified Pro)**: Licensed/regulated, $90-150/hr, 8-12% commission, license + $2M insurance
- **Level 4 (Emergency)**: 24/7 on-call, $150+ base, 15-25% commission, SLA-bound, zero tolerance

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
