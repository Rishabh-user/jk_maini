"""
Quick test: authenticate Gmail, fetch emails, save to DB, verify.
Run: python test_gmail.py
"""
import asyncio
import os
import sys

# Fix Windows console encoding
sys.stdout.reconfigure(encoding='utf-8', errors='replace')

# Ensure project root is on path
sys.path.insert(0, os.path.dirname(__file__))

from app.services.gmail_service import GmailService, save_email_to_db
from app.db.session import AsyncSessionLocal, engine, Base
from app.utils.config import get_settings

settings = get_settings()


async def main():
    # 1. Create tables if not exist
    print("=== Step 1: Ensuring DB tables exist ===")
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    print("  Tables ready.\n")

    # 2. Authenticate Gmail (opens browser first time)
    print("=== Step 2: Authenticating with Gmail ===")
    gmail = GmailService()
    gmail.authenticate()
    print("  Gmail authenticated!\n")

    # 3. Fetch emails
    print("=== Step 3: Fetching unread emails (max 5) ===")
    raw_emails = gmail.fetch_unread_emails(max_results=5)
    print(f"  Found {len(raw_emails)} unread emails.\n")

    if not raw_emails:
        print("  No unread emails to process. Send yourself an email and try again.")
        return

    for i, email_data in enumerate(raw_emails):
        print(f"  [{i+1}] Subject: {email_data.get('subject', '(none)')}")
        print(f"       From:    {email_data.get('sender', '(unknown)')}")
        print(f"       Attachments: {len(email_data.get('attachments', []))}")
        for att in email_data.get('attachments', []):
            print(f"         - {att['filename']} ({att['content_type']}, {att['size']} bytes)")
        print()

    # 4. Save to DB
    print("=== Step 4: Saving emails to database ===")
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    saved = 0
    skipped = 0

    async with AsyncSessionLocal() as session:
        try:
            for email_data in raw_emails:
                result = await save_email_to_db(session, email_data, settings.UPLOAD_DIR)
                if result:
                    saved += 1
                    print(f"  Saved: {email_data['subject']}")
                else:
                    skipped += 1
                    print(f"  Skipped (already exists): {email_data['subject']}")
            await session.commit()
        except Exception as e:
            await session.rollback()
            print(f"  ERROR saving: {e}")
            raise

    print(f"\n  Result: {saved} saved, {skipped} skipped.\n")

    # 5. Verify in DB
    print("=== Step 5: Verifying data in database ===")
    from sqlalchemy import select, func
    from app.models.email import Email, Attachment

    async with AsyncSessionLocal() as session:
        email_count = (await session.execute(select(func.count(Email.id)))).scalar()
        att_count = (await session.execute(select(func.count(Attachment.id)))).scalar()
        print(f"  Total emails in DB:      {email_count}")
        print(f"  Total attachments in DB: {att_count}")

        # Show last 5 emails
        result = await session.execute(
            select(Email).order_by(Email.created_at.desc()).limit(5)
        )
        recent = result.scalars().all()
        print(f"\n  Last {len(recent)} emails in DB:")
        for e in recent:
            att_names = [a.filename for a in (e.attachments or [])]
            print(f"    ID={e.id} | {e.subject} | From: {e.sender} | Status: {e.status.value} | Attachments: {att_names}")

    print("\n=== Done! Gmail fetch and DB storage working. ===")
    await engine.dispose()


if __name__ == "__main__":
    asyncio.run(main())
