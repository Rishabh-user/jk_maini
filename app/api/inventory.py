import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import InventoryStock, AllocationResult, ZSOReport
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/inventory", tags=["Inventory & Liquidation"])


@router.get("/summary")
async def get_inventory_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get inventory summary — FG in-house, FG warehouse, WIP totals."""
    # Count stocks by type
    stock_counts = await db.execute(
        select(InventoryStock.stock_type, func.count(InventoryStock.id), func.sum(InventoryStock.row_count))
        .group_by(InventoryStock.stock_type)
    )
    stock_map = {}
    for row in stock_counts.all():
        stock_map[row[0]] = {"uploads": row[1], "rows": row[2] or 0}

    # Count allocations
    alloc_counts = await db.execute(
        select(AllocationResult.allocation_type, func.count(AllocationResult.id))
        .group_by(AllocationResult.allocation_type)
    )
    alloc_map = {row[0]: row[1] for row in alloc_counts.all()}

    # Get latest allocation summary if exists
    latest_alloc = await db.execute(
        select(AllocationResult)
        .order_by(AllocationResult.created_at.desc())
        .limit(1)
    )
    latest = latest_alloc.scalar_one_or_none()
    summary_data = latest.summary if latest else {}

    return {
        "stocks": {
            "fg_inhouse": stock_map.get("fg_inhouse", {"uploads": 0, "rows": 0}),
            "fg_warehouse": stock_map.get("fg_warehouse", {"uploads": 0, "rows": 0}),
            "wip": stock_map.get("wip", {"uploads": 0, "rows": 0}),
        },
        "allocations": {
            "fg": alloc_map.get("fg", 0),
            "wip": alloc_map.get("wip", 0),
            "combined": alloc_map.get("combined", 0),
        },
        "latest_summary": summary_data,
    }


@router.post("/upload-stock")
async def upload_stock_file(
    stock_type: str = Query(..., regex="^(fg_inhouse|fg_warehouse|wip)$"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload an inventory stock file (FG in-house, FG warehouse, or WIP)."""
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
    rows = df.fillna("").astype(str).to_dict(orient="records")

    stock = InventoryStock(
        uploaded_by=current_user.id,
        stock_type=stock_type,
        filename=filename,
        parsed_data={"columns": df.columns.tolist(), "rows": rows},
        row_count=len(rows),
    )
    db.add(stock)
    await db.flush()

    logger.info(f"Stock upload: type={stock_type}, file={filename}, rows={len(rows)}")
    return {
        "id": stock.id,
        "stock_type": stock_type,
        "filename": filename,
        "row_count": len(rows),
        "columns": df.columns.tolist(),
    }


