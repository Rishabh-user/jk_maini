"""Duplicate detection & demand-line versioning.

Two fingerprints per demand line:
  • line_key      — the business IDENTITY (PO + part + date + line#, or, for
                    forecast, customer + part + period). "Is this the same line?"
  • content_hash  — line_key + quantity (+ price). "Did it change?"

Rules:
  • same content_hash                → exact DUPLICATE (PDF+Excel, re-send)
  • same line_key, different content → REVISION (qty/price changed) → supersede
  • new line_key                     → new demand line

Everything is string-coerced and defensive — a bad row never raises.
"""
import hashlib
import json

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data import DemandLine
from app.utils.logging import logger


def _s(v) -> str:
    return str(v if v is not None else "").strip()


def _po_of(row: dict) -> str:
    return _s(row.get("PO Number") or row.get("po_forecast") or row.get("po"))


def _is_usable_po(po: str) -> bool:
    """A usable PO is any non-empty value that isn't a forecast label.
    (Maini PO numbers are alphanumeric, e.g. '25PO000950', 'SNZR000189'.)"""
    return bool(po) and po.lower() not in ("internal forecast", "forecast")


def _is_forecast_row(row: dict) -> bool:
    if row.get("forecast_schedule"):
        return True
    po = _po_of(row).lower()
    if po in ("internal forecast", "forecast"):
        return True
    dt = _s(row.get("_demand_type")).lower()
    return dt.startswith("fcst") or dt.startswith("forecast") or dt.startswith("fc")


def _schedule_signature(row: dict) -> str:
    sched = row.get("forecast_schedule")
    if isinstance(sched, dict) and sched:
        return "|".join(f"{k}:{v}" for k, v in sorted(sched.items()))
    return ""


def _hash(s: str) -> str:
    return hashlib.sha256(s.encode("utf-8")).hexdigest()[:32]


def fingerprint(row: dict) -> dict | None:
    """Return identity + content fingerprints for a demand row, or None if the
    row can't be reliably deduped (e.g. a PO-type row with no PO number)."""
    part = _s(row.get("Customer Part #") or row.get("cust_part_no")).lower()
    customer = _s(row.get("Customer Name") or row.get("customer_name")).lower()

    if _is_forecast_row(row):
        period = _schedule_signature(row) or _s(row.get("Delivery Date") or row.get("period"))
        if not part:
            return None  # nothing to key on
        line_key = _hash("FC|" + "|".join([customer, part]))
        content = _hash(line_key + "|" + period)
        return {
            "line_key": line_key, "content_hash": content, "is_forecast": True,
            "po_number": "", "po_line": "", "cust_part_no": _s(row.get("Customer Part #") or row.get("cust_part_no")),
            "customer_name": _s(row.get("Customer Name") or row.get("customer_name")),
            "delivery_date": "", "period": period[:60],
            "quantity": _num(row.get("Quantity") or row.get("open_qty")),
            "unit_price": _num(row.get("Unit Price") or row.get("unit_price")),
            "currency": _s(row.get("Currency") or row.get("currency")) or None,
            "maini_part_no": _s(row.get("Maini Part #") or row.get("maini_part_no")),
        }

    # PO line — PO number is mandatory to be dedup-eligible
    po = _po_of(row)
    if not _is_usable_po(po) or not part:
        return None
    line = _s(row.get("PO Line") or row.get("Line") or row.get("po_line"))
    date = _s(row.get("Delivery Date") or row.get("ship_date"))
    line_key = _hash("PO|" + "|".join([po.lower(), line.lower(), part, date]))
    qty = _num(row.get("Quantity") or row.get("open_qty"))
    price = _num(row.get("Unit Price") or row.get("unit_price"))
    content = _hash(line_key + f"|{qty}|{price}")
    return {
        "line_key": line_key, "content_hash": content, "is_forecast": False,
        "po_number": po[:120], "po_line": line[:60],
        "cust_part_no": _s(row.get("Customer Part #") or row.get("cust_part_no")),
        "maini_part_no": _s(row.get("Maini Part #") or row.get("maini_part_no")),
        "customer_name": _s(row.get("Customer Name") or row.get("customer_name")),
        "delivery_date": date[:60], "period": None,
        "quantity": qty, "unit_price": price,
        "currency": _s(row.get("Currency") or row.get("currency")) or None,
    }


