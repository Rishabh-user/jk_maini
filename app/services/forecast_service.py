"""Internal forecast service.

Handles:
- Parsing the Maini Forecast Excel (rows = parts, columns = months with quantities)
- Storing in forecast_entries table
- Building ZSO-ready forecast rows (enriched from master data) for a given customer
"""

import re
import uuid as _uuid
from collections import defaultdict
from datetime import datetime

import pandas as pd
from sqlalchemy import select, delete, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data import ForecastEntry, MainiPart
from app.utils.logging import logger

# Regex: detect month-period column headers like "Nov-2025", "Jan-2026", "Oct-25", "PO Oct-25"
_PERIOD_RE = re.compile(
    r"(?:^|.*\s)([A-Za-z]{3}[-\s](\d{4}|\d{2}))$",
    re.IGNORECASE,
)


def _parse_period_date(period_str: str) -> datetime | None:
    """Convert 'Nov-2025', 'PO Oct-25', 'Oct-2025' → datetime(2025, 11, 1)."""
    s = period_str.strip()
    # Strip leading labels like "PO " or "FY " etc.
    s = re.sub(r"^[A-Z]{1,3}\s+", "", s, flags=re.IGNORECASE).strip()
    for fmt in ["%b-%Y", "%b-%y", "%b %Y", "%b %y"]:
        try:
            return datetime.strptime(s, fmt)
        except ValueError:
            pass
    return None


def _is_period_column(col) -> bool:
    """Return True if column header looks like a forecast period (month label).

    Handles both:
    - String labels like "Nov-2025", "PO Oct-25"
    - datetime objects (Excel stores month headers as date cells) like datetime(2025, 11, 1)
    """
    if isinstance(col, datetime):
        return True
    return _parse_period_date(str(col)) is not None


def _period_label(col) -> str:
    """Return a human-readable period label ("Nov-2025") for a column header."""
    if isinstance(col, datetime):
        return col.strftime("%b-%Y")
    return str(col).strip()


def parse_forecast_excel(filepath: str, customer_name: str) -> list[dict]:
    """Parse a Maini forecast Excel file.

    Expected layout:
        Row 0:  Index numbers (skip)
        Row 1:  "FORECAST" label (skip)
        Row 2:  Column headers  ← header_row
        Row 3+: Data rows  (Sl no | Comp. Part Number | period-col … )

    Returns list of dicts: {part_number, period, period_date, quantity, customer_name}
    Only non-zero quantities are returned.
    """
    try:
        xl = pd.ExcelFile(filepath)
        # Use first non-empty sheet
        sheet = xl.sheet_names[0]
        # Read raw WITHOUT dtype=str so datetime columns are preserved as datetime
        df_raw = pd.read_excel(filepath, sheet_name=sheet, header=None)
    except Exception as exc:
        raise ValueError(f"Cannot read forecast Excel: {exc}") from exc

    # Find header row — look for a row containing "part number" or "part no" (case-insensitive)
    # (only string cells can match; datetime cells are month headers and skip cleanly)
    header_idx = None
    for idx, row in df_raw.iterrows():
        row_vals = " ".join(
            str(v).lower() for v in row.values
            if pd.notna(v) and not isinstance(v, datetime)
        )
        if "part number" in row_vals or "part no" in row_vals:
            header_idx = idx
            break

    if header_idx is None:
        # Fall back: row 2 (index 2)
        header_idx = 2

    # Read again with proper header — do NOT force dtype=str so datetime cols are kept as datetime
    df = pd.read_excel(filepath, sheet_name=sheet, header=header_idx)

    # Find the "Comp. Part Number" column (or similar) — only string columns qualify
    part_col = None
    for col in df.columns:
        if isinstance(col, datetime):
            continue
        cl = str(col).lower().replace(".", "").replace(" ", "")
        if "partnumber" in cl or "partno" in cl or "comppart" in cl:
            part_col = col
            break

    if part_col is None:
        raise ValueError("Could not find part number column in forecast Excel")

    # Identify period columns
    period_cols = [c for c in df.columns if c != part_col and _is_period_column(c)]
    logger.info(f"Forecast parse: part_col='{part_col}', {len(period_cols)} period columns, {len(df)} rows")

    entries = []
    for _, row in df.iterrows():
        pn = str(row.get(part_col, "") or "").strip()
        if not pn or pn.lower() in ("nan", "none", ""):
            continue
        # Skip header-like rows that accidentally got included
        if pn.lower() in ("comp. part number", "part number", "sl no"):
            continue

        for pc in period_cols:
            raw_qty = row.get(pc)
            if raw_qty is None or (isinstance(raw_qty, float) and pd.isna(raw_qty)):
                continue
            try:
                qty = float(str(raw_qty).replace(",", "").strip())
            except (ValueError, TypeError):
                continue
            if qty <= 0:
                continue

            # Period label and date — datetime columns give us the date directly
            if isinstance(pc, datetime):
                period_label = pc.strftime("%b-%Y")
                period_date = pc
            else:
                period_label = str(pc).strip()
                period_date = _parse_period_date(period_label)

            entries.append({
                "customer_name": customer_name,
                "part_number": pn,
                "period": period_label,
                "period_date": period_date,
                "quantity": qty,
            })

    logger.info(f"Forecast parse: {len(entries)} non-zero quantity entries across {len(set(e['part_number'] for e in entries))} parts")
    return entries


