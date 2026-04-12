import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import RawData, ZSOReport, DemandUpload
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger
from app.services.file_parser import FileParser

router = APIRouter(prefix="/demand", tags=["Demand Management"])


@router.get("/stats")
async def get_demand_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Aggregation stats from existing data."""
    # Count raw data by source type
    source_counts = await db.execute(
        select(RawData.source_type, func.count(RawData.id))
        .group_by(RawData.source_type)
    )
    source_map = {row[0] or "unknown": row[1] for row in source_counts.all()}

    # Count ZSO reports
    zso_count_result = await db.execute(select(func.count(ZSOReport.id)))
    zso_count = zso_count_result.scalar() or 0

    # Count ZSO total line items
    zso_reports = await db.execute(select(ZSOReport.report_data))
    total_line_items = 0
    for (rd,) in zso_reports.all():
        if rd and isinstance(rd, dict):
            total_line_items += len(rd.get("items", []))

    # Count demand uploads by type
    upload_counts = await db.execute(
        select(DemandUpload.upload_type, func.count(DemandUpload.id))
        .group_by(DemandUpload.upload_type)
    )
    upload_map = {row[0]: row[1] for row in upload_counts.all()}

    return {
        "sources": {
            "email": source_map.get("excel", 0) + source_map.get("pdf", 0) + source_map.get("csv", 0) + source_map.get("image", 0),
            "pdf": source_map.get("pdf", 0),
            "excel": source_map.get("excel", 0),
            "csv": source_map.get("csv", 0),
            "image": source_map.get("image", 0),
        },
        "zso_reports": zso_count,
        "total_line_items": total_line_items,
        "uploads": {
            "vmi": upload_map.get("vmi", 0),
            "safety_stock": upload_map.get("safety_stock", 0),
            "sap": upload_map.get("sap", 0),
            "manual": upload_map.get("manual", 0),
        },
    }


@router.post("/compare")
async def compare_demand(
    current_report_id: int = Query(...),
    previous_report_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Compare two ZSO reports to identify demand changes."""
    current = await db.execute(select(ZSOReport).where(ZSOReport.id == current_report_id))
    curr_report = current.scalar_one_or_none()
    if not curr_report:
        raise HTTPException(status_code=404, detail="Current report not found")

    previous = await db.execute(select(ZSOReport).where(ZSOReport.id == previous_report_id))
    prev_report = previous.scalar_one_or_none()
    if not prev_report:
        raise HTTPException(status_code=404, detail="Previous report not found")

    curr_items = {item.get("cust_part_no", item.get("customer_part_no", "")): item
                  for item in (curr_report.report_data or {}).get("items", [])}
    prev_items = {item.get("cust_part_no", item.get("customer_part_no", "")): item
                  for item in (prev_report.report_data or {}).get("items", [])}

    increases = []
    decreases = []
    new_items = []
    removed_items = []

    for part, curr in curr_items.items():
        if not part:
            continue
        curr_qty = float(curr.get("open_qty", curr.get("quantity", 0)) or 0)
        if part in prev_items:
            prev_qty = float(prev_items[part].get("open_qty", prev_items[part].get("quantity", 0)) or 0)
            diff = curr_qty - prev_qty
            if diff > 0:
                increases.append({"part": part, "customer": curr.get("customer_name", ""), "prev_qty": prev_qty, "curr_qty": curr_qty, "change": diff})
            elif diff < 0:
                decreases.append({"part": part, "customer": curr.get("customer_name", ""), "prev_qty": prev_qty, "curr_qty": curr_qty, "change": diff})
        else:
            new_items.append({"part": part, "customer": curr.get("customer_name", ""), "qty": curr_qty})

    for part, prev in prev_items.items():
        if part and part not in curr_items:
            prev_qty = float(prev.get("open_qty", prev.get("quantity", 0)) or 0)
            removed_items.append({"part": part, "customer": prev.get("customer_name", ""), "qty": prev_qty})

    return {
        "increases": increases,
        "decreases": decreases,
        "new_items": new_items,
        "removed_items": removed_items,
        "summary": {
            "total_increases": len(increases),
            "total_decreases": len(decreases),
            "total_new": len(new_items),
            "total_removed": len(removed_items),
        },
    }


@router.post("/upload")
async def upload_demand_file(
    upload_type: str = Query(..., regex="^(vmi|safety_stock|sap|manual)$"),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload a demand file (VMI, Safety Stock, SAP, or manual)."""
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

    upload = DemandUpload(
        uploaded_by=current_user.id,
        upload_type=upload_type,
        filename=filename,
        parsed_data={"columns": df.columns.tolist(), "rows": rows},
        row_count=len(rows),
    )
    db.add(upload)
    await db.flush()

    logger.info(f"Demand upload: type={upload_type}, file={filename}, rows={len(rows)}")
    return {
        "id": upload.id,
        "upload_type": upload_type,
        "filename": filename,
        "row_count": len(rows),
        "columns": df.columns.tolist(),
    }


@router.get("/reports")
async def list_zso_reports_for_comparison(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List ZSO reports available for demand comparison."""
    result = await db.execute(
        select(ZSOReport.id, ZSOReport.kas_name, ZSOReport.total_inr, ZSOReport.status, ZSOReport.created_at)
        .order_by(ZSOReport.created_at.desc())
        .limit(20)
    )
    reports = []
    for row in result.all():
        reports.append({
            "id": row[0],
            "kas_name": row[1],
            "total_inr": row[2],
            "status": row[3],
            "created_at": row[4].isoformat() if row[4] else None,
        })
    return reports
