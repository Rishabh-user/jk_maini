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
    allocation_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Generate a coverage report from allocation results."""
    # Get allocation
    if allocation_id:
        alloc_result = await db.execute(
            select(AllocationResult).where(AllocationResult.id == allocation_id)
        )
    else:
        alloc_result = await db.execute(
            select(AllocationResult).order_by(AllocationResult.created_at.desc()).limit(1)
        )
    alloc = alloc_result.scalar_one_or_none()
    if not alloc:
        raise HTTPException(status_code=404, detail="No allocation results found. Run allocation first.")

    allocations = (alloc.result_data or {}).get("allocations", [])

    # Build coverage data
    coverage_rows = []
    exceptions = []
    full_count = 0
    partial_count = 0
    low_count = 0
    no_count = 0

    for item in allocations:
        demand_qty = float(item.get("demand_qty", 0) or 0)
        fg_stock = float(item.get("total_fg", 0) or 0)
        wip_qty = float(item.get("wip_qty", 0) or 0)
        rm_stock = 0  # RM data not yet integrated
        rm_in_orders = 0

        total_coverage = fg_stock + wip_qty + rm_stock + rm_in_orders
        gap = max(0, demand_qty - total_coverage)
        coverage_pct = round((total_coverage / demand_qty * 100), 1) if demand_qty > 0 else 0

        if coverage_pct >= 100:
            level = "full"
            full_count += 1
        elif coverage_pct >= 70:
            level = "partial"
            partial_count += 1
        elif coverage_pct >= 30:
            level = "low"
            low_count += 1
        else:
            level = "none"
            no_count += 1

        row = {
            "cust_part_no": item.get("cust_part_no", ""),
            "maini_part_no": item.get("maini_part_no", ""),
            "customer": item.get("customer", ""),
            "demand_qty": demand_qty,
            "fg_stock": fg_stock,
            "wip": wip_qty,
            "rm_stock": rm_stock,
            "rm_in_orders": rm_in_orders,
            "total_coverage": total_coverage,
            "gap": gap,
            "coverage_pct": coverage_pct,
            "level": level,
        }
        coverage_rows.append(row)

        # Add exception for low or no coverage
        if level in ("low", "none"):
            severity = "critical" if level == "none" else "warning"
            issue_type = "No stock available" if level == "none" else "Significant shortfall"
            exceptions.append({
                "cust_part_no": item.get("cust_part_no", ""),
                "maini_part_no": item.get("maini_part_no", ""),
                "customer": item.get("customer", ""),
                "issue_type": issue_type,
                "demand_qty": demand_qty,
                "available": total_coverage,
                "shortfall": gap,
                "severity": severity,
                "action_required": "Urgent procurement" if severity == "critical" else "Review production plan",
            })

    report_data = {
        "rows": coverage_rows,
        "summary": {
            "full": full_count,
            "partial": partial_count,
            "low": low_count,
            "none": no_count,
            "total": len(coverage_rows),
        },
    }

    coverage = CoverageReportModel(
        created_by=current_user.id,
        allocation_id=alloc.id,
        report_data=report_data,
        exceptions={"items": exceptions},
        status="generated",
    )
    db.add(coverage)
    await db.flush()

    logger.info(f"Coverage report generated: full={full_count}, partial={partial_count}, low={low_count}, none={no_count}")
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
