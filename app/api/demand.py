import io
from difflib import SequenceMatcher
from datetime import datetime, timezone

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from pydantic import BaseModel
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.email import Email
from app.models.data import RawData, ZSOReport, DemandUpload, MainiPart, MasterDataCorrection, DemandFollowUp
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger
from app.services.file_parser import FileParser

# ── Comparison tuning thresholds ────────────────────────────────────────────
OVERLAP_THRESHOLD = 0.30      # min part-number overlap (shared / smaller set) to be "comparable"
MINOR_CHANGE_THRESHOLD = 0.10  # <10% total-qty change between versions = minor bump (v2.1)
ABRUPT_CHANGE_THRESHOLD = 0.50  # >50% per-row qty swing = flag for customer follow-up


def _report_part_set(report_data: dict | None) -> set[str]:
    """Distinct customer part numbers in a report (lower-cased, trimmed)."""
    parts: set[str] = set()
    if not report_data or not isinstance(report_data, dict):
        return parts
    for item in report_data.get("items", []):
        p = str(item.get("cust_part_no") or item.get("customer_part_no") or "").strip().lower()
        if p:
            parts.add(p)
    return parts


def _report_total_qty(report_data: dict | None) -> float:
    total = 0.0
    if not report_data or not isinstance(report_data, dict):
        return total
    for item in report_data.get("items", []):
        if str(item.get("po_forecast") or "").strip().lower() == "internal forecast":
            continue
        try:
            total += float(item.get("open_qty", item.get("quantity", 0)) or 0)
        except (TypeError, ValueError):
            continue
    return total


def _overlap_pct(a: set[str], b: set[str]) -> float:
    """Fraction of the SMALLER set's parts that are shared — intuitive 'match %'."""
    if not a or not b:
        return 0.0
    shared = len(a & b)
    return shared / min(len(a), len(b))


