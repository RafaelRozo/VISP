"""
Seed script for VISP database.
Reads JSON seed files and inserts into PostgreSQL via psycopg2.
"""
import json
import os
import sys

import psycopg2

SEEDS_DIR = os.path.join(os.path.dirname(__file__), "..", "seeds")
DB_URL = "postgresql://user:password@localhost:5432/visp_tasker"

LEVEL_MAP = {
    "1": "LEVEL_1",
    "2": "LEVEL_2",
    "3": "LEVEL_3",
    "4": "LEVEL_4",
}


def seed_categories(cur):
    path = os.path.join(SEEDS_DIR, "categories.json")
    with open(path) as f:
        cats = json.load(f)

    for c in cats:
        cur.execute(
            """
            INSERT INTO service_categories (id, slug, name, description, icon_url, display_order, is_active)
            VALUES (%s, %s, %s, %s, %s, %s, true)
            ON CONFLICT (id) DO NOTHING
            """,
            (
                c["id"],
                c["slug"],
                c["name"],
                c.get("description"),
                c.get("icon_name"),  # JSON has icon_name, DB column is icon_url
                c.get("display_order", 0),
            ),
        )
    print(f"  Inserted {len(cats)} categories")


def seed_tasks(cur):
    total = 0
    for level_num in range(1, 5):
        path = os.path.join(SEEDS_DIR, f"tasks_level_{level_num}.json")
        if not os.path.exists(path):
            continue
        with open(path) as f:
            tasks = json.load(f)

        for t in tasks:
            db_level = LEVEL_MAP[str(t["level"])]
            cur.execute(
                """
                INSERT INTO service_tasks (
                    id, category_id, slug, name, description,
                    level, regulated, license_required, certification_required,
                    hazardous, structural, emergency_eligible,
                    base_price_min_cents, base_price_max_cents,
                    estimated_duration_min, escalation_keywords,
                    display_order, is_active
                ) VALUES (
                    %s, %s, %s, %s, %s,
                    %s, %s, %s, %s,
                    %s, %s, %s,
                    %s, %s,
                    %s, %s::jsonb,
                    %s, true
                )
                ON CONFLICT (id) DO NOTHING
                """,
                (
                    t["id"],
                    t["category_id"],
                    t["slug"],
                    t["name"],
                    t.get("description"),
                    db_level,
                    t.get("regulated", False),
                    t.get("license_required", False),
                    t.get("certification_required", False),
                    t.get("hazardous", False),
                    t.get("structural", False),
                    t.get("emergency_eligible", False),
                    t.get("base_price_min_cents"),
                    t.get("base_price_max_cents"),
                    t.get("estimated_duration_min"),
                    json.dumps(t.get("escalation_keywords", [])),
                    t.get("display_order", 0),
                ),
            )
        total += len(tasks)
        print(f"  Inserted {len(tasks)} level-{level_num} tasks")

    print(f"  Total tasks: {total}")


def main():
    print("Connecting to visp_tasker database...")
    conn = psycopg2.connect(DB_URL)
    conn.autocommit = False
    cur = conn.cursor()

    try:
        print("Seeding categories...")
        seed_categories(cur)

        print("Seeding tasks...")
        seed_tasks(cur)

        conn.commit()
        print("Seed complete!")
    except Exception as e:
        conn.rollback()
        print(f"Error: {e}")
        sys.exit(1)
    finally:
        cur.close()
        conn.close()


if __name__ == "__main__":
    main()
