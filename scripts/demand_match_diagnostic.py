"""Demand-matching diagnostic (reusable dev utility).

Mirrors the FG Liquidation endpoint's matching logic (part_breakdown vs open-PO
demand from a ZSO) so you can confirm that 'No Demand' rows are genuine business
data rather than a join/normalization failure.

The decisive health signal is **unmatched demand parts == 0**: every demand line
should find its stock part. Unmatched *stock* parts are expected (you hold stock
for many parts that have no open order in a given ZSO).

Usage:
    PYTHONPATH=. venv/bin/python scripts/demand_match_diagnostic.py            # latest ZSO
    PYTHONPATH=. venv/bin/python scripts/demand_match_diagnostic.py 92         # specific ZSO id
"""
import asyncio
import sys

from sqlalchemy import select

from app.db.session import AsyncSessionLocal
from app.models.data import ZSOReport
from app.api.inventory import _latest_classified_uploads, _effective_annotated_rows
from app.services.stock_service import part_breakdown


async def diagnose(zso_report_id: int | None = None) -> dict:
    async with AsyncSessionLocal() as db:
        uploads = await _latest_classified_uploads(db)
        breakdown = part_breakdown(_effective_annotated_rows(uploads))
        stock_parts = set(breakdown)
        fg_parts = {p for p, b in breakdown.items() if b["fg"] > 0}

        if zso_report_id:
            zso = (await db.execute(select(ZSOReport).where(ZSOReport.id == zso_report_id))).scalar_one_or_none()
        else:
            zso = (await db.execute(select(ZSOReport).order_by(ZSOReport.created_at.desc()).limit(1))).scalar_one_or_none()

        demand_parts = set()
        if zso:
            for item in (zso.report_data or {}).get("items", []):
                if str(item.get("po_forecast") or "").strip().lower() == "internal forecast":
                    continue
                mp = str(item.get("maini_part_no") or "").strip()
                if mp:
                    demand_parts.add(mp)

        return {
            "zso_id": zso.id if zso else None,
            "uploads": [(u.stock_type, u.filename) for u in uploads],
            "stock_parts": stock_parts,
            "fg_parts": fg_parts,
            "demand_parts": demand_parts,
            "matched": stock_parts & demand_parts,
            "fg_matched": fg_parts & demand_parts,
            "unmatched_stock": stock_parts - demand_parts,
            "unmatched_demand": demand_parts - stock_parts,
        }


def _print(r: dict) -> None:
    line = "-" * 55
    print(f"Demand source: ZSO #{r['zso_id'] or '—'}")
    print(f"Stock uploads: {r['uploads']}")
    print(line)
    print(f"Total stock parts (any category) : {len(r['stock_parts'])}")
    print(f"  of which FG parts              : {len(r['fg_parts'])}")
    print(f"Total demand parts (open PO)     : {len(r['demand_parts'])}")
    print(line)
    print(f"Matched parts (stock ∩ demand)   : {len(r['matched'])}")
    print(f"  FG parts with demand           : {len(r['fg_matched'])}")
    print(f"Unmatched STOCK parts (No Demand): {len(r['unmatched_stock'])}")
    print(f"Unmatched DEMAND parts (no stock): {len(r['unmatched_demand'])}")
    print(line)
    print("Sample matched         :", sorted(r["matched"])[:5])
    print("Sample unmatched stock :", sorted(r["unmatched_stock"])[:5])
    print("Sample unmatched demand:", sorted(r["unmatched_demand"])[:5])
    if r["unmatched_demand"]:
        print("\n⚠️  Unmatched demand parts exist — investigate part-number normalization.")
    else:
        print("\n✅ All demand parts matched — 'No Demand' rows are genuine business data.")


if __name__ == "__main__":
    arg = int(sys.argv[1]) if len(sys.argv) > 1 else None
    _print(asyncio.run(diagnose(arg)))
