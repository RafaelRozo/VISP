#!/usr/bin/env python3
"""
Simulate a provider driving toward a customer's location.

Usage:
    python3 simulate_tracking.py <job_id>

The script:
  1. Looks up the job's service location (customer).
  2. Places the provider 3 km south and moves them toward the customer.
  3. Updates the provider's last_latitude/last_longitude every 2 seconds
     (20 steps ≈ 40 s total).

The customer's JobTrackingScreen polls /jobs/{id}/tracking every 5 s
and will automatically see the provider approaching on the map.
"""

import asyncio
import math
import os
import sys
import uuid

from dotenv import load_dotenv

load_dotenv()

# ─── Config ──────────────────────────────────────────────────────────────────

NUM_STEPS = 20
STEP_INTERVAL_S = 2.0
OFFSET_KM = 3.0  # Start 3 km away


# ─── Helpers ─────────────────────────────────────────────────────────────────

def offset_lat(lat: float, km: float) -> float:
    """Shift latitude by ~km (1° ≈ 111 km)."""
    return lat - km / 111.0


def interpolate(start: tuple[float, float], end: tuple[float, float], t: float):
    """Linear interpolation between two (lat, lng) points."""
    return (
        start[0] + (end[0] - start[0]) * t,
        start[1] + (end[1] - start[1]) * t,
    )


# ─── Main ────────────────────────────────────────────────────────────────────

async def main():
    if len(sys.argv) < 2:
        # If no arg, auto-discover the first accepted job for our provider
        import asyncpg
        db_url = os.getenv("DATABASE_URL", "").replace(
            "postgresql+asyncpg://", "postgresql://"
        )
        conn = await asyncpg.connect(db_url)
        # Try to find a job that already has an assignment first
        row = await conn.fetchrow(
            """
            SELECT j.id, j.reference_number, ja.provider_id
            FROM jobs j
            JOIN job_assignments ja ON ja.job_id = j.id
            WHERE j.status IN ('PENDING_MATCH', 'PROVIDER_ACCEPTED', 'PROVIDER_EN_ROUTE', 'IN_PROGRESS')
            ORDER BY j.created_at DESC
            LIMIT 1
            """
        )
        
        if row is None:
            # Fallback: Find ANY recent job, even if unassigned, and force-assign it
            row = await conn.fetchrow(
                """
                SELECT id, reference_number 
                FROM jobs 
                ORDER BY created_at DESC 
                LIMIT 1
                """
            )
            if row is None:
                await conn.close()
                print("❌ No jobs in database at all! Create one in the app first.")
                sys.exit(1)
                
            job_id = str(row["id"])
            print(f"Found unassigned job {row['reference_number']}. Forcing assignment for testing...")
            
            # Find any provider profile to mock the worker
            prov_row = await conn.fetchrow("SELECT id FROM provider_profiles LIMIT 1")
            if not prov_row:
                print("❌ No provider profiles exist in the DB! You must have at least one provider.")
                sys.exit(1)
                
            provider_profile_id = prov_row["id"]
            
            # Insert assignment
            await conn.execute(
                """
                INSERT INTO job_assignments (id, job_id, provider_id, status, offered_at, match_score)
                VALUES ($1, $2, $3, 'ACCEPTED', NOW(), 100.0)
                """,
                uuid.uuid4(), uuid.UUID(job_id), provider_profile_id
            )
            
        else:
            job_id = str(row["id"])
            provider_profile_id = row["provider_id"]
            
        print(f"Auto-detected active job: {row['reference_number']} ({job_id})")
        
        # Also auto-accept the job if it's still in PENDING_MATCH to bypass testing hurdles
        await conn.execute(
            "UPDATE jobs SET status = 'IN_PROGRESS' WHERE id = $1",
            uuid.UUID(job_id)
        )
    else:
        job_id = sys.argv[1]
        row = {"provider_id": None}

    # ── Fetch job location from DB ──
    if not 'conn' in locals() or conn.is_closed():
        import asyncpg
        db_url = os.getenv("DATABASE_URL", "").replace(
            "postgresql+asyncpg://", "postgresql://"
        )
        conn = await asyncpg.connect(db_url)

    job = await conn.fetchrow(
        "SELECT service_latitude, service_longitude FROM jobs WHERE id = $1",
        uuid.UUID(job_id),
    )
    if job is None:
        print(f"❌ Job {job_id} not found")
        sys.exit(1)

    customer_lat = float(job["service_latitude"])
    customer_lng = float(job["service_longitude"])
    print(f"📍 Customer: ({customer_lat:.6f}, {customer_lng:.6f})")

    # Fetch the actual user_id for the provider that accepted this job!
    if row.get("provider_id"):
        user_row = await conn.fetchrow(
            "SELECT user_id FROM provider_profiles WHERE id = $1", 
            row["provider_id"]
        )
        provider_user_id = str(user_row["user_id"])
    else:
        # Fallback query if job_id was passed via arg
        user_row = await conn.fetchrow(
            """
            SELECT pp.user_id 
            FROM job_assignments ja 
            JOIN provider_profiles pp ON pp.id = ja.provider_id 
            WHERE ja.job_id = $1
            LIMIT 1
            """,
            uuid.UUID(job_id)
        )
        provider_user_id = str(user_row["user_id"]) if user_row else None

    if not provider_user_id:
        print("❌ Could not determine provider's user_id from the job assignments.")
        sys.exit(1)

    # Provider starts ~3 km south
    start_lat = offset_lat(customer_lat, OFFSET_KM)
    start_lng = customer_lng + 0.005  # Slight east offset for realism
    print(f"🚗 Provider start: ({start_lat:.6f}, {start_lng:.6f})")
    print(f"   Moving in {NUM_STEPS} steps, {STEP_INTERVAL_S}s each…\n")

    start = (start_lat, start_lng)
    end = (customer_lat, customer_lng)

    for i in range(NUM_STEPS + 1):
        t = i / NUM_STEPS
        lat, lng = interpolate(start, end, t)

        await conn.execute(
            """
            UPDATE users
            SET last_latitude = $1, last_longitude = $2
            WHERE id = $3
            """,
            round(lat, 7),
            round(lng, 7),
            uuid.UUID(provider_user_id),
        )

        remaining_km = math.sqrt(
            ((customer_lat - lat) * 111) ** 2
            + ((customer_lng - lng) * 111 * math.cos(math.radians(lat))) ** 2
        )
        bar = "█" * int(t * 30) + "░" * (30 - int(t * 30))
        print(
            f"  [{bar}] {t*100:5.1f}%  "
            f"({lat:.6f}, {lng:.6f})  "
            f"{remaining_km:.2f} km left"
        )

        if i < NUM_STEPS:
            await asyncio.sleep(STEP_INTERVAL_S)

    print("\n✅ Provider has arrived at customer location!")
    await conn.close()


if __name__ == "__main__":
    asyncio.run(main())