async def save_forecast_entries(
    db: AsyncSession,
    entries: list[dict],
    customer_name: str,
    source_file: str,
    uploaded_by: int,
) -> dict:
    """Clear existing forecast for customer and insert new entries."""
    # Delete old entries for this customer
    await db.execute(
        delete(ForecastEntry).where(
            func.lower(ForecastEntry.customer_name) == customer_name.strip().lower()
        )
    )

    count = 0
    for e in entries:
        fe = ForecastEntry(
            customer_name=e["customer_name"],
            part_number=e["part_number"],
            period=e["period"],
            period_date=e["period_date"],
            quantity=e["quantity"],
            source_file=source_file,
            uploaded_by=uploaded_by,
        )
        db.add(fe)
        count += 1

    await db.flush()
    logger.info(f"Forecast saved: {count} entries for '{customer_name}' from '{source_file}'")
    return {"inserted": count, "customer_name": customer_name}


async def get_forecast_summary(db: AsyncSession) -> list[dict]:
    """Return a summary grouped by customer_name."""
    result = await db.execute(
        select(ForecastEntry).order_by(ForecastEntry.customer_name, ForecastEntry.part_number, ForecastEntry.period_date)
    )
    entries = result.scalars().all()

    summary: dict[str, dict] = {}
    for e in entries:
        cname = e.customer_name
        if cname not in summary:
            summary[cname] = {
                "customer_name": cname,
                "parts": set(),
                "periods": set(),
                "total_quantity": 0.0,
                "source_file": e.source_file,
                "uploaded_at": e.uploaded_at.isoformat() if e.uploaded_at else None,
            }
        summary[cname]["parts"].add(e.part_number)
        summary[cname]["periods"].add(e.period)
        summary[cname]["total_quantity"] += e.quantity

    return [
        {
            "customer_name": v["customer_name"],
            "part_count": len(v["parts"]),
            "period_count": len(v["periods"]),
            "total_quantity": round(v["total_quantity"], 0),
            "source_file": v["source_file"],
            "uploaded_at": v["uploaded_at"],
        }
        for v in summary.values()
    ]


async def get_forecast_parts(db: AsyncSession, customer_name: str) -> list[dict]:
    """Return forecast data grouped by part (one row per part with schedule dict).

    Used for display in the Forecast tab.
    """
    result = await db.execute(
        select(ForecastEntry)
        .where(func.lower(ForecastEntry.customer_name) == customer_name.strip().lower())
        .order_by(ForecastEntry.part_number, ForecastEntry.period_date)
    )
    entries = result.scalars().all()

    parts: dict[str, dict] = {}
    for e in entries:
        if e.part_number not in parts:
            parts[e.part_number] = {
                "part_number": e.part_number,
                "customer_name": e.customer_name,
                "schedule": {},
                "total_quantity": 0.0,
            }
        parts[e.part_number]["schedule"][e.period] = e.quantity
        parts[e.part_number]["total_quantity"] += e.quantity

    return list(parts.values())


