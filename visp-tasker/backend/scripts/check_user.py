import asyncio
import os
import sys

# Add backend directory to path so we can import src
sys.path.append(os.path.abspath(os.path.join(os.path.dirname(__file__), '..')))

from src.db.session import SessionLocal
from src.db.models.user import User
from sqlalchemy import select

async def main():
    async with SessionLocal() as session:
        result = await session.execute(
            select(User).where(User.email == 'richi_yanez20@hotmail.com')
        )
        user = result.scalar_one_or_none()
        
        if user:
            print("--- USER FOUND ---")
            print(f"ID: {user.id}")
            print(f"Email: {user.email}")
            print(f"First Name: '{user.first_name}'")
            print(f"Last Name: '{user.last_name}'")
            print(f"Role Customer: {user.role_customer}")
            print(f"Role Provider: {user.role_provider}")
            print(f"Address: {user.default_address_street}, {user.default_address_city}")
        else:
            print("USER NOT FOUND")

if __name__ == "__main__":
    asyncio.run(main())
