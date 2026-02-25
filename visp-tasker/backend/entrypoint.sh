#!/bin/bash
# =============================================================================
# VISP Backend - Docker Entrypoint
# =============================================================================
# Runs migrations/seeds on startup, then starts the server
# =============================================================================

set -e

echo "============================================================"
echo "VISP Backend - Starting up..."
echo "============================================================"

# Wait for database to be ready
echo "[1/4] Waiting for PostgreSQL..."
python3 << 'EOF'
import asyncio
import asyncpg
import os
import sys

async def wait_for_db():
    db_url = os.environ.get("DATABASE_URL", "")
    # Parse URL: postgresql+asyncpg://user:pass@host:port/db
    parts = db_url.replace("postgresql+asyncpg://", "").split("@")
    user_pass = parts[0].split(":")
    host_db = parts[1].split("/")
    host_port = host_db[0].split(":")
    
    user = user_pass[0]
    password = user_pass[1]
    host = host_port[0]
    port = int(host_port[1]) if len(host_port) > 1 else 5432
    database = host_db[1]
    
    for i in range(30):  # 30 attempts, 2 seconds each = 60 seconds max
        try:
            conn = await asyncpg.connect(
                host=host, port=port, user=user,
                password=password, database=database,
                timeout=5
            )
            await conn.close()
            print(f"     -> PostgreSQL is ready!")
            return
        except Exception as e:
            print(f"     -> Waiting... ({i+1}/30)")
            await asyncio.sleep(2)
    
    print("ERROR: Could not connect to PostgreSQL after 60 seconds")
    sys.exit(1)

asyncio.run(wait_for_db())
EOF

# Run migrations if needed
echo "[2/4] Checking database migrations..."
if [ -d "/app/migrations" ]; then
    python3 << 'EOF'
import asyncio
import asyncpg
import os
from pathlib import Path

async def run_migrations_if_needed():
    db_url = os.environ.get("DATABASE_URL", "")
    parts = db_url.replace("postgresql+asyncpg://", "").split("@")
    user_pass = parts[0].split(":")
    host_db = parts[1].split("/")
    host_port = host_db[0].split(":")
    
    conn = await asyncpg.connect(
        host=host_port[0],
        port=int(host_port[1]) if len(host_port) > 1 else 5432,
        user=user_pass[0],
        password=user_pass[1],
        database=host_db[1],
        timeout=10
    )
    
    # Check if tables exist
    tables = await conn.fetch('''
        SELECT COUNT(*) as cnt FROM information_schema.tables 
        WHERE table_schema = 'public' AND table_type = 'BASE TABLE'
    ''')
    
    if tables[0]['cnt'] <= 1:  # Only alembic_version or empty
        print("     -> Running migrations...")
        migrations_dir = Path('/app/migrations')
        for sql_file in sorted(migrations_dir.glob('*.sql')):
            try:
                sql_content = sql_file.read_text()
                await conn.execute(sql_content)
                print(f"        ✓ {sql_file.name}")
            except Exception as e:
                if "already exists" not in str(e):
                    print(f"        ⚠ {sql_file.name}: {e}")
    else:
        print(f"     -> Database already has {tables[0]['cnt']} tables, skipping migrations.")
    
    await conn.close()

asyncio.run(run_migrations_if_needed())
EOF
fi

# Run seeds if tables are empty
echo "[3/4] Checking seed data..."
python3 << 'EOF'
import asyncio
import asyncpg
import os

async def check_seeds():
    db_url = os.environ.get("DATABASE_URL", "")
    parts = db_url.replace("postgresql+asyncpg://", "").split("@")
    user_pass = parts[0].split(":")
    host_db = parts[1].split("/")
    host_port = host_db[0].split(":")
    
    conn = await asyncpg.connect(
        host=host_port[0],
        port=int(host_port[1]) if len(host_port) > 1 else 5432,
        user=user_pass[0],
        password=user_pass[1],
        database=host_db[1],
        timeout=10
    )
    
    # Check if categories exist
    result = await conn.fetchval("SELECT COUNT(*) FROM service_categories")
    await conn.close()
    
    if result == 0:
        print("     -> No seed data found, running seed script...")
        import subprocess
        subprocess.run(["python3", "/app/scripts/seed.py"], check=True)
    else:
        print(f"     -> Seed data exists ({result} categories), skipping.")

asyncio.run(check_seeds())
EOF

echo "[4/4] Starting Uvicorn server..."
echo "============================================================"

# Start the application
if [ "$DEBUG" = "true" ]; then
    echo "     -> Starting in DEVELOPMENT mode with auto-reload..."
    exec uvicorn src.main:app --host 0.0.0.0 --port 8000 --reload
else
    echo "     -> Starting in PRODUCTION mode..."
    exec uvicorn src.main:app --host 0.0.0.0 --port 8000
fi
