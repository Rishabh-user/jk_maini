from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.email import Email, EmailStatus
from app.schemas.email import EmailResponse, EmailListResponse, ProcessEmailResponse
from app.services.gmail_service import GmailService, save_email_to_db
from app.services.email_processor import process_email
from app.utils.config import get_settings
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

settings = get_settings()
router = APIRouter(prefix="/emails", tags=["Emails"])


@router.get("/", response_model=EmailListResponse)
async def list_emails(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=100),
    status: EmailStatus | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Email)
    count_query = select(func.count(Email.id))

    if status:
        query = query.where(Email.status == status)
        count_query = count_query.where(Email.status == status)

    query = query.order_by(Email.created_at.desc()).offset(skip).limit(limit)

    total_result = await db.execute(count_query)
    total = total_result.scalar()

    result = await db.execute(query)
    emails = result.scalars().all()

    return EmailListResponse(total=total, emails=emails)


@router.get("/{email_id}", response_model=EmailResponse)
async def get_email(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Email).where(Email.id == email_id))
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")
    return email


@router.post("/fetch", response_model=dict)
async def fetch_emails_from_gmail(
    max_results: int = Query(20, ge=1, le=50),
    after_date: str = Query(None, description="Fetch emails after this date (YYYY/MM/DD). Defaults to today."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    from datetime import date as dt_date

    gmail = GmailService()
    gmail.authenticate()

    # Default to today's date so we only fetch recent emails
    if not after_date:
        after_date = dt_date.today().strftime("%Y/%m/%d")

    raw_emails = gmail.fetch_unread_emails(max_results=max_results, after_date=after_date)

    saved_count = 0
    for email_data in raw_emails:
        email = await save_email_to_db(db, email_data, settings.UPLOAD_DIR)
        if email:
            gmail.mark_as_read(email_data["gmail_message_id"])
            saved_count += 1

    return {"fetched": len(raw_emails), "saved": saved_count}


@router.delete("/{email_id}")
async def delete_email(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    result = await db.execute(select(Email).where(Email.id == email_id))
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    await db.delete(email)
    await db.flush()
    return {"detail": "Email deleted"}


@router.post("/process-email/{email_id}", response_model=ProcessEmailResponse)
async def process_single_email(
    email_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    try:
        result = await process_email(db, email_id)
        return ProcessEmailResponse(**result)
    except ValueError as e:
        raise HTTPException(status_code=404, detail=str(e))
    except Exception as e:
        logger.error(f"Email processing error: {e}")
        raise HTTPException(status_code=500, detail="Email processing failed")
