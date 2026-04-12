import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import SalesData, BudgetData, ZSOReport
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/performance", tags=["Performance Dashboard"])

MONTHS = ["Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec", "Jan", "Feb", "Mar"]


@router.get("/demand-vs-actual")
async def demand_vs_actual(
    fiscal_year: str = Query("2025-26"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get monthly demand vs actual sales data."""
    # Get demand from ZSO reports (aggregate by sales_month)
    zso_result = await db.execute(select(ZSOReport.report_data))
    demand_by_month = {m: 0.0 for m in MONTHS}
    total_demand = 0.0

    for (rd,) in zso_result.all():
        if not rd or not isinstance(rd, dict):
            continue
        for item in rd.get("items", []):
            month_str = item.get("sales_month", "")
            total_inr = float(item.get("total_inr", 0) or 0)
            # Try to match month
            for m in MONTHS:
                if month_str and m.lower() in month_str.lower():
                    demand_by_month[m] += total_inr
                    total_demand += total_inr
                    break

    # Get actual sales data
    sales_result = await db.execute(
        select(SalesData)
        .where(SalesData.fiscal_year == fiscal_year)
        .order_by(SalesData.created_at.desc())
        .limit(1)
    )
    sales = sales_result.scalar_one_or_none()
    actual_by_month = {m: 0.0 for m in MONTHS}
    total_actual = 0.0

    if sales and sales.monthly_data:
        for m in MONTHS:
            val = float(sales.monthly_data.get(m, 0) or 0)
            actual_by_month[m] = val
            total_actual += val

    # Compute variance
    monthly = []
    for m in MONTHS:
        d = demand_by_month[m]
        a = actual_by_month[m]
        monthly.append({
            "month": m,
            "demand": round(d, 2),
            "actual": round(a, 2),
            "variance": round(a - d, 2),
            "variance_pct": round((a - d) / d * 100, 1) if d > 0 else 0,
        })

    return {
        "fiscal_year": fiscal_year,
        "monthly": monthly,
        "totals": {
            "demand": round(total_demand, 2),
            "actual": round(total_actual, 2),
            "variance": round(total_actual - total_demand, 2),
        },
    }


@router.post("/upload-sales")
async def upload_sales_data(
    fiscal_year: str = Query("2025-26"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload monthly sales data file."""
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are supported")

    content = await file.read()
    try:
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content), engine="openpyxl" if ext == "xlsx" else "xlrd")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    df = df.dropna(how="all")
    if df.empty:
        raise HTTPException(status_code=400, detail="File is empty")

    df.columns = [str(c).strip() for c in df.columns]

    # Try to extract monthly data — look for month columns
    monthly_data = {}
    rows = df.fillna("").astype(str).to_dict(orient="records")

    for m in MONTHS:
        for col in df.columns:
            if m.lower() in col.lower():
                try:
                    monthly_data[m] = float(df[col].apply(
                        lambda x: float(str(x).replace(",", "")) if str(x).replace(",", "").replace(".", "").replace("-", "").isdigit() else 0
                    ).sum())
                except (ValueError, TypeError):
                    monthly_data[m] = 0
                break

    sales = SalesData(
        uploaded_by=current_user.id,
        fiscal_year=fiscal_year,
        filename=filename,
        monthly_data=monthly_data if monthly_data else {"raw_rows": rows},
    )
    db.add(sales)
    await db.flush()

    logger.info(f"Sales upload: FY={fiscal_year}, file={filename}")
    return {
        "id": sales.id,
        "fiscal_year": fiscal_year,
        "filename": filename,
        "monthly_data": monthly_data,
        "columns": df.columns.tolist(),
    }


