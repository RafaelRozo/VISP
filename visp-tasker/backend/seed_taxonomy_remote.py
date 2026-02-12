import asyncio
import sys
import os
import uuid

# Add current directory (backend root) to path
if os.getcwd() not in sys.path:
    sys.path.append(os.getcwd())

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession
from src.api.dependencies.database import get_db
from src.models.taxonomy import ServiceCategory, ServiceTask
from src.models.provider import ProviderLevel

async def seed_data(session: AsyncSession):
    print("Checking taxonomy data...")
    
    # 1. Check Categories
    stmt_cat = select(func.count(ServiceCategory.id))
    try:
        count_cat = (await session.execute(stmt_cat)).scalar_one()
    except Exception as e:
        print(f"Error checking count: {e}")
        return
    
    if count_cat > 0:
        print(f"Taxonomy already exists ({count_cat} categories). Skipping seed.")
        return

    print("Seeding default taxonomy...")
    
    # Define Categories
    categories_data = [
        {"name": "Cleaning", "slug": "cleaning", "icon_url": "cleaning_icon", "display_order": 1},
        {"name": "Plumbing", "slug": "plumbing", "icon_url": "plumbing_icon", "display_order": 2},
        {"name": "Electrical", "slug": "electrical", "icon_url": "electrical_icon", "display_order": 3},
        {"name": "Mounting", "slug": "mounting", "icon_url": "mounting_icon", "display_order": 4},
        {"name": "HVAC", "slug": "hvac", "icon_url": "hvac_icon", "display_order": 5},
    ]
    
    cats = {}
    for c_data in categories_data:
        cat = ServiceCategory(
            id=uuid.uuid4(),
            name=c_data["name"],
            slug=c_data["slug"],
            icon_url=c_data["icon_url"],
            display_order=c_data["display_order"],
            is_active=True
        )
        session.add(cat)
        cats[c_data["slug"]] = cat
        print(f"Added Category: {cat.name}")
        
    # Flush to ensure categories are tracked? No, manual UUIDs are fine.
    
    # Define Tasks
    tasks_data = [
        # Cleaning
        {"cat": "cleaning", "name": "Basic House Cleaning", "slug": "basic-cleaning", "level": ProviderLevel.LEVEL_1},
        {"cat": "cleaning", "name": "Deep Cleaning", "slug": "deep-cleaning", "level": ProviderLevel.LEVEL_2},
        # Plumbing
        {"cat": "plumbing", "name": "Leak Repair", "slug": "leak-repair", "level": ProviderLevel.LEVEL_2},
        {"cat": "plumbing", "name": "Toilet Installation", "slug": "toilet-install", "level": ProviderLevel.LEVEL_3},
        # Electrical
        {"cat": "electrical", "name": "Light Fixture Install", "slug": "light-install", "level": ProviderLevel.LEVEL_2},
        {"cat": "electrical", "name": "Outlet Replacement", "slug": "outlet-replace", "level": ProviderLevel.LEVEL_3},
        # Mounting
        {"cat": "mounting", "name": "TV Mounting", "slug": "tv-mounting", "level": ProviderLevel.LEVEL_2},
        {"cat": "mounting", "name": "Furniture Assembly", "slug": "furniture-assembly", "level": ProviderLevel.LEVEL_1},
    ]
    
    for t_data in tasks_data:
        cat = cats.get(t_data["cat"])
        if not cat: continue
        
        task = ServiceTask(
            id=uuid.uuid4(),
            category_id=cat.id,
            name=t_data["name"],
            slug=t_data["slug"],
            description=f"Standard {t_data['name']} service",
            level=t_data["level"],
            is_active=True,
            regulated=False,
            license_required=False,
            hazardous=False,
            structural=False,
            escalation_keywords=[] # Empty JSON list
        )
        session.add(task)
        print(f"Added Task: {task.name} ({cat.name})")

    await session.commit()
    print("Seeding complete!")

async def main():
    try:
        # get_db is a generator
        async for session in get_db():
            await seed_data(session)
            break
    except Exception as e:
        print(f"ERROR: {e}")
        import traceback
        traceback.print_exc()

if __name__ == "__main__":
    if os.name == 'nt':
        asyncio.set_event_loop_policy(asyncio.WindowsSelectorEventLoopPolicy())
    asyncio.run(main())
