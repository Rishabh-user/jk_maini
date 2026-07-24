import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func, delete
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import InventoryStock, AllocationResult, ZSOReport, CoverageReport, MainiPart
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

# SAP Open Orders — production order types that represent true WIP
# YBM5 = standard production order, YBM6/YBM7 = variants
# YRW3 = rework order — excluded (not new stock, just fixing existing)
_WIP_VALID_ORDER_TYPES = {"YBM5", "YBM6", "YBM7"}

router = APIRouter(prefix="/inventory", tags=["Inventory & Liquidation"])


def _parse_upload_with_header(content: bytes, ext: str, must_have: tuple[str, ...]) -> pd.DataFrame:
    """Parse an xlsx/csv upload, auto-detecting a header row that may not be row 0
    (VMI / Safety-stock exports have a couple of blank/title rows on top).
    `must_have` = lowercase substrings; the header row must contain at least two.
    """
    if ext == "csv":
        raw = pd.read_csv(io.BytesIO(content), header=None)
    else:
        raw = pd.read_excel(io.BytesIO(content), header=None, engine="openpyxl" if ext == "xlsx" else "xlrd")
    raw = raw.dropna(how="all").reset_index(drop=True)

    header_idx = 0
    for i in range(min(8, len(raw))):
        cells = [str(v).strip().lower() for v in raw.iloc[i] if pd.notna(v)]
        hits = sum(1 for mh in must_have if any(mh in c for c in cells))
        if hits >= 2:
            header_idx = i
            break
    df = raw.iloc[header_idx + 1:].copy()
    df.columns = [str(v).strip() if pd.notna(v) else f"col_{j}" for j, v in enumerate(raw.iloc[header_idx])]
    return df.dropna(how="all").reset_index(drop=True)


def _pick(row: dict, *subs: str):
    """Return the first cell whose column header contains one of `subs` (lowercase)."""
    for k, v in row.items():
        kl = str(k).strip().lower()
        if any(s in kl for s in subs):
            return v
    return None


def _effective_annotated_rows(uploads: list[InventoryStock]) -> list[dict]:
    """Combine the chosen uploads into one classified row set.

    - If a 'combined' upload exists, it supersedes separate plant/warehouse uploads.
    - Legacy uploads (raw rows, pre-classification) are classified on the fly.
    """
    from app.services.stock_service import classify_rows
    kinds = {u.stock_type for u in uploads}
    rows: list[dict] = []
    for u in uploads:
        if "combined" in kinds and u.stock_type in ("plant", "warehouse", "fg_inhouse", "fg_warehouse"):
            continue
        data = (u.parsed_data or {}).get("rows", [])
        if data and isinstance(data[0], dict) and "_category" in data[0]:
            rows.extend(data)
        else:  # legacy raw rows → classify now
            rows.extend(classify_rows(data)[0])
    return rows


