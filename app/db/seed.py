"""Seed script: creates default admin user and sample maini_parts data.

Run with:  python -m app.db.seed
"""
import asyncio

from sqlalchemy import select

from app.db.session import AsyncSessionLocal, engine, Base
from app.models import User, UserRole, MainiPart
from app.utils.security import hash_password


async def seed():
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)

    async with AsyncSessionLocal() as db:
        # Admin user
        result = await db.execute(select(User).where(User.email == "admin@jkmaini.com"))
        if not result.scalar_one_or_none():
            admin = User(
                email="admin@jkmaini.com",
                full_name="System Admin",
                hashed_password=hash_password("admin123"),
                role=UserRole.ADMIN,
            )
            db.add(admin)
            print("Created admin user: admin@jkmaini.com / admin123")

        # Sample KAS user
        result = await db.execute(select(User).where(User.email == "kas@jkmaini.com"))
        if not result.scalar_one_or_none():
            kas = User(
                email="kas@jkmaini.com",
                full_name="KAS User",
                hashed_password=hash_password("kas123"),
                role=UserRole.KAS,
            )
            db.add(kas)
            print("Created KAS user: kas@jkmaini.com / kas123")

        # Sample maini_parts
        sample_parts = [
            {"customer_part_no": "CP-001", "maini_part_no": "MP-001", "description": "Brake Assembly LH", "country": "India", "unit_price": 1250.00, "hsn_code": "8708"},
            {"customer_part_no": "CP-002", "maini_part_no": "MP-002", "description": "Brake Assembly RH", "country": "India", "unit_price": 1250.00, "hsn_code": "8708"},
            {"customer_part_no": "CP-003", "maini_part_no": "MP-003", "description": "Steering Column", "country": "India", "unit_price": 3400.00, "hsn_code": "8708"},
            {"customer_part_no": "CP-004", "maini_part_no": "MP-004", "description": "Axle Shaft Front", "country": "Germany", "unit_price": 5600.00, "hsn_code": "8708"},
            {"customer_part_no": "CP-005", "maini_part_no": "MP-005", "description": "Suspension Spring", "country": "India", "unit_price": 800.00, "hsn_code": "7320"},
        ]

        for part_data in sample_parts:
            result = await db.execute(
                select(MainiPart).where(MainiPart.customer_part_no == part_data["customer_part_no"])
            )
            if not result.scalar_one_or_none():
                db.add(MainiPart(**part_data))
                print(f"Added part: {part_data['customer_part_no']} -> {part_data['maini_part_no']}")

        await db.commit()
        print("Seed completed.")


if __name__ == "__main__":
    asyncio.run(seed())
