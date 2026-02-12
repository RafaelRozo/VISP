import asyncio
import sys
import os

# Add current directory (backend root) to path
if os.getcwd() not in sys.path:
    sys.path.append(os.getcwd())

from sqlalchemy import select, func
from src.api.dependencies.database import get_db
from src.models.taxonomy import ServiceCategory, ServiceTask
from src.services import taxonomy_service

async def check_db():
    print("--- STARTING DB CHECK ---")
    try:
        # Manually create a generator and get the session
        # get_db is a generator, so we need to iterate it
        async for session in get_db():
            print("Database connected.")
            
            # 1. Count Categories
            print("Checking ServiceCategory...")
            stmt_cat = select(func.count(ServiceCategory.id))
            count_cat = (await session.execute(stmt_cat)).scalar_one()
            print(f"Total ServiceCategory rows: {count_cat}")
            
            # 2. Count Tasks
            print("Checking ServiceTask...")
            stmt_task = select(func.count(ServiceTask.id))
            count_task = (await session.execute(stmt_task)).scalar_one()
            print(f"Total ServiceTask rows: {count_task}")
            
            if count_cat == 0:
                print("WARNING: No categories found! Did you run seed_taxonomy.sql?")
            
            # 3. Test Service Logic
            print("\nTesting taxonomy_service.get_full_active_taxonomy()...")
            try:
                results = await taxonomy_service.get_full_active_taxonomy(session)
                print(f"Service returned {len(results)} categories.")
                if len(results) > 0:
                    first = results[0]
                    tasks = getattr(first, 'active_tasks_list', 'MISSING')
                    print(f"First category '{first.name}' has tasks: {tasks}")
                    if tasks == 'MISSING':
                        print("CRITICAL: active_tasks_list attribute is MISSING on the result objects!")
                    elif isinstance(tasks, list):
                         print(f"Task count for first category: {len(tasks)}")
                else:
                    print("Service returned valid empty list.")
                    
            except Exception as e:
                print(f"SERVICE ERROR: {e}")
                import traceback
                traceback.print_exc()
            
            print("--- DB CHECK COMPLETE ---")
            break # Only need one session
            
    except Exception as e:
        print(f"CONNECTION ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(check_db())
