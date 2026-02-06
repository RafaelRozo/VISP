# =============================================================================
# VISP/Tasker — Local Development Makefile
# =============================================================================
# Run `make help` to see all available targets.
#
# Prerequisites: python3, node, docker
# Docker services: PostgreSQL 15 (port 5432), Redis 7 (port 6379)
# =============================================================================

SHELL := /bin/bash

# Docker compose file path
DC := docker compose -f infrastructure/docker/docker-compose.yml

# Backend virtualenv paths
VENV := backend/venv
PIP := $(VENV)/bin/pip
PYTHON := $(VENV)/bin/python
UVICORN := $(VENV)/bin/uvicorn
PYTEST := $(VENV)/bin/python -m pytest

.PHONY: help setup setup-backend setup-mobile db-start db-stop db-migrate db-seed db-reset backend mobile mobile-sim test test-unit test-e2e lint typecheck clean logs status check-prereqs

# ---------------------------------------------------------------------------
# Default target
# ---------------------------------------------------------------------------

help:
	@echo ""
	@echo "VISP/Tasker Development Commands"
	@echo "================================"
	@echo ""
	@echo "  Setup"
	@echo "  -----"
	@echo "  make setup          Full first-time setup (backend + mobile + db)"
	@echo "  make setup-backend  Create venv and install Python dependencies"
	@echo "  make setup-mobile   Install Node dependencies + CocoaPods"
	@echo ""
	@echo "  Database"
	@echo "  --------"
	@echo "  make db-start       Start PostgreSQL + Redis containers"
	@echo "  make db-stop        Stop database containers"
	@echo "  make db-migrate     Run SQL migrations"
	@echo "  make db-seed        Load seed data"
	@echo "  make db-reset       Destroy, recreate, migrate, and seed"
	@echo ""
	@echo "  Services"
	@echo "  --------"
	@echo "  make backend        Start FastAPI server (port 305)"
	@echo "  make mobile         Start React Native Metro bundler"
	@echo "  make mobile-sim     Build and launch on iPhone 16 Pro Simulator"
	@echo ""
	@echo "  Testing"
	@echo "  -------"
	@echo "  make test           Run all tests (unit + e2e)"
	@echo "  make test-unit      Run unit tests only"
	@echo "  make test-e2e       Run end-to-end tests only"
	@echo ""
	@echo "  Code Quality"
	@echo "  ------------"
	@echo "  make lint           Run linters (backend + mobile)"
	@echo "  make typecheck      Run type checkers (mypy + tsc)"
	@echo ""
	@echo "  Utilities"
	@echo "  ---------"
	@echo "  make logs           Tail Docker container logs"
	@echo "  make status         Check what services are running"
	@echo "  make clean          Remove all build artifacts and containers"
	@echo ""

# ---------------------------------------------------------------------------
# Prerequisites check
# ---------------------------------------------------------------------------

check-prereqs:
	@echo "Checking prerequisites..."
	@command -v python3 >/dev/null 2>&1 || { echo "ERROR: python3 is required. Install via: brew install python@3.11"; exit 1; }
	@command -v node >/dev/null 2>&1 || { echo "ERROR: node is required. Install via: brew install node"; exit 1; }
	@command -v docker >/dev/null 2>&1 || { echo "ERROR: docker is required. Install Docker Desktop from https://docker.com"; exit 1; }
	@echo "All prerequisites found."

# ---------------------------------------------------------------------------
# Setup targets
# ---------------------------------------------------------------------------

setup: check-prereqs setup-backend setup-mobile db-start db-migrate db-seed
	@echo ""
	@echo "=========================================="
	@echo "  Setup complete!"
	@echo "=========================================="
	@echo ""
	@echo "Start developing:"
	@echo "  Terminal 1:  make backend"
	@echo "  Terminal 2:  make mobile-sim"
	@echo ""
	@echo "API docs:  http://localhost:305/docs"
	@echo ""

setup-backend:
	@echo "Setting up Python backend..."
	cd backend && python3 -m venv venv
	$(PIP) install --upgrade pip
	$(PIP) install -r backend/requirements.txt
	@echo "Backend setup complete."

setup-mobile:
	@echo "Installing Node.js dependencies..."
	cd mobile && npm install
	@if command -v pod >/dev/null 2>&1; then \
		echo "Installing CocoaPods..."; \
		cd mobile/ios && pod install; \
	else \
		echo "WARNING: CocoaPods not found. Install with: sudo gem install cocoapods"; \
		echo "         Then run: cd mobile/ios && pod install"; \
	fi
	@echo "Mobile setup complete."

