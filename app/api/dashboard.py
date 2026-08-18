from fastapi import APIRouter, Depends
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.models.email import Email, EmailStatus, Attachment
from app.models.data import (
    RawData, ZSOReport, MainiPart, ForexRate, ForecastEntry,
    AllocationResult, CoverageReport, SalesData, BudgetData,
)
from app.utils.security import get_current_user

router = APIRouter(prefix="/dashboard", tags=["Dashboard"])


@router.get("/stats")
async def get_dashboard_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    # Emails = fetched from Gmail (gmail_message_id does NOT start with "manual-upload-")
    # Manual uploads = uploaded via Upload Document page (gmail_message_id starts with "manual-upload-")
    is_manual = Email.gmail_message_id.like("manual-upload-%")
    is_email  = ~is_manual

    total_emails = (await db.execute(
        select(func.count(Email.id)).where(is_email)
    )).scalar() or 0
    processed_emails = (await db.execute(
        select(func.count(Email.id)).where(is_email, Email.status == EmailStatus.PROCESSED)
    )).scalar() or 0
    pending_emails = (await db.execute(
        select(func.count(Email.id)).where(is_email, Email.status == EmailStatus.UNPROCESSED)
    )).scalar() or 0
    failed_emails = (await db.execute(
        select(func.count(Email.id)).where(is_email, Email.status == EmailStatus.FAILED)
    )).scalar() or 0

    total_manual = (await db.execute(
        select(func.count(Email.id)).where(is_manual)
    )).scalar() or 0
    processed_manual = (await db.execute(
        select(func.count(Email.id)).where(is_manual, Email.status == EmailStatus.PROCESSED)
    )).scalar() or 0

    total_attachments = (await db.execute(select(func.count(Attachment.id)))).scalar() or 0
    total_zso = (await db.execute(select(func.count(ZSOReport.id)))).scalar() or 0

    return {
        "total_emails": total_emails,
        "processed_emails": processed_emails,
        "pending_emails": pending_emails,
        "failed_emails": failed_emails,
        "total_manual": total_manual,
        "processed_manual": processed_manual,
        "total_attachments": total_attachments,
        "total_zso": total_zso,
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


@router.get("/charts")
async def get_dashboard_charts(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """One aggregated call backing every chart on the Dashboard page — each
    key maps to exactly one existing page's data, reusing that page's own
    counts/summaries wherever they're already computed server-side (e.g.
    AllocationResult.summary, CoverageReport.report_data['summary']) rather
    than re-deriving business logic here."""

    # ── Email Inbox ──────────────────────────────────────────────────────
    is_manual = Email.gmail_message_id.like("manual-upload-%")
    is_email = ~is_manual
    processed = (await db.execute(select(func.count(Email.id)).where(is_email, Email.status == EmailStatus.PROCESSED))).scalar() or 0
    unprocessed = (await db.execute(select(func.count(Email.id)).where(is_email, Email.status == EmailStatus.UNPROCESSED))).scalar() or 0
    failed = (await db.execute(select(func.count(Email.id)).where(is_email, Email.status == EmailStatus.FAILED))).scalar() or 0
    manual_processed = (await db.execute(select(func.count(Email.id)).where(is_manual, Email.status == EmailStatus.PROCESSED))).scalar() or 0
    manual_total = (await db.execute(select(func.count(Email.id)).where(is_manual))).scalar() or 0

    # ── ZSO Reports — last 6 months, by report_data timestamp ───────────
    month_expr = func.to_char(ZSOReport.created_at, "YYYY-MM")
    zso_rows = (await db.execute(
        select(month_expr.label("month"), func.count(ZSOReport.id), func.sum(ZSOReport.total_inr))
        .group_by(month_expr).order_by(month_expr.desc()).limit(6)
    )).all()
    zso_by_month = [
        {"month": m, "count": c, "total_inr": round(float(t or 0), 2)}
        for m, c, t in reversed(zso_rows)
    ]

    # ── Master Data ───────────────────────────────────────────────────────
    total_parts = (await db.execute(select(func.count(MainiPart.id)))).scalar() or 0
    currency_rows = (await db.execute(
        select(MainiPart.currency, func.count(MainiPart.id)).group_by(MainiPart.currency)
    )).all()
    by_currency = {(c or "Unset"): n for c, n in currency_rows}
    active_forex_rates = (await db.execute(select(func.count(ForexRate.id)).where(ForexRate.is_active.is_(True)))).scalar() or 0
    forecast_customers = (await db.execute(select(func.count(func.distinct(ForecastEntry.customer_name))))).scalar() or 0

    # ── Demand Management — RawData source mix ──────────────────────────
    source_rows = (await db.execute(
        select(RawData.source_type, func.count(RawData.id)).group_by(RawData.source_type)
    )).all()
    demand_sources = {(s or "unknown"): n for s, n in source_rows}

    # ── Inventory Liquidation — latest FG/WIP allocation summary ────────
    inventory_allocation = {}
    for alloc_type in ("fg", "wip"):
        row = (await db.execute(
            select(AllocationResult.summary)
            .where(AllocationResult.allocation_type == alloc_type)
            .order_by(AllocationResult.created_at.desc(), AllocationResult.id.desc())
            .limit(1)
        )).scalar_one_or_none()
        inventory_allocation[alloc_type] = row or {"full": 0, "partial": 0, "no_stock": 0}

    # ── Coverage Report — latest snapshot ────────────────────────────────
    cov_row = (await db.execute(
        select(CoverageReport.report_data).order_by(CoverageReport.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    coverage_summary = (cov_row or {}).get("summary", {"full": 0, "partial": 0, "low": 0, "none": 0})

    # ── Performance — most recently uploaded fiscal year on file ────────
    from app.api.performance import get_demand_by_month, get_actual_by_month, get_budget_by_month

    latest_fy = (await db.execute(
        select(SalesData.fiscal_year).order_by(SalesData.created_at.desc()).limit(1)
    )).scalar_one_or_none()
    if not latest_fy:
        latest_fy = (await db.execute(
            select(BudgetData.fiscal_year).order_by(BudgetData.created_at.desc()).limit(1)
        )).scalar_one_or_none()
    fiscal_year = latest_fy or "2025-26"

    demand_by_month, _ = await get_demand_by_month(db)
    actual_by_month, _ = await get_actual_by_month(db, fiscal_year)
    budget_by_month, _ = await get_budget_by_month(db, fiscal_year)
    from app.api.performance import MONTHS
    performance_monthly = [
        {"month": m, "demand": round(demand_by_month[m], 2), "actual": round(actual_by_month[m], 2), "budget": round(budget_by_month[m], 2)}
        for m in MONTHS
    ]

    return {
        "email_pipeline": {
            "processed": processed, "unprocessed": unprocessed, "failed": failed,
            "manual_processed": manual_processed, "manual_pending": manual_total - manual_processed,
        },
        "zso_by_month": zso_by_month,
        "master_data": {
            "total_parts": total_parts, "by_currency": by_currency,
            "active_forex_rates": active_forex_rates, "forecast_customers": forecast_customers,
        },
        "demand_sources": demand_sources,
        "inventory_allocation": inventory_allocation,
        "coverage": coverage_summary,
        "performance": {"fiscal_year": fiscal_year, "monthly": performance_monthly},
    }
