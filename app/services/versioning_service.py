"""Report version history + change tracking (audit-first, snapshot-preserving).

Each kept version points to a full ZSOReport snapshot (no reconstruction). A new
upload is attached to an existing chain by PART-NUMBER overlap against that chain's
latest version — so adding/removing individual POs stays within the chain (V2/V3)
rather than starting a new one. If a new upload has no changes vs the latest
version, it's a duplicate and no version is created.
"""
from collections import Counter

from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data import ReportVersion, ReportChange, ZSOReport
from app.utils.logging import logger

CHAIN_OVERLAP_THRESHOLD = 0.5   # ≥50% of the smaller part-set shared → same demand document

# ZSO item fields we treat as "meaningful" for change detection
_TRACKED_FIELDS = ("open_qty", "unit_price", "ship_date", "po_forecast", "maini_part_no")


def _s(v) -> str:
    return str(v if v is not None else "").strip()


def _items(report_data: dict | None) -> list[dict]:
    if isinstance(report_data, dict) and isinstance(report_data.get("items"), list):
        return report_data["items"]
    return []


def _is_forecast(item: dict) -> bool:
    """A line is forecast (planning data) if its PO label contains 'forecast'."""
    return "forecast" in _s(item.get("po_forecast")).lower()


def firm_items(items: list[dict]) -> list[dict]:
    """Only firm PO lines — forecast rows are auto-injected planning data and
    are the SAME across every report for a customer, so including them in
    version matching/diffs makes unrelated uploads look identical (over-eager
    chaining) and floods the deltas with forecast churn. Versioning is about
    the firm demand document, so we compare firm lines only."""
    return [i for i in items if not _is_forecast(i)]


def part_set(items: list[dict]) -> set[str]:
    return {_s(i.get("cust_part_no")).lower() for i in firm_items(items) if _s(i.get("cust_part_no"))}


def document_class(items: list[dict]) -> str:
    """PO if any line carries a real (non-forecast) PO number, else FORECAST."""
    for i in items:
        po = _s(i.get("po_forecast")).lower()
        if po and po not in ("internal forecast", "forecast"):
            return "PO"
    return "FORECAST"


def primary_customer(items: list[dict]) -> str:
    names = [_s(i.get("customer_name")) for i in items if _s(i.get("customer_name"))]
    return Counter(names).most_common(1)[0][0] if names else ""


def _row_key(item: dict) -> str:
    return _s(item.get("row_id")) or "|".join([
        _s(item.get("cust_part_no")).lower(),
        _s(item.get("po_forecast")).lower(),
        _s(item.get("ship_date")),
    ])


def _norm_field(field: str, value) -> str:
    """Normalize a tracked field value for comparison (numbers vs text)."""
    if field in ("open_qty", "unit_price"):
        try:
            return f"{float(str(value).replace(',', '').strip() or 0):.4f}"
        except (ValueError, TypeError):
            return _s(value)
    return _s(value)


def diff_items(old_items: list[dict], new_items: list[dict]) -> dict:
    """Compare two report snapshots by row identity.

    Returns added / removed / modified lists + unchanged count. `modified` entries
    carry per-field old→new changes.
    """
    # Forecast rows are injected planning data (identical across reports) — they
    # aren't part of the firm demand document, so exclude them from the diff.
    old_by = {_row_key(i): i for i in firm_items(old_items)}
    new_by = {_row_key(i): i for i in firm_items(new_items)}

    added, removed, modified = [], [], []
    unchanged = 0

    for key, new in new_by.items():
        if key not in old_by:
            added.append(new)
            continue
        old = old_by[key]
        field_changes = []
        for f in _TRACKED_FIELDS:
            ov, nv = _norm_field(f, old.get(f)), _norm_field(f, new.get(f))
            if ov != nv:
                field_changes.append({"field": f, "old": _s(old.get(f)), "new": _s(new.get(f))})
        if field_changes:
            modified.append({
                "row_key": key,
                "cust_part_no": _s(new.get("cust_part_no")),
                "po_number": _s(new.get("po_forecast")),
                "changes": field_changes,
            })
        else:
            unchanged += 1

    for key, old in old_by.items():
        if key not in new_by:
            removed.append(old)

    return {
        "added": added, "removed": removed, "modified": modified,
        "unchanged": unchanged,
        "has_changes": bool(added or removed or modified),
        "counts": {
            "total": len(new_by),   # firm PO lines only (forecast excluded)
            "added": len(added), "removed": len(removed),
            "modified": len(modified), "unchanged": unchanged,
        },
    }


