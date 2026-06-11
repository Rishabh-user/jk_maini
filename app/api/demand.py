import io
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import RawData, ZSOReport, DemandUpload, MainiPart, MasterDataCorrection
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

    curr_raw = (curr_report.report_data or {}).get("items", [])
    prev_raw = (prev_report.report_data or {}).get("items", [])

    # Use row_id (deterministic UUID) for matching when available — more precise
    # than part number alone (handles multiple delivery dates / POs per part).
    # Fall back to cust_part_no for older reports that predate UUID stamping.
    def _item_key(item: dict) -> str:
        row_id = item.get("row_id", "")
        if row_id:
            return row_id
        return item.get("cust_part_no", item.get("customer_part_no", ""))

    curr_items = {_item_key(item): item for item in curr_raw if _item_key(item)}
    prev_items = {_item_key(item): item for item in prev_raw if _item_key(item)}

    increases = []
    decreases = []
    new_items = []
    removed_items = []

    for key, curr in curr_items.items():
        if not key:
            continue
        curr_qty = float(curr.get("open_qty", curr.get("quantity", 0)) or 0)
        part = curr.get("cust_part_no", curr.get("customer_part_no", key))
        if key in prev_items:
            prev = prev_items[key]
            prev_qty = float(prev.get("open_qty", prev.get("quantity", 0)) or 0)
            diff = curr_qty - prev_qty
            if diff > 0:
                increases.append({"part": part, "customer": curr.get("customer_name", ""), "prev_qty": prev_qty, "curr_qty": curr_qty, "change": diff, "po": curr.get("po_forecast", ""), "ship_date": curr.get("ship_date", ""), "row_id": key})
            elif diff < 0:
                decreases.append({"part": part, "customer": curr.get("customer_name", ""), "prev_qty": prev_qty, "curr_qty": curr_qty, "change": diff, "po": curr.get("po_forecast", ""), "ship_date": curr.get("ship_date", ""), "row_id": key})
        else:
            new_items.append({"part": part, "customer": curr.get("customer_name", ""), "qty": curr_qty, "po": curr.get("po_forecast", ""), "ship_date": curr.get("ship_date", ""), "row_id": key})

    for key, prev in prev_items.items():
        if key and key not in curr_items:
            prev_qty = float(prev.get("open_qty", prev.get("quantity", 0)) or 0)
            part = prev.get("cust_part_no", prev.get("customer_part_no", key))
            removed_items.append({"part": part, "customer": prev.get("customer_name", ""), "qty": prev_qty, "po": prev.get("po_forecast", ""), "ship_date": prev.get("ship_date", ""), "row_id": key})

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
        select(ZSOReport.id, ZSOReport.kas_name, ZSOReport.total_inr, ZSOReport.status,
               ZSOReport.created_at, ZSOReport.report_data)
        .order_by(ZSOReport.created_at.desc())
        .limit(50)
    )
    reports = []
    for row in result.all():
        report_id, kas_name, total_inr, status, created_at, report_data = row

        # Extract meaningful context from report_data
        customers: list[str] = []
        total_items: int = 0
        po_numbers: list[str] = []
        if report_data and isinstance(report_data, dict):
            items = report_data.get("items", [])
            total_items = len(items)
            seen_customers: set[str] = set()
            seen_pos: set[str] = set()
            for item in items:
                cn = (item.get("customer_name") or "").strip()
                if cn and cn not in seen_customers:
                    seen_customers.add(cn)
                    customers.append(cn)
                pn = (item.get("po_number") or "").strip()
                if pn and pn not in seen_pos and item.get("po_forecast") != "Internal Forecast":
                    seen_pos.add(pn)
                    po_numbers.append(pn)

        reports.append({
            "id": report_id,
            "kas_name": kas_name,
            "total_inr": total_inr,
            "status": status,
            "created_at": created_at.isoformat() if created_at else None,
            "customers": customers,          # e.g. ["Safran HAL", "ASCO"]
            "total_items": total_items,      # number of line items
            "po_numbers": po_numbers[:3],    # up to 3 PO numbers for context
        })
    return reports


# ── Demand Uploads: list & delete ──────────────────────────────────────────

