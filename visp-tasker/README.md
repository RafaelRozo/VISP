# VISP/Tasker

Home services marketplace platform -- iOS app + FastAPI backend.

## Prerequisites

| Tool | Install | Purpose |
|------|---------|---------|
| Python 3.11+ | `brew install python@3.11` | Backend API server |
| Node.js 20+ | `brew install node` | React Native mobile app |
| Docker Desktop | [docker.com](https://www.docker.com/products/docker-desktop/) | PostgreSQL and Redis |
| Xcode 15+ | Mac App Store | iOS Simulator |
| CocoaPods | `sudo gem install cocoapods` | iOS native dependencies |

## Quick Start

```bash
# One-command setup (installs deps, starts DB, runs migrations, seeds data)
./scripts/quickstart.sh

# Then open two terminals:

# Terminal 1 -- Backend API
make backend

# Terminal 2 -- iOS Simulator
make mobile-sim
```

## Manual Setup

```bash
# 1. Install backend dependencies
make setup-backend

# 2. Install mobile dependencies
make setup-mobile

# 3. Start PostgreSQL and Redis
make db-start

# 4. Run database migrations
make db-migrate

# 5. Load seed data
make db-seed

# 6. Start backend (in Terminal 1)
make backend

# 7. Start iOS app (in Terminal 2)
make mobile-sim
```

## Available Commands

Run `make help` for the full list.

| Command | Description |
|---------|-------------|
| `make setup` | Full first-time setup (deps + DB + migrations + seed) |
| `make backend` | Start FastAPI dev server on port 305 with hot reload |
| `make mobile` | Start React Native Metro bundler |
| `make mobile-sim` | Build and launch on iPhone 16 Pro Simulator |
| `make test` | Run all tests (unit + e2e) |
| `make test-unit` | Run unit tests only |
| `make test-e2e` | Run end-to-end tests only |
| `make lint` | Run linters (ruff for backend, eslint for mobile) |
| `make typecheck` | Run type checkers (mypy for backend, tsc for mobile) |
| `make db-start` | Start PostgreSQL and Redis containers |
| `make db-stop` | Stop database containers |
| `make db-reset` | Wipe DB, recreate, migrate, and re-seed |
| `make logs` | Tail Docker container logs |
| `make status` | Check what services are running |
| `make clean` | Remove all build artifacts, containers, and volumes |

## API Documentation

Once the backend is running:

- **Swagger UI**: http://localhost:305/docs
- **ReDoc**: http://localhost:305/redoc
- **Health Check**: http://localhost:305/health

## Test Users

Seed data creates test accounts for development. See `backend/seeds/test_users.json` for the full list of available users, including customers, providers at each level, and an admin account.

## Project Structure

```
visp-tasker/
├── backend/              Python/FastAPI API server
│   ├── src/
│   │   ├── api/routes/   Route handlers (11 modules)
│   │   ├── services/     Business logic
│   │   ├── models/       SQLAlchemy ORM models
│   │   ├── algorithms/   Matching, scoring, pricing
│   │   ├── integrations/ Maps, Stripe, Firebase
│   │   ├── realtime/     WebSocket handlers (Socket.IO)
│   │   ├── events/       Event system
│   │   └── jobs/         Celery background tasks
│   ├── migrations/       Raw SQL migration files (001-008)
│   ├── seeds/            JSON seed data files
│   ├── scripts/          migrate.py, seed.py
│   └── tests/            Unit and e2e test suites
├── mobile/               React Native iOS app
│   ├── src/
│   │   ├── screens/      Auth, Customer, Provider, Emergency, Profile
│   │   ├── components/   Shared UI components
│   │   ├── services/     API client, auth, storage
│   │   ├── stores/       Zustand state management
│   │   ├── hooks/        Custom React hooks
│   │   ├── navigation/   React Navigation config
│   │   └── theme/        Design system tokens
│   └── ios/              Xcode project and Podfile
├── infrastructure/
│   └── docker/           Docker Compose, Dockerfile
├── dashboard/            Admin web dashboard (React)
├── content/legal/        Legal consent text files
├── scripts/              quickstart.sh
├── Makefile              Development commands
└── CLAUDE.md             AI agent instructions
```

## Environment Variables

Backend environment variables are configured in `backend/.env` (already set up for local development). The Docker Compose file uses matching credentials:

| Variable | Default (local dev) |
|----------|-------------------|
| `DATABASE_URL` | `postgresql+asyncpg://visp:visp_local@localhost:5432/visp_tasker` |
| `REDIS_URL` | `redis://localhost:6379/0` |
| `JWT_SECRET` | `visp-dev-secret-change-me-in-production` |

For Stripe, Google Maps, and Firebase integration during development, update the placeholder values in `backend/.env` with your test API keys.

## Troubleshooting

**Docker containers won't start**
- Ensure Docker Desktop is running: `docker info`
- Check if ports are already in use: `make status`
- Reset everything: `make clean && make setup`

**Database connection refused**
- Verify containers are running: `docker compose -f infrastructure/docker/docker-compose.yml ps`
- Check PostgreSQL logs: `docker compose -f infrastructure/docker/docker-compose.yml logs db`

**CocoaPods errors**
- Update CocoaPods: `sudo gem install cocoapods`
- Clean and reinstall: `cd mobile/ios && pod deintegrate && pod install`

**Metro bundler port conflict**
- Kill the process on port 8081: `lsof -ti :8081 | xargs kill`
- Or reset cache: `cd mobile && npx react-native start --reset-cache`
