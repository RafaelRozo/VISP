
import asyncio
import sys
from datetime import datetime
from pathlib import Path

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession, async_sessionmaker, create_async_engine

# Path setup
SCRIPT_DIR = Path(__file__).resolve().parent
BACKEND_DIR = SCRIPT_DIR.parent
sys.path.insert(0, str(BACKEND_DIR))

from src.core.config import settings
from src.models import ProviderProfile, ProviderLevelRecord

DATABASE_URL = settings.database_url

async def backfill_provider_levels():
    print("Backfilling provider_levels for existing profiles...")
    engine = create_async_engine(DATABASE_URL, echo=False)
    async_session = async_sessionmaker(engine, class_=AsyncSession, expire_on_commit=False)

    async with async_session() as session:
        async with session.begin():
            # Get all profiles
            result = await session.execute(select(ProviderProfile))
            profiles = result.scalars().all()
            
            count = 0
            for profile in profiles:
                # Check if level record exists
                result = await session.execute(
                    select(ProviderLevelRecord).where(
                        ProviderLevelRecord.provider_id == profile.id,
                        ProviderLevelRecord.level == profile.current_level
                    )
                )
                existing = result.scalar_one_or_none()
                
                if not existing:
                    print(f"Creating level record for provider {profile.id} (Level {profile.current_level.value})")
                    record = ProviderLevelRecord(
                        provider_id=profile.id,
                        level=profile.current_level,
                        qualified=True,
                        qualified_at=datetime.utcnow()
                    )
                    session.add(record)
                    count += 1
            
            print(f"Backfilled {count} provider_levels records.")

    await engine.dispose()

if __name__ == "__main__":
    asyncio.run(backfill_provider_levels())
