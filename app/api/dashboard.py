from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.models.email import Email, EmailStatus, Attachment
from app.models.data import RawData, ZSOReport
from app.utils.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    total_emails = (await db.execute(select(func.count(Email.id)))).scalar() or 0
    processed_emails = (await db.execute(
        select(func.count(Email.id)).where(Email.status == EmailStatus.PROCESSED)
    )).scalar() or 0
    total_attachments = (await db.execute(select(func.count(Attachment.id)))).scalar() or 0
    total_zso = (await db.execute(select(func.count(ZSOReport.id)))).scalar() or 0
    pending_emails = (await db.execute(
        select(func.count(Email.id)).where(Email.status == EmailStatus.UNPROCESSED)
    )).scalar() or 0
    failed_emails = (await db.execute(
        select(func.count(Email.id)).where(Email.status == EmailStatus.FAILED)
    )).scalar() or 0

    return {
        "total_emails": total_emails,
        "processed_emails": processed_emails,
        "total_attachments": total_attachments,
        "total_zso": total_zso,
        "pending_emails": pending_emails,
        "failed_emails": failed_emails,
    }


@router.get("/recent-activity")
async def get_recent_activity(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Recent emails
    emails_result = await db.execute(
        select(Email).order_by(Email.created_at.desc()).limit(10)
    )
    recent_emails = emails_result.scalars().all()

    # Recent ZSO reports
    zso_result = await db.execute(
        select(ZSOReport).order_by(ZSOReport.created_at.desc()).limit(10)
    )
    recent_zso = zso_result.scalars().all()

    activities = []

    for email in recent_emails:
        att_count = len(email.attachments) if email.attachments else 0
        if email.status == EmailStatus.PROCESSED:
            activities.append({
                "action": "Email Processed",
                "detail": f"{email.subject or 'No subject'} - {att_count} attachments",
                "time": email.created_at.isoformat() if email.created_at else "",
                "status": "success",
            })
        elif email.status == EmailStatus.FAILED:
            activities.append({
                "action": "Processing Failed",
                "detail": email.subject or "No subject",
                "time": email.created_at.isoformat() if email.created_at else "",
                "status": "error",
            })
        else:
            activities.append({
                "action": "Email Received",
                "detail": f"{email.subject or 'No subject'} from {email.sender or 'unknown'}",
                "time": email.created_at.isoformat() if email.created_at else "",
                "status": "pending",
            })

    for report in recent_zso:
        activities.append({
            "action": "ZSO Generated",
            "detail": f"Report #{report.id} - {report.kas_name or 'Unknown KAS'}",
            "time": report.created_at.isoformat() if report.created_at else "",
            "status": "success",
        })

    # Sort by time descending
    activities.sort(key=lambda x: x["time"], reverse=True)
    return activities[:10]