async def get_forecast_rows_by_parts(db: AsyncSession, customer_part_numbers: list[str]) -> list[dict]:
    """Get forecast rows matched by customer part numbers (primary key).

    This is the preferred lookup — it works even when the customer name is
    missing or inconsistently spelled in the demand file.
    Returns ZSO-ready forecast rows (same format as demand-file forecast rows).
    """
    if not customer_part_numbers:
        return []

    import uuid as _uuid
    normalized = [p.strip().lower() for p in customer_part_numbers if p and p.strip()]
    if not normalized:
        return []

    result = await db.execute(
        select(ForecastEntry)
        .where(func.lower(ForecastEntry.part_number).in_(normalized))
        .order_by(ForecastEntry.part_number, ForecastEntry.period_date)
    )
    entries = result.scalars().all()

    if not entries:
        return []

    # Group by (customer_name, part_number) → schedule dict
    groups: dict[tuple, dict] = defaultdict(dict)
    for e in entries:
        if e.quantity > 0:
            groups[(e.customer_name, e.part_number)][e.period] = e.quantity

    rows = []
    for (cname, part_no), schedule in groups.items():
        if not schedule:
            continue

        master_result = await db.execute(
            select(MainiPart).where(
                func.lower(MainiPart.customer_part_no) == part_no.strip().lower()
            )
        )
        master = master_result.scalar_one_or_none()

        row = {
            "Customer Name": cname,
            "Customer Part #": part_no,
            "Maini Part #": master.maini_part_no if master else "",
            "Unit Price": master.unit_price if master and master.unit_price is not None else "",
            "Currency": (master.currency or "USD") if master else "USD",
            "PO Number": "Internal Forecast",
            "Delivery Date": "",
            "forecast_schedule": schedule,
            "_match_status": "matched" if master else "unmatched",
            "_row_id": str(_uuid.uuid5(
                _uuid.NAMESPACE_URL,
                f"{part_no.strip().lower()}|internal forecast|{cname.strip().lower()}"
            )),
            "_source": "internal_forecast",
        }
        rows.append(row)

    logger.info(f"Forecast rows by part#: {len(rows)} parts matched from {len(customer_part_numbers)} demand parts")
    return rows


async def get_forecast_rows_for_zso(db: AsyncSession, customer_name: str) -> list[dict]:
    """Build ZSO-ready forecast rows for the given customer.

    Each part becomes ONE forecast row with a forecast_schedule dict
    (same format as demand-file forecast rows so zso_service handles them identically).
    Unit price and Maini Part # are enriched from master data via customer_part_no lookup.
    Rows are labelled PO Number = 'Internal Forecast' so they appear as forecast in ZSO.
    """
    result = await db.execute(
        select(ForecastEntry)
        .where(func.lower(ForecastEntry.customer_name) == customer_name.strip().lower())
        .order_by(ForecastEntry.part_number, ForecastEntry.period_date)
    )
    entries = result.scalars().all()

    if not entries:
        return []

    # Group by part_number → schedule dict
    groups: dict[str, dict[str, float]] = defaultdict(dict)
    for e in entries:
        if e.quantity > 0:
            groups[e.part_number][e.period] = e.quantity

    rows = []
    for part_no, schedule in groups.items():
        if not schedule:
            continue

        # Enrich from master data
        master_result = await db.execute(
            select(MainiPart).where(
                func.lower(MainiPart.customer_part_no) == part_no.strip().lower()
            )
        )
        master = master_result.scalar_one_or_none()

        row = {
            "Customer Name": customer_name,
            "Customer Part #": part_no,
            "Maini Part #": master.maini_part_no if master else "",
            "Unit Price": master.unit_price if master and master.unit_price is not None else "",
            "Currency": (master.currency or "USD") if master else "USD",
            "PO Number": "Internal Forecast",
            "Delivery Date": "",
            "forecast_schedule": schedule,
            "_match_status": "matched" if master else "unmatched",
            "_row_id": str(_uuid.uuid5(
                _uuid.NAMESPACE_URL,
                f"{part_no.strip().lower()}|internal forecast|{customer_name.strip().lower()}"
            )),
            "_source": "internal_forecast",
        }
        rows.append(row)

    logger.info(f"Forecast ZSO rows for '{customer_name}': {len(rows)} parts")
    return rows