def _filename_sim(a: str, b: str) -> float:
    if not a or not b:
        return 0.0
    return SequenceMatcher(None, a.lower(), b.lower()).ratio()

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

    # Count ZSO total line items + unmatched parts (no Maini Part #) from LATEST ZSO only
    # Latest ZSO is the most actionable — unmatched parts there need immediate attention
    zso_reports_result = await db.execute(
        select(ZSOReport.report_data).order_by(ZSOReport.created_at.desc())
    )
    all_report_data = zso_reports_result.all()

    total_line_items = 0
    unmatched_parts: set[str] = set()   # distinct cust_part_no with no maini_part_no

    for (rd,) in all_report_data:
        if not rd or not isinstance(rd, dict):
            continue
        items = rd.get("items", [])
        total_line_items += len(items)

    # Unmatched = from LATEST report only (most current picture)
    if all_report_data:
        latest_rd = all_report_data[0][0]
        if latest_rd and isinstance(latest_rd, dict):
            for item in latest_rd.get("items", []):
                cust_part = (item.get("cust_part_no") or "").strip()
                maini_part = (item.get("maini_part_no") or "").strip()
                po_forecast = (item.get("po_forecast") or "").strip().lower()
                # Skip Internal Forecast rows — they don't need master data matching
                if cust_part and not maini_part and po_forecast != "internal forecast":
                    unmatched_parts.add(cust_part)

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
        "unmatched_parts": len(unmatched_parts),
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

    def _price_inr(item: dict) -> float:
        try:
            return float(item.get("unit_price_inr") or item.get("unit_price") or 0)
        except (ValueError, TypeError):
            return 0.0

    def _month_key(item: dict) -> str:
        """Sortable YYYY-MM ship-month bucket ('Unscheduled' when absent)."""
        s = str(item.get("ship_date") or item.get("sales_month") or "").strip()
        if not s:
            return "Unscheduled"
        try:
            from dateutil import parser as _dp
            return _dp.parse(s).strftime("%Y-%m")
        except Exception:
            return "Unscheduled"

    for key, curr in curr_items.items():
        if not key:
            continue
        curr_qty = float(curr.get("open_qty", curr.get("quantity", 0)) or 0)
        part = curr.get("cust_part_no", curr.get("customer_part_no", key))
        price = _price_inr(curr)
        if key in prev_items:
            prev = prev_items[key]
            prev_qty = float(prev.get("open_qty", prev.get("quantity", 0)) or 0)
            diff = curr_qty - prev_qty
            # Abrupt = relative swing beyond threshold → needs customer follow-up
            rel = abs(diff) / (prev_qty if prev_qty else 1.0)
            abrupt = rel > ABRUPT_CHANGE_THRESHOLD
            base = {"part": part, "maini_part_no": curr.get("maini_part_no", ""), "customer": curr.get("customer_name", ""),
                    "prev_qty": prev_qty, "curr_qty": curr_qty, "change": diff, "value_change": round(diff * price, 2),
                    "abrupt": abrupt, "po": curr.get("po_forecast", ""), "ship_date": curr.get("ship_date", ""),
                    "month": _month_key(curr), "row_id": key}
            if diff > 0:
                increases.append({**base, "change_type": "increase"})
            elif diff < 0:
                decreases.append({**base, "change_type": "drop"})
        else:
            # A brand-new line is inherently an abrupt addition worth confirming
            new_items.append({"part": part, "maini_part_no": curr.get("maini_part_no", ""), "customer": curr.get("customer_name", ""),
                              "qty": curr_qty, "value": round(curr_qty * price, 2), "abrupt": True, "change_type": "new",
                              "po": curr.get("po_forecast", ""), "ship_date": curr.get("ship_date", ""), "month": _month_key(curr), "row_id": key})

    for key, prev in prev_items.items():
        if key and key not in curr_items:
            prev_qty = float(prev.get("open_qty", prev.get("quantity", 0)) or 0)
            part = prev.get("cust_part_no", prev.get("customer_part_no", key))
            price = _price_inr(prev)
            removed_items.append({"part": part, "maini_part_no": prev.get("maini_part_no", ""), "customer": prev.get("customer_name", ""),
                                  "qty": prev_qty, "value": round(prev_qty * price, 2), "abrupt": True, "change_type": "removed",
                                  "po": prev.get("po_forecast", ""), "ship_date": prev.get("ship_date", ""), "month": _month_key(prev), "row_id": key})

    abrupt_count = (
        sum(1 for x in increases if x["abrupt"])
        + sum(1 for x in decreases if x["abrupt"])
        + len(new_items) + len(removed_items)
    )

    # ── Client-style Drop / Increase aggregations ───────────────────────────
    # Increase bucket = qty increases + new lines; Drop bucket = qty drops +
    # removed lines. Grouped by customer and by ship-month, in qty AND value.
    def _aggregate(dim: str) -> list[dict]:
        groups: dict[str, dict] = {}

        def add(k, inc_q, inc_v, drop_q, drop_v, item):
            g = groups.setdefault(k, {"increase_qty": 0.0, "increase_value": 0.0,
                                      "drop_qty": 0.0, "drop_value": 0.0, "parts": []})
            g["increase_qty"] += inc_q; g["increase_value"] += inc_v
            g["drop_qty"] += drop_q; g["drop_value"] += drop_v
            g["parts"].append(item)

        for x in increases:
            add(x.get(dim) or "—", x["change"], x["value_change"], 0, 0, x)
        for x in decreases:
            add(x.get(dim) or "—", 0, 0, abs(x["change"]), abs(x["value_change"]), x)
        for x in new_items:
            add(x.get(dim) or "—", x["qty"], x["value"], 0, 0, x)
        for x in removed_items:
            add(x.get(dim) or "—", 0, 0, x["qty"], x["value"], x)

        return [{
            dim: k,
            "increase_qty": round(g["increase_qty"], 2), "increase_value": round(g["increase_value"], 2),
            "drop_qty": round(g["drop_qty"], 2), "drop_value": round(g["drop_value"], 2),
            "net_qty": round(g["increase_qty"] - g["drop_qty"], 2),
            "net_value": round(g["increase_value"] - g["drop_value"], 2),
            "part_count": len(g["parts"]),
            "parts": g["parts"],   # for later drill-down (expand a customer/month)
        } for k, g in groups.items()]

    customer_summary = sorted(_aggregate("customer"), key=lambda r: abs(r["net_value"]) or abs(r["net_qty"]), reverse=True)
    monthly_summary = sorted(_aggregate("month"), key=lambda r: (r["month"] == "Unscheduled", r["month"]))

    # Biggest movers first in the detail lists
    increases.sort(key=lambda x: x["change"], reverse=True)
    decreases.sort(key=lambda x: x["change"])   # most negative first

    def _s(items, f):
        return round(sum(f(i) for i in items), 2)
    kpi = {
        "increase_lines": len(increases), "drop_lines": len(decreases),
        "new_lines": len(new_items), "removed_lines": len(removed_items),
        "increase_qty": round(_s(increases, lambda x: x["change"]) + _s(new_items, lambda x: x["qty"]), 2),
        "drop_qty": round(abs(_s(decreases, lambda x: x["change"])) + _s(removed_items, lambda x: x["qty"]), 2),
        "increase_value": round(_s(increases, lambda x: x["value_change"]) + _s(new_items, lambda x: x["value"]), 2),
        "drop_value": round(abs(_s(decreases, lambda x: x["value_change"])) + _s(removed_items, lambda x: x["value"]), 2),
        "abrupt_changes": abrupt_count,
    }
    kpi["net_qty"] = round(kpi["increase_qty"] - kpi["drop_qty"], 2)
    kpi["net_value"] = round(kpi["increase_value"] - kpi["drop_value"], 2)

    return {
        "increases": increases,
        "decreases": decreases,
        "new_items": new_items,
        "removed_items": removed_items,
        "customer_summary": customer_summary,
        "monthly_summary": monthly_summary,
        "kpi": kpi,
        "summary": {
            "total_increases": len(increases),
            "total_decreases": len(decreases),
            "total_new": len(new_items),
            "total_removed": len(removed_items),
            "abrupt_changes": abrupt_count,
        },
    }


