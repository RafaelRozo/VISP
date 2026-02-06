# VISP/Tasker — Individual Agent Dispatch Commands

Each block below is a self-contained command you can paste directly into Claude Code.
They use the Task tool to spawn your custom agents from `~/.claude/agents/`.

---

## Phase 1: Foundation

### 1.1 — Database Schema
```
Use the database-admin agent to build the complete PostgreSQL schema for VISP/Tasker.

Create migration files in backend/migrations/ for all 16+ tables: users, provider_profiles, provider_levels, service_categories, service_tasks, provider_credentials, provider_insurance_policies, legal_consents, jobs, job_assignments, job_escalations, sla_profiles, on_call_shifts, pricing_rules, pricing_events, reviews, notifications.

Key requirements:
- UUID primary keys with gen_random_uuid()
- ENUM types for all status fields
- CHECK constraints on score ranges (0-100) and levels (1-4)
- Indexes on: provider location, job status, provider level, credential expiry
- Foreign key relationships throughout
- created_at/updated_at on every table

Also create corresponding SQLAlchemy models in backend/src/models/.

Reference the full schema spec in docs/architecture.md.
```

### 1.2 — Seed Data
```
Use the database-admin agent to create seed data for VISP/Tasker development.

Create JSON seed files in backend/seeds/:
- categories.json (12 categories)
- tasks_level_1.json (50+ basic tasks like cleaning, assembly, pet care)
- tasks_level_2.json (50+ technical tasks like drywall, flooring, light plumbing)
- tasks_level_3.json (80+ licensed tasks like HVAC, electrical panels, gas lines)
- tasks_level_4.json (20+ emergency tasks like burst pipes, power loss)
- sla_profiles.json, pricing_rules.json, test_users.json

Create backend/scripts/seed.py to load all seed files into the database.
```

---

## Phase 2: Core Backend

### 2.1 — Taxonomy API
```
Use the backend-architect agent to build the service taxonomy API.

FastAPI endpoints:
- GET /api/v1/categories → list all categories
- GET /api/v1/categories/:id/tasks → tasks for a category
- GET /api/v1/tasks/:id → task details with level, requirements, pricing
- GET /api/v1/tasks/search → keyword search across tasks

Files: backend/src/api/routes/categories.py, tasks.py, backend/src/services/taxonomyService.py

Level auto-classification: regulated/licensed→L3, hazardous/structural→L3, experience-required→L2, default→L1. Emergency-eligible L3 tasks→L4.
```

### 2.2 — Legal Consent System
```
Use the backend-architect agent to build the legal consent management system.

Immutable audit trail. Record every consent with SHA-256 hash, IP, user agent, timestamp.
8 consent types: platform_tos, provider_ic_agreement, level_1-4_terms, customer_service_agreement, emergency_pricing_consent.

Files: backend/src/services/legalConsentService.py, backend/src/api/routes/consents.py, content/legal/*.txt

APPEND-ONLY. Never update or delete consent records.
```

### 2.3 — Credential Verification
```
Use the backend-architect agent to build the credential verification service.

Background checks (CRC/CRJMC/VSC), professional licenses, insurance policies.
Daily cron for auto-expiry (30-day warning → auto-suspend on expiry).
Level 3+ requires valid license + $2M insurance. Level 4 requires emergency insurance.

Files: backend/src/services/verificationService.py, backgroundCheckIntegration.py, backend/src/api/routes/verification.py, backend/src/jobs/expiryChecker.py
```

### 2.4 — Job Management
```
Use the backend-architect agent to build the job lifecycle management API.

State machine: draft→pending→matching→assigned→accepted→en_route→arrived→in_progress→completed|cancelled|disputed.
SLA snapshot on creation (immutable). Emergency jobs get priority matching.

Files: backend/src/services/jobService.py, jobStateManager.py, backend/src/api/routes/jobs.py, backend/src/events/jobEvents.py
```

### 2.5 — Matching Engine
```
Use the backend-architect agent to build the provider matching engine.

Hard filters: level match, valid credentials, online/on-call status.
Soft ranking: internal_score (0.6 weight), distance via haversine (0.3), response_time (0.1).
Level 4: ONLY on_call providers with active emergency shift + insurance.

Files: backend/src/services/matchingEngine.py, geoService.py, backend/src/algorithms/providerRanking.py, backend/src/api/routes/matching.py
```