@router.get("/summary")
async def get_inventory_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Inventory summary — stock totals by category (FG / Child / WIP / RM)."""
    from app.services.stock_service import stock_by_part
    uploads = await _latest_classified_uploads(db)
    rows = _effective_annotated_rows(uploads)

    # Aggregate qty by category + plant group
    cat_totals = {"fg": {"parts": set(), "qty": 0.0}, "child": {"parts": set(), "qty": 0.0},
                  "wip": {"parts": set(), "qty": 0.0}, "rm": {"parts": set(), "qty": 0.0}}
    grp_totals: dict[str, float] = {}
    for r in rows:
        c = r.get("_category")
        if c in cat_totals:
            cat_totals[c]["parts"].add(r.get("_part")); cat_totals[c]["qty"] += float(r.get("_qty") or 0)
        grp_totals[r.get("_plant_group", "unknown")] = grp_totals.get(r.get("_plant_group", "unknown"), 0.0) + float(r.get("_qty") or 0)

    categories = {k: {"parts": len(v["parts"]), "qty": round(v["qty"], 2)} for k, v in cat_totals.items()}

    alloc_counts = await db.execute(
        select(AllocationResult.allocation_type, func.count(AllocationResult.id))
        .group_by(AllocationResult.allocation_type)
    )
    alloc_map = {row[0]: row[1] for row in alloc_counts.all()}

    latest = (await db.execute(
        select(AllocationResult).order_by(AllocationResult.created_at.desc()).limit(1)
    )).scalar_one_or_none()

    return {
        "categories": categories,                              # FG / Child / WIP / RM
        "by_group": {k: round(v, 2) for k, v in grp_totals.items()},
        "uploads": [{"kind": u.stock_type, "filename": u.filename, "rows": u.row_count,
                     "at": u.created_at.isoformat() if u.created_at else None} for u in uploads],
        # legacy keys kept so the current UI keeps working
        "stocks": {
            "fg_inhouse": {"uploads": 0, "rows": categories["fg"]["parts"]},
            "fg_warehouse": {"uploads": 0, "rows": 0},
            "wip": {"uploads": 0, "rows": categories["wip"]["parts"]},
        },
        "allocations": {"fg": alloc_map.get("fg", 0), "wip": alloc_map.get("wip", 0), "combined": alloc_map.get("combined", 0)},
        "latest_summary": latest.summary if latest else {},
    }


def _is_forecast_line(item: dict) -> bool:
    """True if a ZSO line is forecast (not a firm PO).

    The source labels vary — 'Forecast', 'Internal Forecast', etc. — so we match
    any label containing 'forecast'. A real PO number or 'PO' never does. This is
    the single source of truth used by both liquidation and allocation so the two
    never disagree on what counts as firm demand.
    """
    return "forecast" in str(item.get("po_forecast") or "").strip().lower()


def _ship_month(item: dict) -> str:
    """Sortable YYYY-MM bucket for a demand line.

    Handles the varied date shapes in ZSO items: sales_month is a '%b-%Y'
    label ('Oct-2025'), ship_date/doc_date may be ISO or other formats.
    """
    for src in (item.get("sales_month"), item.get("ship_date"), item.get("doc_date")):
        s = str(src or "").strip()
        if not s:
            continue
        try:
            from dateutil import parser as date_parser
            return date_parser.parse(s).strftime("%Y-%m")
        except Exception:
            continue
    return "unscheduled"


@router.get("/fg-liquidation")
async def fg_liquidation(
    zso_report_id: int = Query(None, description="Demand source; defaults to the latest ZSO report."),
    scope: str = Query("report", regex="^(report|all)$",
                       description="'report' = only parts in the selected ZSO; 'all' = every stock part."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """FG Liquidation report.

    Per Maini part: FG / Child / WIP stock in quantity AND value, split by
    plant vs warehouse, matched against open PO demand (surplus vs backlog),
    with a month-wise demand breakdown.

    Firm **PO demand** drives all liquidation metrics (surplus / backlog /
    status). **Forecast** is surfaced as a separate, informational column and
    never affects status. Scope defaults to the parts in the selected ZSO
    ('report'); pass scope=all for the full inventory view.
    """
    from app.services.stock_service import part_breakdown

    # ── Stock side ──────────────────────────────────────────────────────
    uploads = await _latest_classified_uploads(db)
    ann_rows = _effective_annotated_rows(uploads)
    breakdown = part_breakdown(ann_rows)

    # ── Price / master-data enrichment (by Maini part) ──────────────────
    parts = await db.execute(
        select(MainiPart.maini_part_no, MainiPart.customer_part_no, MainiPart.customer_name,
               MainiPart.description, MainiPart.unit_price, MainiPart.currency)
    )
    price_map: dict[str, dict] = {}
    for mp, cust, cname, desc, price, curr in parts.all():
        key = (mp or "").strip()
        if key and key not in price_map:
            price_map[key] = {"cust_part_no": cust, "customer": cname,
                              "description": desc, "unit_price": price, "currency": (curr or "INR")}

    # ── Demand side (open PO only, month-wise) ──────────────────────────
    if zso_report_id:
        zso = (await db.execute(select(ZSOReport).where(ZSOReport.id == zso_report_id))).scalar_one_or_none()
    else:
        zso = (await db.execute(select(ZSOReport).order_by(ZSOReport.created_at.desc()).limit(1))).scalar_one_or_none()

    demand_by_part: dict[str, float] = {}      # firm PO demand
    forecast_by_part: dict[str, float] = {}     # informational only
    monthly_by_part: dict[str, dict] = {}
    if zso:
        for item in (zso.report_data or {}).get("items", []):
            mp = str(item.get("maini_part_no") or "").strip()
            if not mp:
                continue
            qty = float(item.get("open_qty", item.get("quantity", 0)) or 0)
            is_forecast = _is_forecast_line(item)
            if is_forecast:
                forecast_by_part[mp] = forecast_by_part.get(mp, 0.0) + qty
                continue
            # Firm PO line — drives status + month buckets.
            demand_by_part[mp] = demand_by_part.get(mp, 0.0) + qty
            month = _ship_month(item)
            monthly_by_part.setdefault(mp, {})
            monthly_by_part[mp][month] = monthly_by_part[mp].get(month, 0.0) + qty

    # ── Assemble per-part rows ──────────────────────────────────────────
    # report scope → only parts referenced by the ZSO (PO or forecast);
    # all scope → every stock part plus any demand part.
    if scope == "all":
        all_parts = set(breakdown) | set(demand_by_part) | set(forecast_by_part)
    else:
        all_parts = set(demand_by_part) | set(forecast_by_part)
    rows = []
    value_by_currency: dict[str, float] = {}
    tot = {"fg": 0.0, "fg_plant": 0.0, "fg_warehouse": 0.0, "child": 0.0,
           "wip": 0.0, "in_transit": 0.0, "demand": 0.0, "forecast": 0.0, "surplus": 0.0, "backlog": 0.0}
    status_counts = {"surplus": 0, "covered": 0, "short": 0, "no_demand": 0}

    for mp in all_parts:
        b = breakdown.get(mp, {"fg": 0, "fg_plant": 0, "fg_warehouse": 0, "child": 0, "wip": 0, "rm": 0, "in_transit": 0})
        meta = price_map.get(mp, {})
        fg = round(b["fg"], 2)
        demand = round(demand_by_part.get(mp, 0.0), 2)
        forecast = round(forecast_by_part.get(mp, 0.0), 2)
        surplus = round(max(fg - demand, 0.0), 2)
        backlog = round(max(demand - fg, 0.0), 2)

        if demand <= 0:
            status = "no_demand"
        elif fg >= demand:
            status = "surplus" if fg > demand else "covered"
        else:
            status = "short"
        status_counts[status] += 1

        unit_price = meta.get("unit_price")
        currency = (meta.get("currency") or "INR").upper()
        fg_value = round(fg * unit_price, 2) if unit_price else None
        if fg_value:
            value_by_currency[currency] = round(value_by_currency.get(currency, 0.0) + fg_value, 2)

        rows.append({
            "maini_part_no": mp,
            "cust_part_no": meta.get("cust_part_no") or "",
            "customer": meta.get("customer") or "",
            "description": meta.get("description") or "",
            "fg_qty": fg, "fg_plant": round(b["fg_plant"], 2), "fg_warehouse": round(b["fg_warehouse"], 2),
            "child_qty": round(b["child"], 2), "wip_qty": round(b["wip"], 2),
            "in_transit": round(b["in_transit"], 2),
            "unit_price": unit_price, "currency": currency, "fg_value": fg_value,
            "demand_qty": demand, "forecast_qty": forecast,
            "surplus_qty": surplus, "backlog_qty": backlog,
            "status": status,
            "monthly_demand": {k: round(v, 2) for k, v in sorted(monthly_by_part.get(mp, {}).items())},
        })

        tot["fg"] += fg; tot["fg_plant"] += b["fg_plant"]; tot["fg_warehouse"] += b["fg_warehouse"]
        tot["child"] += b["child"]; tot["wip"] += b["wip"]; tot["in_transit"] += b["in_transit"]
        tot["demand"] += demand; tot["forecast"] += forecast
        tot["surplus"] += surplus; tot["backlog"] += backlog

    # Highest FG value first (unpriced rows fall to the bottom), then biggest surplus.
    rows.sort(key=lambda r: (r["fg_value"] or 0, r["surplus_qty"]), reverse=True)

    priced = sum(1 for r in rows if r["fg_value"] is not None and r["fg_qty"] > 0)
    unpriced = sum(1 for r in rows if r["fg_value"] is None and r["fg_qty"] > 0)

    # Collect the union of months for a stable column order on the client.
    months = sorted({m for r in rows for m in r["monthly_demand"]})

    # Lightweight ZSO list so the client can offer a report selector.
    zso_list = (await db.execute(
        select(ZSOReport.id, ZSOReport.kas_name, ZSOReport.created_at)
        .order_by(ZSOReport.created_at.desc()).limit(50)
    )).all()

    return {
        "rows": rows,
        "months": months,
        "scope": scope,
        "totals": {k: round(v, 2) for k, v in tot.items()},
        "value_by_currency": value_by_currency,
        "status_counts": status_counts,
        "coverage": {"priced_parts": priced, "unpriced_parts": unpriced},
        "demand_source": {"zso_report_id": zso.id if zso else None,
                          "created_at": zso.created_at.isoformat() if zso and zso.created_at else None},
        "available_reports": [{"id": r[0], "label": r[1] or f"ZSO #{r[0]}",
                               "at": r[2].isoformat() if r[2] else None} for r in zso_list],
        "stock_uploads": [{"kind": u.stock_type, "filename": u.filename,
                           "at": u.created_at.isoformat() if u.created_at else None} for u in uploads],
    }


@router.post("/upload-stock")
async def upload_stock_file(
    stock_type: str = Query(None, description="Optional legacy hint; classification is now data-driven."),
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload a stock / open-orders file (plant, warehouse, or one combined SAP export).

    Each row is auto-classified by material type + plant into FG / Child / WIP / RM,
    so you no longer need to pick a stock type — a single combined file works too.
    """
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

    # Auto-classify every row (FG / Child / WIP / RM; scrap dropped; plant/warehouse split)
    from app.services.stock_service import classify_rows
    annotated, summary = classify_rows(rows)

    # Detect the upload "kind" so re-uploading the same kind replaces the old one.
    cats = summary.get("by_category", {})
    groups = summary.get("by_group", {})
    wip_qty = cats.get("wip", {}).get("qty", 0)
    other_qty = sum(cats.get(c, {}).get("qty", 0) for c in ("fg", "child", "rm"))
    if wip_qty > other_qty:
        kind = "wip"
    elif "plant" in groups and "warehouse" in groups:
        kind = "combined"
    elif "warehouse" in groups:
        kind = "warehouse"
    elif "plant" in groups:
        kind = "plant"
    else:
        kind = "other"

    stock = InventoryStock(
        uploaded_by=current_user.id,
        stock_type=kind,           # plant | warehouse | wip | combined; rows carry _category
        filename=filename,
        parsed_data={"columns": df.columns.tolist(), "rows": annotated, "summary": summary},
        row_count=len(annotated),
    )
    db.add(stock)
    await db.flush()

    logger.info(f"Stock upload: file={filename}, kind={kind}, {len(annotated)} rows, {summary['by_category']}")
    return {
        "id": stock.id,
        "kind": kind,
        "filename": filename,
        "row_count": len(annotated),
        "summary": summary,
    }