@router.post("/upload-budget")
async def upload_budget_data(
    fiscal_year: str = Query("2025-26"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload budget data file."""
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are supported")

    content = await file.read()
    try:
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content))
        else:
            df = pd.read_excel(io.BytesIO(content), engine="openpyxl" if ext == "xlsx" else "xlrd")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    df = df.dropna(how="all")
    if df.empty:
        raise HTTPException(status_code=400, detail="File is empty")

    df.columns = [str(c).strip() for c in df.columns]

    monthly_data = {}
    rows = df.fillna("").astype(str).to_dict(orient="records")

    for m in MONTHS:
        for col in df.columns:
            if m.lower() in col.lower():
                try:
                    monthly_data[m] = float(df[col].apply(
                        lambda x: float(str(x).replace(",", "")) if str(x).replace(",", "").replace(".", "").replace("-", "").isdigit() else 0
                    ).sum())
                except (ValueError, TypeError):
                    monthly_data[m] = 0
                break

    budget = BudgetData(
        uploaded_by=current_user.id,
        fiscal_year=fiscal_year,
        filename=filename,
        monthly_data=monthly_data if monthly_data else {"raw_rows": rows},
    )
    db.add(budget)
    await db.flush()

    logger.info(f"Budget upload: FY={fiscal_year}, file={filename}")
    return {
        "id": budget.id,
        "fiscal_year": fiscal_year,
        "filename": filename,
        "monthly_data": monthly_data,
        "columns": df.columns.tolist(),
    }


@router.get("/budget-vs-actual")
async def budget_vs_actual(
    fiscal_year: str = Query("2025-26"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get budget vs actual performance data."""
    # Get budget
    budget_result = await db.execute(
        select(BudgetData)
        .where(BudgetData.fiscal_year == fiscal_year)
        .order_by(BudgetData.created_at.desc())
        .limit(1)
    )
    budget = budget_result.scalar_one_or_none()
    budget_by_month = {m: 0.0 for m in MONTHS}
    total_budget = 0.0

    if budget and budget.monthly_data:
        for m in MONTHS:
            val = float(budget.monthly_data.get(m, 0) or 0)
            budget_by_month[m] = val
            total_budget += val

    # Get actual sales
    sales_result = await db.execute(
        select(SalesData)
        .where(SalesData.fiscal_year == fiscal_year)
        .order_by(SalesData.created_at.desc())
        .limit(1)
    )
    sales = sales_result.scalar_one_or_none()
    actual_by_month = {m: 0.0 for m in MONTHS}
    total_actual = 0.0

    if sales and sales.monthly_data:
        for m in MONTHS:
            val = float(sales.monthly_data.get(m, 0) or 0)
            actual_by_month[m] = val
            total_actual += val

    monthly = []
    for m in MONTHS:
        b = budget_by_month[m]
        a = actual_by_month[m]
        monthly.append({
            "month": m,
            "budget": round(b, 2),
            "actual": round(a, 2),
            "variance": round(a - b, 2),
            "achievement_pct": round(a / b * 100, 1) if b > 0 else 0,
        })

    achievement = round(total_actual / total_budget * 100, 1) if total_budget > 0 else 0

    return {
        "fiscal_year": fiscal_year,
        "monthly": monthly,
        "totals": {
            "budget": round(total_budget, 2),
            "actual": round(total_actual, 2),
            "variance": round(total_actual - total_budget, 2),
            "achievement_pct": achievement,
        },
    }


@router.get("/kpis")
async def get_kpis(
    fiscal_year: str = Query("2025-26"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get KPI summary for performance dashboard."""
    # Total demand from ZSO
    zso_result = await db.execute(select(func.sum(ZSOReport.total_inr)))
    total_demand = zso_result.scalar() or 0

    # Total actual sales
    sales_result = await db.execute(
        select(SalesData)
        .where(SalesData.fiscal_year == fiscal_year)
        .order_by(SalesData.created_at.desc())
        .limit(1)
    )
    sales = sales_result.scalar_one_or_none()
    total_sales = 0
    if sales and sales.monthly_data:
        for m in MONTHS:
            total_sales += float(sales.monthly_data.get(m, 0) or 0)

    # Budget target
    budget_result = await db.execute(
        select(BudgetData)
        .where(BudgetData.fiscal_year == fiscal_year)
        .order_by(BudgetData.created_at.desc())
        .limit(1)
    )
    budget = budget_result.scalar_one_or_none()
    total_budget = 0
    if budget and budget.monthly_data:
        for m in MONTHS:
            total_budget += float(budget.monthly_data.get(m, 0) or 0)

    achievement = round(total_sales / total_budget * 100, 1) if total_budget > 0 else 0

    return {
        "total_demand": round(total_demand, 2),
        "total_sales": round(total_sales, 2),
        "total_budget": round(total_budget, 2),
        "achievement_pct": achievement,
    }
