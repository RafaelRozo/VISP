#!/usr/bin/env bash
# Copy reset_stripe_test.py into the running backend container and run it.
set -euo pipefail
docker cp scripts/reset_stripe_test.py visp-backend:/app/scripts/
docker exec visp-backend python /app/scripts/reset_stripe_test.py
