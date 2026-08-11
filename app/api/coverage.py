from fastapi import APIRouter, Depends, HTTPException, Query
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import AllocationResult, CoverageReport as CoverageReportModel, ZSOReport
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/coverage", tags=["Coverage Report"])


@router.post("/generate")
async def generate_coverage(
    zso_report_id: int = Query(None, description="Demand source; defaults to the latest ZSO report."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Generate a coverage report — demand vs stock, per part.

    Self-contained: reads classified stock (FG / WIP / RM / in-transit) and
    firm **PO demand** from a ZSO directly (no Run-Allocation step needed).

    Coverage counts **FG + WIP only** (same units as the demanded part). RM
    stock and RM in-transit are shown for context but **not counted** toward
    coverage — converting raw/child into finished-equivalent units needs the
    BOM (tracker #9). RM-on-order needs a purchasing file we don't have yet.
    Reported in both **quantity and value** (qty × master unit price).
    """
    from app.api.inventory import _latest_classified_uploads, _effective_annotated_rows, _is_forecast_line
    from app.services.stock_service import part_breakdown
    from app.models.data import MainiPart

    # ── Stock ──
    uploads = await _latest_classified_uploads(db)
    breakdown = part_breakdown(_effective_annotated_rows(uploads))

    # ── Demand (firm PO only) ──
    if zso_report_id:
        zso = (await db.execute(select(ZSOReport).where(ZSOReport.id == zso_report_id))).scalar_one_or_none()
    else:
        zso = (await db.execute(select(ZSOReport).order_by(ZSOReport.created_at.desc()).limit(1))).scalar_one_or_none()
    if not zso:
        raise HTTPException(status_code=404, detail="No ZSO report found. Generate a ZSO report first.")

    demand_by_part: dict[str, float] = {}
    for item in (zso.report_data or {}).get("items", []):
        if _is_forecast_line(item):
            continue
        mp = str(item.get("maini_part_no") or "").strip()
        if mp:
            demand_by_part[mp] = demand_by_part.get(mp, 0.0) + float(item.get("open_qty", item.get("quantity", 0)) or 0)

    # ── Price / master enrichment ──
    price_map: dict[str, dict] = {}
    for mp, cust, cname, price, curr in (await db.execute(
        select(MainiPart.maini_part_no, MainiPart.customer_part_no, MainiPart.customer_name,
               MainiPart.unit_price, MainiPart.currency)
    )).all():
        key = (mp or "").strip()
        if key and key not in price_map:
            price_map[key] = {"cust_part_no": cust, "customer": cname, "unit_price": price, "currency": (curr or "INR").upper()}

    coverage_rows, exceptions = [], []
    counts = {"full": 0, "partial": 0, "low": 0, "none": 0}
    value_by_currency: dict[str, dict] = {}

    for mp, demand_qty in demand_by_part.items():
        demand_qty = round(demand_qty, 2)
        b = breakdown.get(mp, {})
        fg = round(b.get("fg", 0.0), 2)
        wip = round(b.get("wip", 0.0), 2)
        rm = round(b.get("rm", 0.0), 2)
        in_transit = round(b.get("in_transit", 0.0), 2)

        # FG + WIP only count toward coverage (RM/in-transit shown, not counted)
        total_coverage = round(fg + wip, 2)
        gap = round(max(0.0, demand_qty - total_coverage), 2)
        coverage_pct = round((total_coverage / demand_qty * 100), 1) if demand_qty > 0 else 0

        if coverage_pct >= 100:
            level = "full"
        elif coverage_pct >= 70:
            level = "partial"
        elif coverage_pct >= 30:
            level = "low"
        else:
            level = "none"
        counts[level] += 1

        meta = price_map.get(mp, {})
        price = meta.get("unit_price")
        currency = (meta.get("currency") or "INR").upper()
        demand_value = round(demand_qty * price, 2) if price else None
        coverage_value = round(total_coverage * price, 2) if price else None
        gap_value = round(gap * price, 2) if price else None
        if demand_value is not None:
            v = value_by_currency.setdefault(currency, {"demand": 0.0, "coverage": 0.0, "gap": 0.0})
            v["demand"] += demand_value; v["coverage"] += coverage_value or 0; v["gap"] += gap_value or 0

        coverage_rows.append({
            "cust_part_no": meta.get("cust_part_no") or "",
            "maini_part_no": mp,
            "customer": meta.get("customer") or "",
            "demand_qty": demand_qty,
            "fg_stock": fg, "wip": wip,
            "rm_stock": rm, "rm_in_transit": in_transit, "rm_in_orders": None,  # on-order pending client file
            "total_coverage": total_coverage, "gap": gap, "coverage_pct": coverage_pct, "level": level,
            "unit_price": price, "currency": currency,
            "demand_value": demand_value, "coverage_value": coverage_value, "gap_value": gap_value,
        })

        if level in ("low", "none"):
            exceptions.append({
                "cust_part_no": meta.get("cust_part_no") or "", "maini_part_no": mp,
                "customer": meta.get("customer") or "",
                "issue_type": "No stock available" if level == "none" else "Significant shortfall",
                "demand_qty": demand_qty, "available": total_coverage, "shortfall": gap,
                "severity": "critical" if level == "none" else "warning",
                "action_required": "Urgent procurement" if level == "none" else "Review production plan",
            })

    coverage_rows.sort(key=lambda r: (r["gap_value"] or 0, r["gap"]), reverse=True)

    report_data = {
        "rows": coverage_rows,
        "summary": {**counts, "total": len(coverage_rows),
                    "value_by_currency": {k: {kk: round(vv, 2) for kk, vv in v.items()} for k, v in value_by_currency.items()},
                    "zso_report_id": zso.id},
    }

    coverage = CoverageReportModel(
        created_by=current_user.id,
        allocation_id=None,   # self-contained now — not derived from an allocation run
        report_data=report_data,
        exceptions={"items": exceptions},
        status="generated",
    )
    db.add(coverage)
    await db.flush()

    logger.info(f"Coverage generated from ZSO #{zso.id}: {counts}, parts={len(coverage_rows)}")
    return {
        "id": coverage.id,
        "summary": report_data["summary"],
        "rows": coverage_rows,
        "exception_count": len(exceptions),
    }


@router.get("/report")
async def get_coverage_report(
    report_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the latest or specific coverage report."""
    if report_id:
        result = await db.execute(
            select(CoverageReportModel).where(CoverageReportModel.id == report_id)
        )
    else:
        result = await db.execute(
            select(CoverageReportModel).order_by(CoverageReportModel.created_at.desc()).limit(1)
        )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="No coverage report found")

    report_data = report.report_data or {}
    return {
        "id": report.id,
        "summary": report_data.get("summary", {}),
        "rows": report_data.get("rows", []),
        "status": report.status,
        "created_at": report.created_at.isoformat() if report.created_at else None,
    }


@router.get("/exceptions")
async def get_exceptions(
    report_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get exception report from coverage analysis."""
    if report_id:
        result = await db.execute(
            select(CoverageReportModel).where(CoverageReportModel.id == report_id)
        )
    else:
        result = await db.execute(
            select(CoverageReportModel).order_by(CoverageReportModel.created_at.desc()).limit(1)
        )
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="No coverage report found. Generate one first.")

    exceptions = (report.exceptions or {}).get("items", [])
    return {
        "report_id": report.id,
        "exceptions": exceptions,
        "total": len(exceptions),
        "critical": sum(1 for e in exceptions if e.get("severity") == "critical"),
        "warning": sum(1 for e in exceptions if e.get("severity") == "warning"),
    }


@router.get("/reports")
async def list_coverage_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all coverage reports."""
    result = await db.execute(
        select(
            CoverageReportModel.id, CoverageReportModel.status,
            CoverageReportModel.created_at
        )
        .order_by(CoverageReportModel.created_at.desc())
        .limit(20)
    )
    reports = []
    for row in result.all():
        reports.append({
            "id": row[0],
            "status": row[1],
            "created_at": row[2].isoformat() if row[2] else None,
        })
    return reports
