from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data import ZSOReport
from app.models.user import User
from app.utils.logging import logger


def _is_forecast_row(row: dict) -> bool:
    """Return True if PO Number is a label (e.g. 'Forecast') rather than a real PO number.
    Real PO numbers are purely numeric (with optional dashes/slashes).
    """
    po_value = str(row.get("PO Number", "") or "").strip()
    return bool(po_value) and not po_value.replace("-", "").replace("/", "").isdigit()


def _build_zso_item(row: dict, sr_no: int, kas_name: str, open_qty: float,
                    ship_date: str, po_value: str,
                    forex_rates: dict | None = None) -> tuple[dict, float]:
    """Build a single ZSO line item dict and return (item, line_total_inr)."""
    unit_price = _parse_float(row.get("Unit Price", 0))
    currency = row.get("Currency", "INR")

    # Apply forex conversion using the provided rates
    forex_rates = forex_rates or {}
    fx = forex_rates.get(currency.upper(), {})
    fx_rate = _parse_float(fx.get("rate", 1.0)) if fx else 1.0
    if fx_rate == 0:
        fx_rate = 1.0

    unit_price_inr = round(unit_price * fx_rate, 2)
    line_total_inr = open_qty * unit_price_inr

    item = {
        "row_id": row.get("_row_id", ""),   # deterministic UUID from source row
        "sr_no": sr_no,
        "kas_name": kas_name,
        "customer_name": row.get("Customer Name", ""),
        "site_location": row.get("Customer Location", row.get("Site Location", "")),
        "country": row.get("Country", ""),
        "incoterm": row.get("Incoterm", ""),
        "direct_sales_wh_movement": row.get("Direct Sales / WH Movement", ""),
        "po_forecast": po_value,
        "category": row.get("Category", ""),
        "sub_category": row.get("Sub Category", ""),
        "cust_part_no": row.get("Customer Part #", ""),
        "maini_part_no": row.get("Maini Part #", ""),
        "open_qty": open_qty,
        "unit_price": unit_price,
        "currency": currency,
        "unit_price_inr": round(unit_price_inr, 2),
        "total_inr": round(line_total_inr, 2),
        "doc_date": row.get("PO Date", row.get("Doc Date", "")),
        "ship_date": ship_date,
        "sales_month": _extract_month(ship_date),
        "match_status": row.get("_match_status", "unknown"),
    }
    return item, line_total_inr


def build_zso_data(matched_rows: list[dict], kas_name: str, forex_rates: dict | None = None) -> dict:
    """Transform matched data into ZSO format with calculated fields.

    Handles two row types:
    - PO rows: one ZSO line per row (PO Number is numeric).
    - Forecast rows: PO Number is a label like 'Forecast'.
        If the row carries a forecast_schedule dict {date: qty}, it is
        expanded into one ZSO line per date+quantity so each line has
        a specific ship_date and open_qty — matching the sample ZSO format.
        If no schedule data, the row is kept as-is using OSTD/open qty.
    """
    zso_items = []
    total_inr = 0.0
    sr_no = 0
    expanded_forecast_lines = 0

    for row in matched_rows:
        po_value = str(row.get("PO Number", "") or "").strip()
        forecast_schedule: dict = row.get("forecast_schedule") or {}

        if _is_forecast_row(row) and forecast_schedule:
            # ── Forecast row with weekly/monthly schedule ──────────────────
            non_zero = {d: q for d, q in forecast_schedule.items() if _parse_float(q) > 0}
            if not non_zero:
                continue
            total_qty = sum(_parse_float(q) for q in non_zero.values())
            earliest_date = sorted(non_zero.keys())[0]
            sr_no += 1
            item, line_total = _build_zso_item(
                row, sr_no, kas_name, total_qty, earliest_date, po_value, forex_rates
            )
            item["forecast_schedule"] = {d: _parse_float(q) for d, q in sorted(non_zero.items())}
            zso_items.append(item)
            total_inr += line_total
            expanded_forecast_lines += 1

        else:
            # ── PO row (or forecast row without schedule data) ─────────────
            sr_no += 1
            open_qty = _parse_float(row.get("Quantity", 0))
            ship_date = row.get("Delivery Date", "")
            item, line_total = _build_zso_item(
                row, sr_no, kas_name, open_qty, ship_date, po_value, forex_rates
            )
            zso_items.append(item)
            total_inr += line_total

    if expanded_forecast_lines:
        logger.info(
            f"ZSO build: {expanded_forecast_lines} forecast rows kept as single lines "
            f"with forecast_schedule attached for UI drill-down"
        )

    # Only stamp forex rates that were actually used (currencies present in the report)
    used_currencies = {item["currency"] for item in zso_items if item.get("currency")}
    forex_used = {
        curr: forex_rates[curr]
        for curr in used_currencies
        if curr in (forex_rates or {}) and curr != "INR"
    }

    return {
        "kas_name": kas_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_inr": round(total_inr, 2),
        "total_items": len(zso_items),
        "matched_items": sum(1 for item in zso_items if item["match_status"] == "matched"),
        "forex_rates_used": forex_used,   # stamped for transparency
        "items": zso_items,
    }


async def save_zso_report(
    db: AsyncSession,
    email_id: int,
    user: User,
    zso_data: dict,
) -> ZSOReport:
    """Persist ZSO report to database."""
    report = ZSOReport(
        email_id=email_id,
        created_by=user.id,
        report_data=zso_data,
        kas_name=user.full_name,
        total_inr=zso_data.get("total_inr", 0),
        status="generated",
    )
    db.add(report)
    await db.flush()
    logger.info(f"ZSO report saved: id={report.id}, total_inr={report.total_inr}")
    return report


def _parse_float(value) -> float:
    if isinstance(value, (int, float)):
        return float(value)
    try:
        cleaned = str(value).replace(",", "").replace(" ", "").strip()
        return float(cleaned) if cleaned else 0.0
    except (ValueError, TypeError):
        return 0.0


def _extract_month(date_str) -> str:
    """Extract sales month label (e.g. 'Apr-2026') from a date string."""
    if not date_str:
        return ""
    try:
        from dateutil import parser as date_parser
        dt = date_parser.parse(str(date_str))
        return dt.strftime("%b-%Y")
    except Exception:
        return ""
