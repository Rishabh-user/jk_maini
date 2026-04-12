from datetime import datetime, timezone

from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data import ZSOReport
from app.models.user import User
from app.utils.logging import logger


def build_zso_data(matched_rows: list[dict], kas_name: str) -> dict:
    """Transform matched data into ZSO format with calculated fields."""
    zso_items = []
    total_inr = 0.0

    for i, row in enumerate(matched_rows, start=1):
        open_qty = _parse_float(row.get("Quantity", 0))
        unit_price = _parse_float(row.get("Unit Price", 0))
        currency = row.get("Currency", "INR")

        # Calculate Unit Price in INR (placeholder: 1:1 for INR, needs exchange rate for others)
        unit_price_inr = unit_price  # TODO: apply exchange rate conversion for non-INR currencies
        line_total_inr = open_qty * unit_price_inr
        total_inr += line_total_inr

        # Derive sales month from delivery/ship date
        ship_date = row.get("Delivery Date", "")
        sales_month = _extract_month(ship_date)

        zso_items.append({
            "sr_no": i,
            "kas_name": kas_name,
            "customer_name": row.get("Customer Name", ""),
            "site_location": row.get("Customer Location", row.get("Site Location", "")),
            "country": row.get("Country", ""),
            "incoterm": row.get("Incoterm", ""),
            "direct_sales_wh_movement": row.get("Direct Sales / WH Movement", ""),
            "po_forecast": row.get("PO Number", ""),
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
            "sales_month": sales_month,
            "match_status": row.get("_match_status", "unknown"),
        })

    return {
        "kas_name": kas_name,
        "generated_at": datetime.now(timezone.utc).isoformat(),
        "total_inr": round(total_inr, 2),
        "total_items": len(zso_items),
        "matched_items": sum(1 for item in zso_items if item["match_status"] == "matched"),
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
    """Extract month name (e.g., 'Apr-2026') from a date string."""
    if not date_str:
        return ""
    try:
        from dateutil import parser as date_parser
        dt = date_parser.parse(str(date_str))
        return dt.strftime("%b-%Y")
    except Exception:
        return ""