# ── Demand follow-ups: audit trail for abrupt changes ───────────────────────

class FollowUpCreate(BaseModel):
    current_report_id: int
    previous_report_id: int
    row_id: str | None = None
    part: str | None = None
    customer: str | None = None
    change_type: str | None = None
    prev_qty: float | None = None
    curr_qty: float | None = None
    note: str | None = None


class FollowUpUpdate(BaseModel):
    note: str | None = None
    status: str | None = None   # open / done


def _followup_dict(f: DemandFollowUp) -> dict:
    return {
        "id": f.id,
        "current_report_id": f.current_report_id,
        "previous_report_id": f.previous_report_id,
        "row_id": f.row_id,
        "part": f.part,
        "customer": f.customer,
        "change_type": f.change_type,
        "prev_qty": f.prev_qty,
        "curr_qty": f.curr_qty,
        "note": f.note,
        "status": f.status,
        "created_by": f.created_by,
        "created_at": f.created_at.isoformat() if f.created_at else None,
        "updated_at": f.updated_at.isoformat() if f.updated_at else None,
    }


@router.get("/followups")
async def list_followups(
    current_report_id: int = Query(...),
    previous_report_id: int = Query(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """All follow-ups logged for a given comparison pair."""
    result = await db.execute(
        select(DemandFollowUp)
        .where(
            DemandFollowUp.current_report_id == current_report_id,
            DemandFollowUp.previous_report_id == previous_report_id,
        )
        .order_by(DemandFollowUp.created_at.desc())
    )
    return [_followup_dict(f) for f in result.scalars().all()]


@router.post("/followups", status_code=201)
async def create_followup(
    payload: FollowUpCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    f = DemandFollowUp(
        current_report_id=payload.current_report_id,
        previous_report_id=payload.previous_report_id,
        row_id=payload.row_id,
        part=payload.part,
        customer=payload.customer,
        change_type=payload.change_type,
        prev_qty=payload.prev_qty,
        curr_qty=payload.curr_qty,
        note=payload.note,
        status="open",
        created_by=current_user.id,
    )
    db.add(f)
    await db.flush()
    await db.refresh(f)
    return _followup_dict(f)


@router.patch("/followups/{followup_id}")
async def update_followup(
    followup_id: int,
    payload: FollowUpUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(DemandFollowUp).where(DemandFollowUp.id == followup_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    if payload.note is not None:
        f.note = payload.note
    if payload.status is not None:
        if payload.status not in ("open", "done"):
            raise HTTPException(status_code=400, detail="status must be 'open' or 'done'")
        f.status = payload.status
    await db.flush()
    await db.refresh(f)
    return _followup_dict(f)


@router.delete("/followups/{followup_id}")
async def delete_followup(
    followup_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(DemandFollowUp).where(DemandFollowUp.id == followup_id))
    f = result.scalar_one_or_none()
    if not f:
        raise HTTPException(status_code=404, detail="Follow-up not found")
    await db.delete(f)
    await db.flush()
    return {"detail": "Follow-up deleted"}


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
        # VMI / Safety-stock exports carry blank/title rows above the header,
        # so detect the real header row instead of assuming row 0.
        if upload_type in ("vmi", "safety_stock"):
            from app.api.inventory import _parse_upload_with_header
            must_have = ("min", "max", "part") if upload_type == "vmi" else ("maini part", "customer", "safety", "part")
            df = _parse_upload_with_header(content, ext, must_have)
        elif ext == "csv":
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


def _assign_versions(group: list[dict]) -> dict[int, str]:
    """Assign version labels (v1, v2, v2.1 …) to a comparable group of reports.

    Ordered by created_at ascending. Each step: if total-qty change vs the
    previous version is < MINOR_CHANGE_THRESHOLD it's a minor bump (v2 → v2.1),
    otherwise a major bump (v2 → v3).
    """
    ordered = sorted(group, key=lambda r: r["created_at"] or "")
    labels: dict[int, str] = {}
    major, minor = 1, 0
    prev_qty = None
    for i, r in enumerate(ordered):
        qty = r["_total_qty"]
        if i == 0:
            major, minor = 1, 0
        else:
            base = prev_qty if prev_qty else 1.0
            rel_change = abs(qty - (prev_qty or 0)) / base if base else 1.0
            if rel_change < MINOR_CHANGE_THRESHOLD:
                minor += 1
            else:
                major += 1
                minor = 0
        labels[r["id"]] = f"v{major}" if minor == 0 else f"v{major}.{minor}"
        prev_qty = qty
    return labels


@router.get("/comparable/{report_id}")
async def comparable_reports(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return reports comparable to the given one, ranked by part-number overlap.

    Matching is based on shared customer part numbers (works even when the
    customer NAME is blank/inconsistent), boosted by source-filename similarity.
    Each comparable report carries a version label within the matched group.
    """
    # Load all candidate reports (id, created_at, report_data, email_id)
    result = await db.execute(
        select(ZSOReport.id, ZSOReport.created_at, ZSOReport.report_data, ZSOReport.email_id)
        .order_by(ZSOReport.created_at.desc())
        .limit(100)
    )
    rows = result.all()

    # Source filename per report (first attachment of its email)
    email_ids = [r[3] for r in rows if r[3]]
    filename_by_email: dict[int, str] = {}
    if email_ids:
        em_result = await db.execute(
            select(Email).where(Email.id.in_(email_ids))
        )
        for em in em_result.scalars().all():
            atts = em.attachments or []
            if atts:
                filename_by_email[em.id] = atts[0].filename or ""

    # Build a record per report
    records: dict[int, dict] = {}
    for rid, created_at, report_data, email_id in rows:
        records[rid] = {
            "id": rid,
            "created_at": created_at.isoformat() if created_at else None,
            "_parts": _report_part_set(report_data),
            "_total_qty": _report_total_qty(report_data),
            "_filename": filename_by_email.get(email_id, ""),
            "_customers": sorted({
                str(it.get("customer_name") or "").strip()
                for it in (report_data or {}).get("items", [])
                if str(it.get("customer_name") or "").strip()
            }) if isinstance(report_data, dict) else [],
            "_item_count": len((report_data or {}).get("items", [])) if isinstance(report_data, dict) else 0,
        }

    target = records.get(report_id)
    if not target:
        raise HTTPException(status_code=404, detail="Report not found")

    # Score every other report against the target
    comparables = []
    for rid, rec in records.items():
        if rid == report_id:
            continue
        overlap = _overlap_pct(target["_parts"], rec["_parts"])
        if overlap < OVERLAP_THRESHOLD:
            continue
        fname_sim = _filename_sim(target["_filename"], rec["_filename"])
        score = round(overlap * 0.8 + fname_sim * 0.2, 4)
        shared = len(target["_parts"] & rec["_parts"])
        comparables.append({
            **rec,
            "overlap_pct": round(overlap * 100),
            "filename_sim": round(fname_sim * 100),
            "score": score,
            "shared_parts": shared,
            "is_older": (rec["created_at"] or "") < (target["created_at"] or ""),
        })

    # Version labels across the matched group (target + comparables)
    group = [target] + comparables
    labels = _assign_versions(group)

    def _public(rec: dict) -> dict:
        return {
            "id": rec["id"],
            "created_at": rec["created_at"],
            "version": labels.get(rec["id"], "v1"),
            "customers": rec.get("_customers", []),
            "item_count": rec.get("_item_count", 0),
            "filename": rec.get("_filename", ""),
            "overlap_pct": rec.get("overlap_pct"),
            "filename_sim": rec.get("filename_sim"),
            "shared_parts": rec.get("shared_parts"),
            "is_older": rec.get("is_older"),
        }

    comparables.sort(key=lambda r: r["score"], reverse=True)
    return {
        "target": _public(target),
        "comparables": [_public(c) for c in comparables],
    }


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