@router.get("/uploads")
async def list_demand_uploads(
    upload_type: str | None = Query(None, description="Filter by type: vmi, safety_stock, manual"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all demand uploads, optionally filtered by type."""
    query = select(DemandUpload).order_by(DemandUpload.created_at.desc())
    if upload_type:
        query = query.where(DemandUpload.upload_type == upload_type)
    result = await db.execute(query)
    uploads = result.scalars().all()
    return [
        {
            "id": u.id,
            "upload_type": u.upload_type,
            "filename": u.filename,
            "row_count": u.row_count,
            "columns": (u.parsed_data or {}).get("columns", []),
            "created_at": u.created_at.isoformat() if u.created_at else None,
        }
        for u in uploads
    ]


@router.get("/uploads/{upload_id}/preview")
async def preview_demand_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return first 50 rows of a demand upload for preview."""
    result = await db.execute(select(DemandUpload).where(DemandUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    parsed = upload.parsed_data or {}
    return {
        "id": upload.id,
        "filename": upload.filename,
        "upload_type": upload.upload_type,
        "row_count": upload.row_count,
        "columns": parsed.get("columns", []),
        "rows": parsed.get("rows", [])[:50],
    }


@router.delete("/uploads/{upload_id}")
async def delete_demand_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Delete a demand upload record."""
    result = await db.execute(select(DemandUpload).where(DemandUpload.id == upload_id))
    upload = result.scalar_one_or_none()
    if not upload:
        raise HTTPException(status_code=404, detail="Upload not found")
    await db.delete(upload)
    await db.flush()
    return {"detail": f"Deleted upload #{upload_id}"}


# ── Master Data Correction Workflow ────────────────────────────────────────

CORRECTABLE_FIELDS = ["maini_part_no", "unit_price", "currency", "description", "country", "hsn_code", "customer_name", "customer_location"]


class CorrectionCreate(BaseModel):
    customer_part_no: str
    customer_name: str | None = None
    field_name: str
    old_value: str | None = None
    new_value: str
    reason: str | None = None


class CorrectionReview(BaseModel):
    status: str   # "approved" | "rejected"
    review_notes: str | None = None


@router.get("/corrections")
async def list_corrections(
    status: str | None = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all master data correction requests."""
    query = select(MasterDataCorrection).order_by(MasterDataCorrection.created_at.desc())
    if status:
        query = query.where(MasterDataCorrection.status == status)
    result = await db.execute(query)
    corrections = result.scalars().all()
    return [
        {
            "id": c.id,
            "customer_part_no": c.customer_part_no,
            "customer_name": c.customer_name,
            "field_name": c.field_name,
            "old_value": c.old_value,
            "new_value": c.new_value,
            "reason": c.reason,
            "status": c.status,
            "requested_by": c.requested_by,
            "reviewed_by": c.reviewed_by,
            "reviewed_at": c.reviewed_at.isoformat() if c.reviewed_at else None,
            "review_notes": c.review_notes,
            "created_at": c.created_at.isoformat() if c.created_at else None,
        }
        for c in corrections
    ]


@router.get("/corrections/stats")
async def correction_stats(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Count corrections by status."""
    result = await db.execute(
        select(MasterDataCorrection.status, func.count(MasterDataCorrection.id))
        .group_by(MasterDataCorrection.status)
    )
    counts = {row[0]: row[1] for row in result.all()}
    return {
        "pending": counts.get("pending", 0),
        "approved": counts.get("approved", 0),
        "rejected": counts.get("rejected", 0),
    }


@router.post("/corrections", status_code=201)
async def create_correction(
    data: CorrectionCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Submit a master data correction request."""
    if data.field_name not in CORRECTABLE_FIELDS:
        raise HTTPException(status_code=400, detail=f"Field '{data.field_name}' is not correctable. Allowed: {CORRECTABLE_FIELDS}")

    # Look up current value from master data if old_value not provided
    old_value = data.old_value
    if old_value is None:
        part_result = await db.execute(
            select(MainiPart).where(func.lower(MainiPart.customer_part_no) == data.customer_part_no.strip().lower())
        )
        part = part_result.scalar_one_or_none()
        if part:
            old_value = str(getattr(part, data.field_name, "") or "")

    correction = MasterDataCorrection(
        customer_part_no=data.customer_part_no.strip(),
        customer_name=data.customer_name,
        field_name=data.field_name,
        old_value=old_value,
        new_value=data.new_value.strip(),
        reason=data.reason,
        requested_by=current_user.id,
        status="pending",
    )
    db.add(correction)
    await db.flush()
    logger.info(f"Correction request #{correction.id}: {data.customer_part_no}.{data.field_name} → '{data.new_value}' by user {current_user.email}")
    return {"id": correction.id, "detail": "Correction request submitted"}


@router.put("/corrections/{correction_id}/review")
async def review_correction(
    correction_id: int,
    data: CorrectionReview,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Approve or reject a correction request (Admin only).

    On approval, automatically updates the corresponding MainiPart record.
    """
    if data.status not in ("approved", "rejected"):
        raise HTTPException(status_code=400, detail="Status must be 'approved' or 'rejected'")

    result = await db.execute(select(MasterDataCorrection).where(MasterDataCorrection.id == correction_id))
    correction = result.scalar_one_or_none()
    if not correction:
        raise HTTPException(status_code=404, detail="Correction not found")
    if correction.status != "pending":
        raise HTTPException(status_code=400, detail=f"Correction is already '{correction.status}'")

    correction.status = data.status
    correction.reviewed_by = current_user.id
    correction.reviewed_at = datetime.now(timezone.utc)
    correction.review_notes = data.review_notes

    if data.status == "approved":
        # Apply the correction to the MainiPart record
        part_result = await db.execute(
            select(MainiPart).where(func.lower(MainiPart.customer_part_no) == correction.customer_part_no.strip().lower())
        )
        part = part_result.scalar_one_or_none()
        if part:
            field = correction.field_name
            new_val = correction.new_value
            # Cast to correct type for numeric fields
            if field == "unit_price":
                try:
                    setattr(part, field, float(new_val))
                except ValueError:
                    raise HTTPException(status_code=400, detail=f"Invalid numeric value for unit_price: '{new_val}'")
            else:
                setattr(part, field, new_val)
            logger.info(f"Correction #{correction_id} applied: {correction.customer_part_no}.{field} = '{new_val}'")
        else:
            logger.warning(f"Correction #{correction_id} approved but part '{correction.customer_part_no}' not found in master data")

    await db.flush()
    return {"detail": f"Correction {data.status}", "id": correction_id}


@router.delete("/corrections/{correction_id}")
async def delete_correction(
    correction_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete a correction request (Admin only)."""
    result = await db.execute(select(MasterDataCorrection).where(MasterDataCorrection.id == correction_id))
    correction = result.scalar_one_or_none()
    if not correction:
        raise HTTPException(status_code=404, detail="Correction not found")
    await db.delete(correction)
    await db.flush()
    return {"detail": "Deleted"}
