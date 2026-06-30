# CLAUDE.md

This file provides guidance to Claude Code (claude.ai/code) when working with code in this repository.

## Commands

```bash
# Run dev server
uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload

# Docker
docker-compose up -d              # Start backend + Redis
docker-compose logs -f backend    # Tail logs

# Lint & type check
ruff check .
mypy src/

# Tests
pytest                                              # All tests
pytest tests/unit/test_matchingEngine.py -v         # Single test file
pytest tests/unit/test_matchingEngine.py::test_name # Single test
pytest -k "matching" -v                             # Pattern match

# Database
alembic upgrade head              # Run migrations
python scripts/seed.py            # Seed taxonomy, pricing, SLA, test users

# Health check
curl http://localhost:8000/health
```

## Architecture

**FastAPI app** (`src/main.py`) registers 18 routers under `/api/v1` prefix, mounts Socket.IO at `/ws`.

### Request flow
Route handler (`api/routes/`) -> validates with Pydantic schema (`api/schemas/`) -> calls service (`services/`) -> queries DB via async SQLAlchemy session from `api/deps.py` -> emits events (`events/`) for realtime broadcast.

### Key layers

| Layer | Location | Pattern |
|-------|----------|---------|
| Routes | `src/api/routes/` | Each module exports `router`, included in `main.py` with `/api/v1` prefix |
| Schemas | `src/api/schemas/` | Pydantic v2 request/response models, one module per route group |
| Dependencies | `src/api/deps.py` | `DBSession` (async session via `Depends`), `get_current_user` (JWT bearer) |
| Services | `src/services/` | Async functions accepting `db: AsyncSession`, contain business logic |
| Models | `src/models/` | SQLAlchemy ORM with `UUIDPrimaryKeyMixin` + `TimestampMixin` from `base.py` |
| Integrations | `src/integrations/` | External APIs (Stripe, Mapbox, FCM) with custom exceptions + retry |
| Realtime | `src/realtime/` | Socket.IO server, handlers registered on import in lifespan, Redis adapter |
| Background | `src/jobs/` | Celery workers for expiry checks, score normalization |

### Database
- **Async engine**: `postgresql+asyncpg`, pool_size=10, max_overflow=20
- **Session lifecycle**: `get_db()` dependency yields session, auto-commits on success, rollbacks on exception. `expire_on_commit=False`.
- **Migrations**: Raw SQL in `migrations/` (001-011), managed by Alembic
- **Seeds**: JSON files in `seeds/` loaded by `scripts/seed.py`
- **All UUIDs**: Server-side `gen_random_uuid()`, all tables have `created_at`/`updated_at`

### Auth
- JWT access tokens (30min, HS256) + refresh tokens (7 days)
- `get_current_user` dependency extracts from `Authorization: Bearer` header
- `get_optional_user` returns `None` instead of 401 for optional auth
- bcrypt password hashing (72-byte truncation limit)

### Realtime (Socket.IO)
- Namespaces: `/jobs`, `/location`, `/chat` mounted at `/ws`
- JWT auth on handshake via `auth: { token }` 
- Room pattern: `provider_{id}`, `customer_{id}`, `job_{id}`
- Location tracking: dual-write to Redis (geo set, real-time) + PostgreSQL (audit, batched every 5s/100 points)
- Connection registry: in-process `user_id -> sids` map, scales via Redis adapter

### Payments (Stripe)
- All amounts in **cents** (integers) to avoid float precision issues
- Webhook signature verification via HMAC-SHA256 before processing
- Idempotent webhook processing with in-memory LRU cache (10k events)
- Commission split + provider transfer executed on `payment_intent.succeeded`

## Critical domain rules

- **Closed task catalog**: Jobs reference `service_tasks.task_id` FK, never free text
- **SLA snapshots**: SLA terms copied as JSONB into job at creation time, immutable after
- **Level matching**: Provider level must be >= job level. Hard filter before any ranking
- **State machine**: `jobStateManager.validate_transition()` enforces valid status sequences + actor-type permissions (customer/provider/system)
- **Matching order**: Hard requirements (level, certs, insurance, on-call) filtered first, then soft ranking (score 60%, distance 30%, response time 10%)
- **Pricing by level**: L1-2 time-based hourly rates. L3-4 negotiated. Dynamic multipliers stack multiplicatively (night 1.5x, weather 2x, peak up to 2.5x)
- **Escalation keywords**: Chat messages scanned for safety keywords ("gas", "fire", "electrical") triggering auto-escalation

## Config

Settings loaded via Pydantic `BaseSettings` in `src/core/config.py` from `.env`. Key vars:
`DATABASE_URL`, `REDIS_URL`, `JWT_SECRET`, `STRIPE_SECRET_KEY`, `STRIPE_WEBHOOK_SECRET`, `MAPBOX_ACCESS_TOKEN`, `FIREBASE_CREDENTIALS_JSON`

## Testing patterns

- `asyncio_mode = "auto"` in `pyproject.toml` -- no need for `@pytest.mark.asyncio`
- `conftest.py` provides `mock_db` (AsyncMock session), `sample_customer`, `sample_provider_user` and domain fixtures
- Unit tests mock DB and external services. E2E tests can use in-memory SQLite via `aiosqlite`
- `pythonpath = ["."]` enables absolute imports (`from src.services.jobService import ...`)