async def _latest_classified_uploads(db: AsyncSession) -> list[InventoryStock]:
    """Return the latest stock upload per kind. A newer 'combined' upload wins
    over separate plant/warehouse uploads."""
    uploads = (await db.execute(
        select(InventoryStock).order_by(InventoryStock.created_at.desc())
    )).scalars().all()
    latest_by_kind: dict[str, InventoryStock] = {}
    for u in uploads:
        if u.stock_type in ("fg_inhouse", "fg_warehouse", "wip", "plant", "warehouse", "combined", "other"):
            latest_by_kind.setdefault(u.stock_type, u)
    # If a combined upload is the newest overall, prefer it for FG and drop plant/warehouse
    chosen = list(latest_by_kind.values())
    return chosen


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

    all_items = (zso.report_data or {}).get("items", [])

    # Exclude forecast rows — they are planning data, not real PO demand.
    # Allocating stock against forecast would double-count the same WIP pool.
    demand_items = [item for item in all_items if not _is_forecast_line(item)]

    # Build per-part stock from classified uploads: {part: {fg, child, wip, rm, in_transit}}
    from app.services.stock_service import stock_by_part as build_stock_by_part
    uploads = await _latest_classified_uploads(db)
    ann_rows = _effective_annotated_rows(uploads)
    part_stock = build_stock_by_part(ann_rows)

    # Group demand by Maini Part # so the shared stock pool is allocated once,
    # not independently per ZSO row (which would double-count WIP).
    # Multiple PO lines for the same Maini part are summed into one demand figure.
    from collections import defaultdict
    grouped: dict[str, dict] = {}
    for item in demand_items:
        maini_part = (item.get("maini_part_no") or "").strip()
        if not maini_part:
            continue
        if maini_part not in grouped:
            grouped[maini_part] = {
                "maini_part_no": maini_part,
                "cust_part_no": (item.get("cust_part_no") or item.get("customer_part_no") or "").strip(),
                "customer": (item.get("customer_name") or "").strip(),
                "demand_qty": 0.0,
            }
        grouped[maini_part]["demand_qty"] += float(item.get("open_qty", item.get("quantity", 0)) or 0)

    # Allocate
    allocations = []
    fully_allocated = 0
    partial = 0
    no_stock = 0

    for maini_part, grp in grouped.items():
        demand_qty = grp["demand_qty"]

        stock_info = part_stock.get(maini_part, {"fg": 0, "child": 0, "wip": 0, "rm": 0})
        total_fg = stock_info.get("fg", 0)
        child_qty = stock_info.get("child", 0)
        wip_qty = stock_info.get("wip", 0)

        total_available = (
            total_fg + wip_qty if allocation_type == "combined"
            else (total_fg if allocation_type == "fg" else wip_qty)
        )
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
            "cust_part_no": grp["cust_part_no"],
            "maini_part_no": maini_part,
            "customer": grp["customer"],
            "demand_qty": demand_qty,
            "fg_inhouse": total_fg,   # kept for UI backward-compat (= FG total)
            "fg_warehouse": 0,
            "total_fg": total_fg,
            "child_qty": child_qty,
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