def forex_rate_diff(old_forex_used: dict, new_forex_used: dict) -> list[dict]:
    """Compare the forex rates stamped on two report snapshots.

    Returns one {field, old, new} entry per currency whose active rate
    differs. This exists because switching the ACTIVE forex rate (Master
    Data > Forex Rates > Activate) and regenerating a report changes every
    row's unit_price_inr/total_inr — but diff_items() never sees it,
    since those computed fields are deliberately excluded from
    _TRACKED_FIELDS (keeping the version history focused on genuine
    demand/PO changes rather than currency noise on every single row).
    Without this separate check, a forex-only regenerate looks identical
    to diff_items and gets silently discarded as "no changes, return the
    stale existing report" — even though the actual INR figures did change.
    """
    changes = []
    for cur in sorted(set(old_forex_used) | set(new_forex_used)):
        old_rate = (old_forex_used.get(cur) or {}).get("rate")
        new_rate = (new_forex_used.get(cur) or {}).get("rate")
        if old_rate != new_rate:
            changes.append({"field": f"forex_rate_{cur}", "old": _s(old_rate), "new": _s(new_rate)})
    return changes


async def find_latest_chain_version(
    db: AsyncSession, new_parts: set[str], doc_class: str, customer: str
) -> ReportVersion | None:
    """Find the latest version of the chain this upload belongs to, by part overlap.

    Matches only within the same doc_class; if both sides have a customer name they
    must agree. Returns the best chain's latest ReportVersion, or None (→ new chain).
    """
    if not new_parts:
        return None

    # Latest version_number per chain
    sub = (
        select(ReportVersion.demand_doc_key, func.max(ReportVersion.version_number).label("mx"))
        .group_by(ReportVersion.demand_doc_key)
    ).subquery()
    latest = (await db.execute(
        select(ReportVersion).join(
            sub,
            (ReportVersion.demand_doc_key == sub.c.demand_doc_key)
            & (ReportVersion.version_number == sub.c.mx),
        )
    )).scalars().all()

    best, best_overlap = None, 0.0
    cust_lower = customer.lower()
    for v in latest:
        if (v.doc_class or "") != doc_class:
            continue
        if cust_lower and _s(v.customer_name).lower() and cust_lower != _s(v.customer_name).lower():
            continue  # different named customer → not the same document
        snap = (await db.execute(
            select(ZSOReport.report_data).where(ZSOReport.id == v.zso_report_id)
        )).scalar_one_or_none()
        parts = part_set(_items(snap))
        if not parts:
            continue
        shared = len(new_parts & parts)
        overlap = shared / min(len(new_parts), len(parts))
        if overlap > best_overlap:
            best, best_overlap = v, overlap

    if best and best_overlap >= CHAIN_OVERLAP_THRESHOLD:
        return best
    return None


async def record_version(
    db: AsyncSession, *, demand_doc_key: str, version_number: int, zso_report_id: int,
    is_base: bool, source: str, source_email_id: int | None, doc_class: str,
    customer: str, created_by: int | None, diff: dict,
) -> ReportVersion:
    """Persist a version row + its per-field change rows. Returns the version."""
    counts = diff["counts"]
    v = ReportVersion(
        demand_doc_key=demand_doc_key, version_number=version_number,
        zso_report_id=zso_report_id, is_base=is_base, source=source,
        source_email_id=source_email_id, doc_class=doc_class, customer_name=customer or None,
        total_rows=counts["total"], added_rows=counts["added"], removed_rows=counts["removed"],
        modified_rows=counts["modified"], unchanged_rows=counts["unchanged"],
        created_by=created_by,
    )
    db.add(v)
    await db.flush()

    if not is_base:  # V1 base = whole report; don't explode it into change rows
        for r in diff["added"]:
            db.add(ReportChange(version_id=v.id, row_key=_row_key(r),
                                cust_part_no=_s(r.get("cust_part_no")), po_number=_s(r.get("po_forecast")),
                                change_type="added"))
        for r in diff["removed"]:
            db.add(ReportChange(version_id=v.id, row_key=_row_key(r),
                                cust_part_no=_s(r.get("cust_part_no")), po_number=_s(r.get("po_forecast")),
                                change_type="removed"))
        for m in diff["modified"]:
            for c in m["changes"]:
                db.add(ReportChange(version_id=v.id, row_key=m["row_key"],
                                    cust_part_no=m["cust_part_no"], po_number=m["po_number"],
                                    change_type="modified", field_name=c["field"],
                                    old_value=c["old"], new_value=c["new"]))
    await db.flush()
    logger.info(f"Report version recorded: chain={demand_doc_key} v{version_number} counts={counts}")
    return v