@router.post("/allocate")
async def run_allocation(
    allocation_type: str = Query(..., regex="^(fg|wip|combined)$"),
    zso_report_id: int = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Run stock allocation against demand from ZSO report."""
    # Get demand data from latest ZSO or specified report
    if zso_report_id:
        zso_result = await db.execute(select(ZSOReport).where(ZSOReport.id == zso_report_id))
    else:
        zso_result = await db.execute(
            select(ZSOReport).order_by(ZSOReport.created_at.desc()).limit(1)
        )
    zso = zso_result.scalar_one_or_none()
    if not zso:
        raise HTTPException(status_code=404, detail="No ZSO report found for allocation")

    demand_items = (zso.report_data or {}).get("items", [])

    # Get stock data
    stock_types = []
    if allocation_type in ("fg", "combined"):
        stock_types.extend(["fg_inhouse", "fg_warehouse"])
    if allocation_type in ("wip", "combined"):
        stock_types.append("wip")

    all_stock_rows = []
    for st in stock_types:
        stocks = await db.execute(
            select(InventoryStock)
            .where(InventoryStock.stock_type == st)
            .order_by(InventoryStock.created_at.desc())
            .limit(1)
        )
        stock = stocks.scalar_one_or_none()
        if stock and stock.parsed_data:
            for row in stock.parsed_data.get("rows", []):
                row["_stock_type"] = st
                all_stock_rows.append(row)

    # Build stock lookup by part number (try common column names)
    stock_by_part = {}
    for row in all_stock_rows:
        part = (
            row.get("Maini Part No", "") or row.get("maini_part_no", "") or
            row.get("Part No", "") or row.get("Material", "") or
            row.get("part_no", "") or ""
        ).strip()
        if not part:
            continue
        if part not in stock_by_part:
            stock_by_part[part] = {"fg_inhouse": 0, "fg_warehouse": 0, "wip": 0}
        qty = 0
        try:
            qty_str = (
                row.get("Qty", "") or row.get("Stock", "") or
                row.get("Quantity", "") or row.get("qty", "") or "0"
            )
            qty = float(str(qty_str).replace(",", "")) if qty_str else 0
        except (ValueError, TypeError):
            qty = 0
        stock_by_part[part][row["_stock_type"]] += qty

    # Allocate
    allocations = []
    fully_allocated = 0
    partial = 0
    no_stock = 0

    for item in demand_items:
        cust_part = item.get("cust_part_no", item.get("customer_part_no", ""))
        maini_part = item.get("maini_part_no", "")
        demand_qty = float(item.get("open_qty", item.get("quantity", 0)) or 0)

        stock_info = stock_by_part.get(maini_part, {"fg_inhouse": 0, "fg_warehouse": 0, "wip": 0})
        fg_inhouse = stock_info.get("fg_inhouse", 0)
        fg_warehouse = stock_info.get("fg_warehouse", 0)
        wip_qty = stock_info.get("wip", 0)

        total_fg = fg_inhouse + fg_warehouse
        total_available = total_fg + wip_qty if allocation_type == "combined" else (total_fg if allocation_type == "fg" else wip_qty)
        allocated = min(demand_qty, total_available)
        gap = demand_qty - allocated

        if gap <= 0:
            status = "full"
            fully_allocated += 1
        elif allocated > 0:
            status = "partial"
            partial += 1
        else:
            status = "no_stock"
            no_stock += 1

        allocations.append({
            "cust_part_no": cust_part,
            "maini_part_no": maini_part,
            "customer": item.get("customer_name", ""),
            "demand_qty": demand_qty,
            "fg_inhouse": fg_inhouse,
            "fg_warehouse": fg_warehouse,
            "total_fg": total_fg,
            "wip_qty": wip_qty,
            "allocated": allocated,
            "gap": gap,
            "status": status,
        })

    summary = {
        "total_parts": len(allocations),
        "fully_allocated": fully_allocated,
        "partial": partial,
        "no_stock": no_stock,
    }

    alloc_result = AllocationResult(
        created_by=current_user.id,
        zso_report_id=zso.id,
        allocation_type=allocation_type,
        result_data={"allocations": allocations},
        summary=summary,
    )
    db.add(alloc_result)
    await db.flush()

    logger.info(f"Allocation: type={allocation_type}, parts={len(allocations)}, full={fully_allocated}, partial={partial}, no_stock={no_stock}")
    return {
        "id": alloc_result.id,
        "allocation_type": allocation_type,
        "summary": summary,
        "allocations": allocations,
    }


@router.get("/allocations")
async def list_allocations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List recent allocation results."""
    result = await db.execute(
        select(
            AllocationResult.id, AllocationResult.allocation_type,
            AllocationResult.summary, AllocationResult.created_at
        )
        .order_by(AllocationResult.created_at.desc())
        .limit(20)
    )
    allocations = []
    for row in result.all():
        allocations.append({
            "id": row[0],
            "allocation_type": row[1],
            "summary": row[2],
            "created_at": row[3].isoformat() if row[3] else None,
        })
    return allocations


@router.get("/allocations/{alloc_id}")
async def get_allocation_detail(
    alloc_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get detailed allocation result."""
    result = await db.execute(select(AllocationResult).where(AllocationResult.id == alloc_id))
    alloc = result.scalar_one_or_none()
    if not alloc:
        raise HTTPException(status_code=404, detail="Allocation not found")
    return {
        "id": alloc.id,
        "allocation_type": alloc.allocation_type,
        "summary": alloc.summary,
        "allocations": (alloc.result_data or {}).get("allocations", []),
        "created_at": alloc.created_at.isoformat() if alloc.created_at else None,
    }