@router.delete("/stock")
async def delete_stock(
    stock_type: str = Query(None, description="Delete only this stock type: fg_inhouse, fg_warehouse, wip. Omit to delete ALL."),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete uploaded stock data. Pass stock_type to delete one type, or omit to wipe all."""
    if stock_type:
        if stock_type not in ("fg_inhouse", "fg_warehouse", "wip", "plant", "warehouse", "combined", "other"):
            raise HTTPException(status_code=400, detail="Invalid stock_type")
        result = await db.execute(delete(InventoryStock).where(InventoryStock.stock_type == stock_type))
        deleted = result.rowcount
        logger.info(f"Deleted {deleted} stock records of type={stock_type} by {current_user.email}")
        return {"deleted": deleted, "stock_type": stock_type}
    else:
        result = await db.execute(delete(InventoryStock))
        deleted = result.rowcount
        logger.info(f"Deleted ALL {deleted} stock records by {current_user.email}")
        return {"deleted": deleted, "stock_type": "all"}


@router.get("/vmi-safety")
async def vmi_safety_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """VMI & Safety-stock view: replenishment policy vs current FG on-hand.

    Reads the VMI / Safety-stock files uploaded in **Demand Management**
    (DemandUpload, types 'vmi' / 'safety_stock') — single upload workflow, no
    duplicate upload here. This analysis will move into the Coverage Report.

    - VMI: Min/Max band per part → below-min (replenish) / in-band / above-max.
    - Safety stock: required safety qty per part, segregated by customer/KAS,
      compared to current FG stock (short vs met). NB: the provided file is
      customer-facing safety stock only — no plant safety stock present.
    """
    from app.services.stock_service import part_breakdown
    from app.models.data import DemandUpload

    d_uploads = (await db.execute(
        select(DemandUpload).where(DemandUpload.upload_type.in_(("vmi", "safety_stock")))
        .order_by(DemandUpload.created_at.desc())
    )).scalars().all()
    latest = {}
    for u in d_uploads:
        latest.setdefault(u.upload_type, u)

    # Current FG on hand per part (reuse the classified stock)
    fg_uploads = await _latest_classified_uploads(db)
    breakdown = part_breakdown(_effective_annotated_rows(fg_uploads))
    fg_of = lambda p: round(breakdown.get(p, {}).get("fg", 0.0), 2)

    def _n(v):
        try:
            return float(str(v).replace(",", "").strip() or 0)
        except (ValueError, TypeError):
            return 0.0

    # ── VMI ──
    vmi_rows, vmi_below = [], 0
    vu = latest.get("vmi")
    if vu:
        for r in (vu.parsed_data or {}).get("rows", []):
            mp = str(_pick(r, "mpp part", "maini part") or "").strip()
            if not mp:
                continue
            mn, mx = _n(_pick(r, "min")), _n(_pick(r, "max"))
            fg = fg_of(mp)
            status = "below_min" if fg < mn else ("above_max" if mx and fg > mx else "in_band")
            if status == "below_min":
                vmi_below += 1
            vmi_rows.append({
                "maini_part_no": mp, "cust_part_no": str(_pick(r, "pn #", "cust part", "customer part") or "").strip(),
                "min_qty": mn, "max_qty": mx, "fg_qty": fg,
                "replenish_to_max": round(max(mx - fg, 0), 2) if mx else 0, "status": status,
            })
        vmi_rows.sort(key=lambda x: (x["status"] != "below_min", x["maini_part_no"]))

    # ── Safety stock (customer-facing) ──
    safety_rows, by_customer, short_count = [], {}, 0
    su = latest.get("safety_stock")
    if su:
        for r in (su.parsed_data or {}).get("rows", []):
            mp = str(_pick(r, "maini part") or "").strip()
            if not mp:
                continue
            req = _n(_pick(r, "open qty", "safety", "qty"))
            fg = fg_of(mp)
            cust = str(_pick(r, "customer name", "customer") or "—").strip() or "—"
            status = "short" if fg < req else "met"
            if status == "short":
                short_count += 1
            safety_rows.append({
                "maini_part_no": mp, "cust_part_no": str(_pick(r, "cust part", "customer part") or "").strip(),
                "customer": cust, "kas": str(_pick(r, "kas") or "").strip(),
                "site": str(_pick(r, "site") or "").strip(),
                "safety_qty": req, "fg_qty": fg, "shortfall": round(max(req - fg, 0), 2), "status": status,
            })
            g = by_customer.setdefault(cust, {"parts": 0, "safety_qty": 0.0, "short": 0})
            g["parts"] += 1; g["safety_qty"] += req; g["short"] += 1 if status == "short" else 0
        safety_rows.sort(key=lambda x: (x["status"] != "short", -x["shortfall"]))

    return {
        "vmi": {
            "rows": vmi_rows, "total": len(vmi_rows), "below_min": vmi_below,
            "source": vu.filename if vu else None,
        },
        "safety": {
            "rows": safety_rows, "total": len(safety_rows), "short": short_count,
            "by_customer": {k: {"parts": v["parts"], "safety_qty": round(v["safety_qty"], 2), "short": v["short"]}
                            for k, v in sorted(by_customer.items())},
            "source": su.filename if su else None,
            "note": "Customer-facing safety stock only — no plant safety stock in the provided file.",
        },
    }


@router.delete("/allocations")
async def delete_allocations(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete all allocation results (and the coverage reports derived from them)."""
    # Coverage reports FK-reference allocation_results, so remove them first to
    # avoid a ForeignKeyViolation. They're derived data — safe to clear together.
    cov = await db.execute(delete(CoverageReport))
    result = await db.execute(delete(AllocationResult))
    deleted = result.rowcount
    logger.info(f"Deleted ALL {deleted} allocation records ({cov.rowcount} coverage reports) by {current_user.email}")
    return {"deleted": deleted, "coverage_deleted": cov.rowcount}


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
