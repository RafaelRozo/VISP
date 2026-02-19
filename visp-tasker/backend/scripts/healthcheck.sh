#!/bin/bash
# =============================================================================
# VISP API - Health Check & Auto-Recovery Script
# =============================================================================
# Run via cron every 5 minutes: */5 * * * * /path/to/healthcheck.sh
# =============================================================================

set -e

# Configuration
API_URL="http://localhost:8000/health"
COMPOSE_DIR="/home/richie/ssd/VISP/visp-tasker/backend"
LOG_FILE="/var/log/visp-healthcheck.log"
MAX_RETRIES=3
RETRY_DELAY=10

# Ensure log directory exists
mkdir -p "$(dirname "$LOG_FILE")" 2>/dev/null || LOG_FILE="/tmp/visp-healthcheck.log"

log() {
    echo "[$(date '+%Y-%m-%d %H:%M:%S')] $1" | tee -a "$LOG_FILE"
}

check_health() {
    local response
    response=$(curl -s -o /dev/null -w "%{http_code}" --max-time 10 "$API_URL" 2>/dev/null)
    [ "$response" = "200" ]
}

restart_backend() {
    log "🔄 Restarting backend container..."
    cd "$COMPOSE_DIR" || exit 1
    docker compose restart backend
    sleep 15
}

# Main check
log "━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━━"
log "🔍 Starting health check..."

for i in $(seq 1 $MAX_RETRIES); do
    if check_health; then
        log "✅ API is healthy (attempt $i/$MAX_RETRIES)"
        exit 0
    else
        log "⚠️  API not responding (attempt $i/$MAX_RETRIES)"
        if [ "$i" -lt "$MAX_RETRIES" ]; then
            sleep $RETRY_DELAY
        fi
    fi
done

# All retries failed - restart
log "❌ API failed all health checks, initiating recovery..."

# Check if containers are running
if ! docker compose -f "$COMPOSE_DIR/docker-compose.yml" ps | grep -q "visp-backend"; then
    log "📦 Backend container not running, starting..."
    cd "$COMPOSE_DIR" && docker compose up -d
else
    restart_backend
fi

# Wait and verify recovery
sleep 20
if check_health; then
    log "✅ Recovery successful! API is now healthy."
else
    log "🚨 CRITICAL: Recovery failed! Manual intervention required."
    # Add notification here (email, Slack, etc.)
    exit 1
fi
