#!/bin/bash
# =============================================================================
# VISP/Tasker -- Quick Start Setup Script
# =============================================================================
# Single-command setup for first-time developers on macOS.
#
# Usage:
#   ./scripts/quickstart.sh
#
# Prerequisites:
#   - python3 (brew install python@3.11)
#   - node    (brew install node)
#   - docker  (Docker Desktop)
# =============================================================================

set -e

# ---------------------------------------------------------------------------
# Colors for output
# ---------------------------------------------------------------------------
GREEN='\033[0;32m'
YELLOW='\033[1;33m'
RED='\033[0;31m'
BOLD='\033[1m'
NC='\033[0m' # No Color

# ---------------------------------------------------------------------------
# Resolve project root (script lives in scripts/)
# ---------------------------------------------------------------------------
SCRIPT_DIR="$(cd "$(dirname "${BASH_SOURCE[0]}")" && pwd)"
PROJECT_ROOT="$(cd "$SCRIPT_DIR/.." && pwd)"

cd "$PROJECT_ROOT"

echo ""
echo -e "${BOLD}================================================${NC}"
echo -e "${BOLD}  VISP/Tasker -- Quick Start Setup${NC}"
echo -e "${BOLD}================================================${NC}"
echo ""
echo "Project root: $PROJECT_ROOT"
echo ""

# ---------------------------------------------------------------------------
# Step 0: Check prerequisites
# ---------------------------------------------------------------------------
echo -e "${BOLD}Checking prerequisites...${NC}"
missing=()

if ! command -v python3 &>/dev/null; then
    missing+=("python3  -->  brew install python@3.11")
fi

if ! command -v node &>/dev/null; then
    missing+=("node     -->  brew install node")
fi

if ! command -v docker &>/dev/null; then
    missing+=("docker   -->  Install Docker Desktop from https://docker.com")
fi

if [ ${#missing[@]} -gt 0 ]; then
    echo ""
    echo -e "${RED}Missing required tools:${NC}"
    for tool in "${missing[@]}"; do
        echo "  - $tool"
    done
    echo ""
    echo "Install the missing tools and re-run this script."
    exit 1
fi

# Check that Docker daemon is running
if ! docker info &>/dev/null; then
    echo -e "${RED}Docker Desktop is installed but not running.${NC}"
    echo "Please start Docker Desktop and re-run this script."
    exit 1
fi

python_version=$(python3 --version 2>&1)
node_version=$(node --version 2>&1)
docker_version=$(docker --version 2>&1)

echo "  python3: $python_version"
echo "  node:    $node_version"
echo "  docker:  $docker_version"
echo -e "${GREEN}All prerequisites found.${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 1: Backend -- Python virtual environment and dependencies
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[1/6] Setting up Python virtual environment...${NC}"

cd "$PROJECT_ROOT/backend"

if [ -d "venv" ]; then
    echo "  Virtual environment already exists. Updating dependencies..."
else
    python3 -m venv venv
    echo "  Created virtual environment at backend/venv/"
fi

./venv/bin/pip install --upgrade pip --quiet
./venv/bin/pip install -r requirements.txt --quiet

echo -e "${GREEN}  Backend dependencies installed.${NC}"
echo ""

cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Step 2: Mobile -- Node.js dependencies
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[2/6] Installing Node.js dependencies...${NC}"

cd "$PROJECT_ROOT/mobile"
npm install --silent 2>/dev/null || npm install

echo -e "${GREEN}  Node modules installed.${NC}"
echo ""

cd "$PROJECT_ROOT"

# ---------------------------------------------------------------------------
# Step 3: CocoaPods (if available)
# ---------------------------------------------------------------------------
if command -v pod &>/dev/null; then
    echo -e "${YELLOW}[3/6] Installing CocoaPods dependencies...${NC}"
    cd "$PROJECT_ROOT/mobile/ios"
    pod install --silent 2>/dev/null || pod install
    cd "$PROJECT_ROOT"
    echo -e "${GREEN}  Pods installed.${NC}"
else
    echo -e "${YELLOW}[3/6] Skipping CocoaPods (not installed)${NC}"
    echo "  To install: sudo gem install cocoapods"
    echo "  Then run:   cd mobile/ios && pod install"
fi
echo ""

# ---------------------------------------------------------------------------
# Step 4: Start database containers
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[4/6] Starting PostgreSQL and Redis containers...${NC}"

cd "$PROJECT_ROOT"
docker compose -f infrastructure/docker/docker-compose.yml up -d db redis

echo "  Waiting for PostgreSQL to accept connections..."
max_retries=30
retries=0
until docker compose -f infrastructure/docker/docker-compose.yml exec -T db pg_isready -U visp -d visp_tasker 2>/dev/null; do
    retries=$((retries + 1))
    if [ $retries -ge $max_retries ]; then
        echo -e "${RED}  PostgreSQL did not become ready in time.${NC}"
        echo "  Check Docker logs: docker compose -f infrastructure/docker/docker-compose.yml logs db"
        exit 1
    fi
    sleep 1
done

echo "  Waiting for Redis..."
retries=0
until docker compose -f infrastructure/docker/docker-compose.yml exec -T redis redis-cli ping 2>/dev/null | grep -q PONG; do
    retries=$((retries + 1))
    if [ $retries -ge $max_retries ]; then
        echo -e "${RED}  Redis did not become ready in time.${NC}"
        exit 1
    fi
    sleep 1
done

echo -e "${GREEN}  PostgreSQL and Redis are running.${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 5: Run database migrations
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[5/6] Running database migrations...${NC}"

cd "$PROJECT_ROOT/backend"
./venv/bin/python scripts/migrate.py
cd "$PROJECT_ROOT"

echo -e "${GREEN}  Migrations applied.${NC}"
echo ""

# ---------------------------------------------------------------------------
# Step 6: Seed data
# ---------------------------------------------------------------------------
echo -e "${YELLOW}[6/6] Loading seed data...${NC}"

cd "$PROJECT_ROOT/backend"
./venv/bin/python scripts/seed.py
cd "$PROJECT_ROOT"

echo -e "${GREEN}  Seed data loaded.${NC}"
echo ""

# ---------------------------------------------------------------------------
# Done
# ---------------------------------------------------------------------------
echo -e "${BOLD}================================================${NC}"
echo -e "${GREEN}${BOLD}  Setup Complete!${NC}"
echo -e "${BOLD}================================================${NC}"
echo ""
echo "To start developing, open two terminal windows:"
echo ""
echo -e "  ${BOLD}Terminal 1 -- Backend API:${NC}"
echo "    make backend"
echo ""
echo -e "  ${BOLD}Terminal 2 -- iOS Simulator:${NC}"
echo "    make mobile-sim"
echo ""
echo "Or run the commands directly:"
echo ""
echo "  cd backend && ./venv/bin/uvicorn src.main:app --host 0.0.0.0 --port 305 --reload"
echo "  cd mobile && npx react-native run-ios --simulator=\"iPhone 16 Pro\""
echo ""
echo "Useful URLs:"
echo "  Swagger UI:    http://localhost:305/docs"
echo "  ReDoc:         http://localhost:305/redoc"
echo "  Health check:  http://localhost:305/health"
echo ""
echo "Run 'make help' for all available commands."
echo ""