# ---------------------------------------------------------------------------
# Database targets
# ---------------------------------------------------------------------------

db-start:
	@echo "Starting PostgreSQL and Redis..."
	$(DC) up -d db redis
	@echo "Waiting for PostgreSQL to accept connections..."
	@until $(DC) exec -T db pg_isready -U visp -d visp_tasker 2>/dev/null; do \
		sleep 1; \
	done
	@echo "PostgreSQL is ready."
	@echo "Waiting for Redis..."
	@until $(DC) exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do \
		sleep 1; \
	done
	@echo "Redis is ready."

db-stop:
	@echo "Stopping database containers..."
	$(DC) stop db redis

db-migrate:
	@echo "Running database migrations..."
	cd backend && ./venv/bin/python scripts/migrate.py

db-seed:
	@echo "Loading seed data..."
	cd backend && ./venv/bin/python scripts/seed.py

db-reset:
	@echo "Resetting database (destroy + recreate + migrate + seed)..."
	$(DC) down -v --remove-orphans
	$(MAKE) db-start
	$(MAKE) db-migrate
	$(MAKE) db-seed
	@echo "Database reset complete."

# ---------------------------------------------------------------------------
# Run services
# ---------------------------------------------------------------------------

backend:
	@echo "Starting FastAPI backend on http://localhost:305 ..."
	@echo "API docs: http://localhost:305/docs"
	@echo "Press Ctrl+C to stop."
	@echo ""
	cd backend && ./venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 305 --reload

mobile:
	@echo "Starting React Native Metro bundler..."
	@echo "Press Ctrl+C to stop."
	@echo ""
	cd mobile && npx react-native start

mobile-sim:
	@echo "Building and launching on iPhone 16 Pro Simulator..."
	cd mobile && npx react-native run-ios --simulator="iPhone 16 Pro"

# ---------------------------------------------------------------------------
# Testing
# ---------------------------------------------------------------------------

test: test-unit test-e2e

test-unit:
	@echo "Running unit tests..."
	cd backend && ./venv/bin/python -m pytest tests/unit/ -v

test-e2e:
	@echo "Running end-to-end tests..."
	cd backend && ./venv/bin/python -m pytest tests/e2e/ -v

# ---------------------------------------------------------------------------
# Code quality
# ---------------------------------------------------------------------------

lint:
	@echo "Linting backend (ruff)..."
	cd backend && ./venv/bin/python -m ruff check . || true
	@echo ""
	@echo "Linting mobile (eslint)..."
	cd mobile && npx eslint . --ext .js,.jsx,.ts,.tsx || true

typecheck:
	@echo "Type checking backend (mypy)..."
	cd backend && ./venv/bin/python -m mypy src/ || true
	@echo ""
	@echo "Type checking mobile (tsc)..."
	cd mobile && npx tsc --noEmit || true

# ---------------------------------------------------------------------------
# Utilities
# ---------------------------------------------------------------------------

logs:
	$(DC) logs -f

status:
	@echo "=== Docker Containers ==="
	@$(DC) ps 2>/dev/null || echo "  No containers running"
	@echo ""
	@echo "=== Backend Health ==="
	@curl -sf http://localhost:305/health 2>/dev/null && echo "" || echo "  Not running (http://localhost:305)"
	@echo ""
	@echo "=== Active Ports ==="
	@echo "  Port 5432 (PostgreSQL):"
	@lsof -i :5432 2>/dev/null | grep LISTEN | head -1 || echo "    not listening"
	@echo "  Port 6379 (Redis):"
	@lsof -i :6379 2>/dev/null | grep LISTEN | head -1 || echo "    not listening"
	@echo "  Port 305 (Backend API):"
	@lsof -i :305 2>/dev/null | grep LISTEN | head -1 || echo "    not listening"
	@echo "  Port 8081 (Metro bundler):"
	@lsof -i :8081 2>/dev/null | grep LISTEN | head -1 || echo "    not listening"

clean:
	@echo "Cleaning all build artifacts..."
	@echo "  Removing Python venv and caches..."
	rm -rf backend/venv backend/__pycache__ backend/.pytest_cache backend/.mypy_cache
	find backend -type d -name __pycache__ -exec rm -rf {} + 2>/dev/null || true
	@echo "  Removing Node modules and iOS build..."
	rm -rf mobile/node_modules mobile/ios/Pods mobile/ios/build
	@echo "  Stopping and removing Docker containers and volumes..."
	$(DC) down -v --remove-orphans 2>/dev/null || true
	@echo "Clean complete."
