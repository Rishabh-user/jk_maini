from fastapi import APIRouter, Depends, HTTPException, Query, Request
from fastapi.responses import HTMLResponse
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.email import Email, EmailStatus
from app.schemas.email import EmailResponse, EmailListResponse, ProcessEmailResponse
from app.services.gmail_service import GmailService, save_email_to_db
from app.services import gmail_oauth
from app.services.email_processor import process_email
from app.utils.config import get_settings
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

settings = get_settings()
router = APIRouter(prefix="/emails", tags=["Emails"])


@router.get("/", response_model=EmailListResponse)
async def list_emails(
    skip: int = Query(0, ge=0),
    limit: int = Query(20, ge=1, le=500),
    status: EmailStatus | None = None,
    include_manual: bool = Query(False, description="Include manual uploads (default: excluded)"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(Email)
    count_query = select(func.count(Email.id))

    if not include_manual:
        # Exclude manual uploads — they appear in Upload Document page, not Email Inbox
        is_real_email = ~Email.gmail_message_id.like("manual-upload-%")
        query = query.where(is_real_email)
        count_query = count_query.where(is_real_email)

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


@router.get("/gmail/status")
async def gmail_status(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Whether a usable Gmail connection exists — drives the "Re-authorize
    Gmail" button's state in the UI without needing to attempt a real fetch."""
    creds = await gmail_oauth.load_credentials(db)
    if not creds:
        return {"connected": False, "reason": "no_credentials"}
    if creds.valid:
        return {"connected": True}
    if creds.expired and creds.refresh_token:
        # Access token is stale but should self-refresh on next use —
        # still "connected", not something the user needs to act on.
        return {"connected": True}
    return {"connected": False, "reason": "invalid"}


@router.get("/gmail/authorize")
async def gmail_authorize(
    request: Request,
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Returns a Google consent-screen URL for the frontend to open in a new
    tab. Works identically whether this backend is running on localhost or
    on Render — unlike the old InstalledAppFlow popup, which needed a
    browser on the same machine as the backend (impossible on a server)."""
    redirect_uri = str(request.base_url).rstrip("/") + "/emails/gmail/callback"
    auth_url = gmail_oauth.get_authorization_url(redirect_uri)
    return {"authorization_url": auth_url}


@router.get("/gmail/callback", response_class=HTMLResponse)
async def gmail_callback(
    request: Request,
    code: str = Query(None),
    state: str = Query(None),
    error: str = Query(None),
    db: AsyncSession = Depends(get_db),
):
    """Google redirects the user's browser here after they approve (or deny)
    access. Not JWT-protected — Google's redirect can't carry our Bearer
    token — gated instead by the one-time `state` nonce issued in
    /gmail/authorize, which only an already-authenticated admin/KAS could
    have obtained."""
    def page(message: str) -> str:
        return f"<html><body style='font-family:sans-serif;padding:40px;text-align:center'><h3>{message}</h3></body></html>"

    if error:
        return HTMLResponse(page(f"Gmail authorization was not completed: {error}. You can close this window."), status_code=400)
    if not code or not state or not gmail_oauth.verify_state(state):
        return HTMLResponse(page("This authorization link is invalid or has expired. Please try again from the app."), status_code=400)

    redirect_uri = str(request.base_url).rstrip("/") + "/emails/gmail/callback"
    try:
        await gmail_oauth.exchange_code(db, redirect_uri, code)
    except Exception as e:
        logger.exception("Gmail OAuth callback failed")
        return HTMLResponse(page(f"Authorization failed: {e}"), status_code=400)

    return HTMLResponse(page("Gmail connected successfully — you can close this window."))


@router.post("/fetch", response_model=dict)
async def fetch_emails_from_gmail(
    max_results: int = Query(20, ge=1, le=50),
    after_date: str = Query(None, description="Fetch emails after this date (YYYY/MM/DD). Defaults to today."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    from datetime import date as dt_date, timedelta

    gmail = GmailService()
    stored_creds = await gmail_oauth.load_credentials(db)

    # Gmail auth is the #1 failure mode of this endpoint — the refresh
    # token goes stale for many reasons (OAuth app in Testing mode ->
    # auto-expires in 7 days, token manually revoked, Google password
    # changed, client secret rotated). Turn the known failure shapes into
    # a proper 502 that points at the "Re-authorize Gmail" button instead
    # of a bare 500 with no explanation.
    try:
        refreshed = gmail.authenticate(stored_creds)
        if refreshed:
            await gmail_oauth.save_credentials(db, gmail.creds)
    except RuntimeError as e:
        raise HTTPException(status_code=502, detail=str(e))
    except Exception as e:
        try:
            from google.auth.exceptions import RefreshError as GoogleRefreshError
        except ImportError:
            GoogleRefreshError = ()
        if isinstance(e, GoogleRefreshError) or "invalid_grant" in str(e):
            logger.warning("Gmail token refresh failed: %s", e)
            raise HTTPException(
                status_code=502,
                detail=(
                    "Gmail authentication expired — please click "
                    "'Re-authorize Gmail' to reconnect, or (to stop this "
                    "recurring) publish the OAuth consent screen from "
                    "'Testing' to 'In production' in Google Cloud Console."
                ),
            )
        logger.exception("Gmail auth failed with unexpected error")
        raise HTTPException(
            status_code=502,
            detail=f"Gmail authentication failed: {type(e).__name__}: {e}",
        )

    # Default to the last 2 days (today + yesterday). Fetching only "today"
    # silently returned 0 for mail that arrived just before midnight (day/
    # timezone rollover); a 2-day window covers that without flooding the
    # results with a week of unrelated mail. Still unread-only.
    if not after_date:
        after_date = (dt_date.today() - timedelta(days=2)).strftime("%Y/%m/%d")

    try:
        raw_emails = gmail.fetch_unread_emails(max_results=max_results, after_date=after_date)
    except Exception as e:
        logger.exception("Gmail fetch failed")
        raise HTTPException(
            status_code=502,
            detail=f"Could not fetch messages from Gmail: {type(e).__name__}: {e}",
        )

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