def _num(v) -> float:
    try:
        return float(str(v).replace(",", "").strip()) if _s(v) else 0.0
    except (ValueError, TypeError):
        return 0.0


def dedupe_within_report(rows: list[dict]) -> tuple[list[dict], int]:
    """Drop EXACT duplicate lines within one report (same content_hash).

    Non-eligible rows (no fingerprint) are always kept. Returns (kept, dropped).
    """
    kept: list[dict] = []
    seen: set[str] = set()
    dropped = 0
    for row in rows:
        try:
            fp = fingerprint(row)
        except Exception:
            fp = None
        if not fp:
            kept.append(row)
            continue
        ch = fp["content_hash"]
        if ch in seen:
            dropped += 1
            continue
        seen.add(ch)
        kept.append(row)
    if dropped:
        logger.info(f"Dedup: dropped {dropped} exact-duplicate line(s) within report")
    return kept, dropped


async def register_demand_lines(db: AsyncSession, rows: list[dict], source_email_id: int | None) -> dict:
    """Upsert rows into the demand-line ledger. Idempotent per (line_key, source).

    Returns {"new", "duplicates", "revisions"} counts. Never raises — errors are logged.
    """
    stats = {"new": 0, "duplicates": 0, "revisions": 0}
    for row in rows:
        try:
            fp = fingerprint(row)
            if not fp:
                continue
            existing = (await db.execute(
                select(DemandLine).where(
                    DemandLine.line_key == fp["line_key"],
                    DemandLine.status == "current",
                )
            )).scalar_one_or_none()

            if existing is None:
                db.add(DemandLine(
                    line_key=fp["line_key"], content_hash=fp["content_hash"],
                    po_number=fp["po_number"], po_line=fp["po_line"],
                    cust_part_no=fp["cust_part_no"], maini_part_no=fp["maini_part_no"],
                    customer_name=fp["customer_name"], delivery_date=fp["delivery_date"],
                    period=fp["period"], quantity=fp["quantity"], unit_price=fp["unit_price"],
                    currency=fp["currency"], is_forecast=fp["is_forecast"],
                    version=1, status="current", duplicate_count=0,
                    source_email_id=source_email_id, also_seen_in=[],
                ))
                stats["new"] += 1

            elif existing.content_hash == fp["content_hash"]:
                # Same line, same content
                if existing.source_email_id == source_email_id:
                    pass  # idempotent — regeneration of the same source
                else:
                    existing.duplicate_count = (existing.duplicate_count or 0) + 1
                    seen = list(existing.also_seen_in or [])
                    if source_email_id is not None and source_email_id not in seen:
                        seen.append(source_email_id)
                        existing.also_seen_in = seen
                    stats["duplicates"] += 1

            else:
                # Same identity, different content → revision → supersede old
                existing.status = "superseded"
                new_line = DemandLine(
                    line_key=fp["line_key"], content_hash=fp["content_hash"],
                    po_number=fp["po_number"], po_line=fp["po_line"],
                    cust_part_no=fp["cust_part_no"], maini_part_no=fp["maini_part_no"],
                    customer_name=fp["customer_name"], delivery_date=fp["delivery_date"],
                    period=fp["period"], quantity=fp["quantity"], unit_price=fp["unit_price"],
                    currency=fp["currency"], is_forecast=fp["is_forecast"],
                    version=(existing.version or 1) + 1, status="current", duplicate_count=0,
                    source_email_id=source_email_id, also_seen_in=[],
                )
                db.add(new_line)
                await db.flush()
                existing.superseded_by_id = new_line.id
                stats["revisions"] += 1
        except Exception as e:
            logger.warning(f"Ledger registration skipped a row: {e}")
            continue

    await db.flush()
    if any(stats.values()):
        logger.info(f"Demand ledger updated: {stats}")
    return stats