### 2.6 — Scoring Engine
```
Use the backend-architect agent to build the scoring and penalty system.

Scores 0-100. Level-specific penalties (L1 forgiving, L4 zero-tolerance).
L4 no-show = -50 points + immediate expulsion flag.
Weekly normalization: +5 points per incident-free week (cap at base score).

Files: backend/src/services/scoringEngine.py, backend/src/jobs/scoreNormalizer.py, backend/src/events/penaltyEvents.py
```

### 2.7 — Pricing Engine
```
Use the backend-architect agent to build the dynamic pricing engine.

Base rates per level/region. Emergency multipliers: night=1.5x, weather=2.0x, peak=2.5x.
Multipliers stack multiplicatively, capped at pricing_rule.dynamic_multiplier_max.
Commission: L1=15-20%, L2=12-18%, L3=8-12%, L4=15-25%.

Files: backend/src/services/pricingEngine.py, backend/src/api/routes/pricing.py, backend/src/integrations/weatherApi.py
```

### 2.8 — Escalation System
```
Use the backend-architect agent to build the auto-escalation system.

Keyword detection: L4 words (emergency, flood, fire, burst, no heat, no power), L3 words (gas, permit, structural, hvac), L2 words (electrical, wiring).
Check highest level first. Only escalate if target > current level.

Files: backend/src/services/escalationService.py, backend/src/api/routes/escalations.py
```

---

## Phase 3: Integrations (Can Run in Parallel)

### 3.1 — Maps
```
Use the backend-architect agent to build the maps & location integration.

Google Maps: autocomplete, geocoding, reverse geocoding, Distance Matrix API.
Haversine for provider distance calculations. Real-time location tracking via WebSocket.

Files: backend/src/integrations/maps/googleMapsService.py, geocoder.py, distanceCalculator.py, backend/src/realtime/locationTracker.py
```

### 3.2 — Payments
```
Use the backend-architect agent to build Stripe payment integration.

Customer charges, provider payouts with commission deduction, provider subscriptions (L2: $19-39/mo, L3: $49-99/mo, L4: $99-199/mo), refund handling.

Files: backend/src/integrations/stripe/paymentService.py, payoutService.py, subscriptionService.py, backend/src/api/routes/payments.py
```

### 3.3 — Notifications
```
Use the backend-architect agent to build Firebase Cloud Messaging integration.

Templates: job_assigned, job_accepted, provider_arrived, job_completed, sla_warning, credential_expiry.

Files: backend/src/integrations/fcm/pushService.py, backend/src/services/notificationService.py, backend/src/api/routes/notifications.py
```

### 3.4 — WebSockets
```
Use the backend-architect agent to build the WebSocket server.

Channels: job:{id} (status), provider:{id} (new jobs), location:{id} (GPS tracking), chat:{id} (messaging).
Socket.io with JWT authentication.

Files: backend/src/realtime/socketServer.py, handlers/jobHandler.py, locationHandler.py, chatHandler.py
```

---

## Phase 4: Mobile Frontend

### 4.1 — Authentication
```
Use the mobile-developer agent to build the authentication module in React Native.

Login, registration (customer vs provider split), forgot password, biometric auth (Face ID/Touch ID), JWT via react-native-keychain, Zustand auth store.

Dark theme: #1A1A2E background, #4A90E2 primary.

Files: mobile/src/screens/auth/LoginScreen.tsx, RegisterScreen.tsx, ForgotPasswordScreen.tsx, mobile/src/services/authService.ts, mobile/src/stores/authStore.ts
```

### 4.2 — Customer Home
```
Use the mobile-developer agent with the frontend-design-pro skill to build the customer home screen.

Category grid, PROMINENT pulsing red emergency button (#E74C3C), active jobs section, location display. Premium dark aesthetic, Uber-meets-TaskRabbit feel.

Files: mobile/src/screens/customer/HomeScreen.tsx, mobile/src/components/CategoryGrid.tsx, EmergencyButton.tsx, ActiveJobCard.tsx
```

### 4.3 — Task Selection
```
Use the mobile-developer agent to build the closed task selection flow.

❌ NO FREE TEXT. ✅ Predefined cards only. Category → Subcategory → Task drill-down. Level badges show user-friendly names: "Verified Helper", "Experienced Pro", "Certified Pro", "Emergency Pro".

Files: mobile/src/screens/customer/CategoryScreen.tsx, SubcategoryScreen.tsx, TaskSelectionScreen.tsx, mobile/src/components/TaskCard.tsx, LevelBadge.tsx
```

### 4.4 — Emergency Flow (11 Screens)
```
Use the ios-developer agent with the frontend-design-pro skill to build all 11 emergency screens.

This is the highest-priority UX flow. Screens: EmergencyHome → EmergencySelection (cards, NO free text) → RiskConfirmation (mandatory checkboxes) → LocationAccess → SLAPricing → Matching (animation) → ProviderAssigned → LiveTracking → ServiceStart → InProgress → Completion.

Plus: SLATimer.tsx (countdown, always visible screens 6-10) and EmergencyMap.tsx (real-time tracking).

Emergency red (#E74C3C) dominant. High contrast. Large touch targets.

Files: mobile/src/screens/emergency/*.tsx, mobile/src/components/SLATimer.tsx, EmergencyMap.tsx
```

### 4.5 — Provider App
```
Use the mobile-developer agent to build the provider-side app.

Available jobs feed, accept/reject, navigation to customer, check-in/out, on-call toggle (L4 only), earnings dashboard. Provider states: offline/online/on_call/busy.

Files: mobile/src/screens/provider/*.tsx, mobile/src/components/JobCard.tsx, OnCallToggle.tsx, mobile/src/stores/providerStore.ts
```

### 4.6 — Profiles & Verification
```
Use the mobile-developer agent to build profile and verification screens.

Customer profile (info, addresses, payments, history). Provider profile (info, level progression, credentials, insurance, rating). Document upload with expiry tracking.

Files: mobile/src/screens/profile/*.tsx, mobile/src/components/CredentialCard.tsx, LevelProgress.tsx
```

---

## Phase 5: Testing

### 5.1 — Unit Tests
```
Use the backend-architect agent to write unit tests with pytest.

Coverage targets: matching=90%+, pricing=95%+, scoring=90%+, verification=90%+.
Test all edge cases, penalty calculations, level boundaries, SLA enforcement.

Files: backend/tests/unit/test_matchingEngine.py, test_pricingEngine.py, test_scoringEngine.py, test_verificationService.py, test_escalationService.py
```

### 5.2 — E2E Tests
```
Use the backend-architect agent to write end-to-end tests.

Flows: customer booking (L1), emergency flow (L4), provider lifecycle, SLA breach handling, payment processing.

Files: backend/tests/e2e/test_customerBooking.py, test_emergencyFlow.py, test_providerFlow.py, test_slaEnforcement.py, test_payments.py
```

---

## Phase 6: Infrastructure

### 6.1 — AWS + Docker
```
Use the cloud-architect agent to set up infrastructure.

Terraform: VPC, ECS Fargate, PostgreSQL RDS, Redis ElastiCache, S3+CloudFront.
Docker: Dockerfile.backend (Python FastAPI), docker-compose.yml for local dev.

Files: infrastructure/terraform/*.tf, infrastructure/docker/Dockerfile.backend, docker-compose.yml
```

---

## Post-Build Review Agents

### Design Review
```
Use the ui-ux-designer agent to review all mobile screens for UX consistency.

Check: emergency flow clarity, touch target sizes, color contrast accessibility, navigation flow, level badge consistency, SLA timer visibility. Flag any free-text inputs that slipped through.
```

### Performance Review
```
Use the performance-engineer agent to review the backend for performance issues.

Check: N+1 queries in matching engine, missing indexes, inefficient geospatial queries, WebSocket connection pooling, Redis caching opportunities, Celery task optimization.
```

### Database Review
```
Use the database-optimization agent to review all queries and indexes.

Check: slow query patterns, missing composite indexes, EXPLAIN plans for matching queries, connection pooling config, vacuum/analyze schedules.
```
