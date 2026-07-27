"""Stock classification — turns a raw SAP stock/open-orders row into a typed
category + plant group, so a single upload (or one combined file) can be split
into FG / Child / WIP / RM automatically.

Material-type mapping (confirmed with client):
    ZFIN                → Finished Goods (fg)
    ZSFG                → Semi-Finished / Child Parts (child)
    ZWIP                → Work In Progress (wip)
    ROH / ZROH / ROHP   → Raw Material (rm)
    ZSCR                → Scrap (excluded)

FG location rule (from the data): FG = ZFIN at plant 3001 (BSR W/H) + warehouse
3000 (FG W/H); child parts = ZSFG, plus ANYTHING stored at 3002 (EATON KIT W/H) —
including ZFIN kept there, per the agreed business rule. Plant vs warehouse is
derived from the plant code prefix: ME* = plant, WE* = warehouse.

Storage-location rules are centralized in LOCATION_RULES below so that if Maini
changes / adds storage locations, only that mapping needs updating — the
classification logic stays untouched.
"""
_FG_TYPES = {"ZFIN"}
_CHILD_TYPES = {"ZSFG"}
_WIP_TYPES = {"ZWIP"}
_RM_TYPES = {"ROH", "ZROH", "ROHP"}
_SCRAP_TYPES = {"ZSCR"}

# Production-order types that are true WIP (open-orders files); YRW3 = rework (skip)
_WIP_ORDER_TYPES = {"YBM5", "YBM6", "YBM7"}

# ── Centralized storage-location → role mapping ──────────────────────────────
# Single source of truth for location-based classification. To onboard a new
# storage location, add its code here — no changes to classify_row() needed.
#   "fg"    → counts toward Finished Goods (only when material type is ZFIN)
#   "child" → forces the row to Child Parts regardless of material type
# Codes are matched leniently: a row's storage location matches if the mapped
# code appears as a whole token in either the code field or its description.
LOCATION_RULES: dict[str, str] = {
    "3001": "fg",     # BSR W/H  (plant)      — FG when ZFIN
    "3000": "fg",     # FG W/H   (warehouse)  — FG when ZFIN
    "3002": "child",  # EATON KIT W/H (plant) — anything here is a child part
}

# Convenience views derived from the single mapping above.
_FG_LOCATIONS = {code for code, role in LOCATION_RULES.items() if role == "fg"}
_CHILD_LOCATIONS = {code for code, role in LOCATION_RULES.items() if role == "child"}


def location_role(location: str) -> str:
    """Return the configured role ('fg' / 'child' / '') for a storage location.

    Matching is lenient: SAP location fields sometimes carry the bare code
    ("3002"), sometimes a code + description ("3002 EATON KIT W/H"). We match if
    a configured code appears as a whole space/punctuation-delimited token.
    """
    raw = _s(location).upper()
    if not raw:
        return ""
    tokens = set(raw.replace("-", " ").replace("/", " ").split())
    for code, role in LOCATION_RULES.items():
        if code in tokens or raw == code:
            return role
    return ""


def _s(v) -> str:
    return str(v if v is not None else "").strip()


def _num(v) -> float:
    try:
        return float(_s(v).replace(",", "")) if _s(v) else 0.0
    except (ValueError, TypeError):
        return 0.0


def _first(row: dict, *keys) -> str:
    for k in keys:
        if k in row and _s(row[k]):
            return _s(row[k])
    return ""


def plant_group(plant: str) -> str:
    p = _s(plant).upper()
    if p.startswith("ME"):
        return "plant"
    if p.startswith("WE"):
        return "warehouse"
    return "unknown"


def _category_from_type(mtype: str) -> str:
    m = _s(mtype).upper()
    if m in _FG_TYPES:
        return "fg"
    if m in _CHILD_TYPES:
        return "child"
    if m in _WIP_TYPES:
        return "wip"
    if m in _RM_TYPES:
        return "rm"
    if m in _SCRAP_TYPES:
        return "scrap"
    return "other"


def _apply_location_gate(category: str, location: str) -> str:
    """Refine a material-type category using the storage location.

    Business rule (agreed with client):
      • FG = ZFIN, but ONLY at FG locations (3001 / 3000). A ZFIN part stored
        at a known non-FG location is not counted as finished goods.
      • Anything at a 'child' location (3002 EATON KIT W/H) is a child part,
        regardless of its material type — including ZFIN kept there.
    WIP / RM / other categories are unaffected by location. A ZFIN row with a
    blank / unrecognized location is left as FG (we don't demote on missing
    data — only on a location that is positively known to be non-FG).
    """
    role = location_role(location)
    if role == "child":
        return "child"
    if category == "fg" and role and role != "fg":
        # ZFIN at a known non-FG location → treat as child.
        return "child"
    return category


def classify_row(row: dict) -> dict | None:
    """Classify one raw stock/open-order row. Returns an annotated dict, or None
    to drop the row (scrap / unusable)."""
    part = _first(row, "Material", "Maini Part No", "maini_part_no", "Part No", "part_no")
    if not part:
        return None

    order_type = _first(row, "Order Type", "order_type")
    # ── Open-orders (production) file → WIP ──────────────────────────────
    if order_type or ("Open Qty" in row and "Material Type" not in row):
        if order_type and order_type.upper() not in _WIP_ORDER_TYPES:
            return None  # rework / non-production order
        qty = _num(_first(row, "Open Qty", "open_qty", "Qty", "Quantity"))
        return {
            "part": part, "category": "wip",
            "plant": _first(row, "Plant", "plant"),
            "plant_group": plant_group(_first(row, "Plant", "plant")),
            "location": _first(row, "Storage Location", "storage_location"),
            "material_type": "OPEN_ORDER",
            "qty": qty, "in_transit": 0.0,
        }

    # ── Stock file → classify by material type + storage location ───────
    mtype = _first(row, "Material Type", "material_type", "Matl type")
    location = _first(row, "Storage Location", "storage_location", "Descr. of Storage Loc.")
    category = _category_from_type(mtype)
    if category == "scrap":
        return None
    category = _apply_location_gate(category, location)
    return {
        "part": part, "category": category,
        "plant": _first(row, "Plant", "plant"),
        "plant_group": plant_group(_first(row, "Plant", "plant")),
        "location": location,
        "material_type": mtype,
        "qty": _num(_first(row, "Unrestricted", "unrestricted", "Qty", "Stock", "Quantity")),
        "in_transit": _num(_first(row, "Stock in Transit", "stock_in_transit")),
    }


def classify_rows(rows: list[dict]) -> tuple[list[dict], dict]:
    """Classify all rows. Returns (annotated_rows, summary).

    Each annotated row keeps its original fields plus _category / _plant_group /
    _part / _qty / _in_transit. Summary aggregates qty + distinct parts by
    category and by plant group.
    """
    annotated: list[dict] = []
    by_cat: dict[str, dict] = {}
    by_group: dict[str, dict] = {}

    for row in rows:
        try:
            c = classify_row(row)
        except Exception:
            c = None
        if not c:
            continue
        ann = dict(row)
        ann.update({
            "_part": c["part"], "_category": c["category"],
            "_plant_group": c["plant_group"], "_plant": c["plant"],
            "_location": c["location"], "_qty": c["qty"], "_in_transit": c["in_transit"],
        })
        annotated.append(ann)

        cat, grp = c["category"], c["plant_group"]
        by_cat.setdefault(cat, {"parts": set(), "qty": 0.0, "in_transit": 0.0})
        by_cat[cat]["parts"].add(c["part"]); by_cat[cat]["qty"] += c["qty"]; by_cat[cat]["in_transit"] += c["in_transit"]
        by_group.setdefault(grp, {"parts": set(), "qty": 0.0})
        by_group[grp]["parts"].add(c["part"]); by_group[grp]["qty"] += c["qty"]

    summary = {
        "by_category": {k: {"parts": len(v["parts"]), "qty": round(v["qty"], 2),
                            "in_transit": round(v["in_transit"], 2)} for k, v in by_cat.items()},
        "by_group": {k: {"parts": len(v["parts"]), "qty": round(v["qty"], 2)} for k, v in by_group.items()},
        "total_rows": len(annotated),
    }
    return annotated, summary


def part_breakdown(annotated_rows: list[dict]) -> dict[str, dict]:
    """Richer per-part aggregation for the FG Liquidation report.

    Unlike stock_by_part (which collapses FG across locations), this keeps the
    plant-vs-warehouse split for FG so the report can show where finished goods
    physically sit. Returns
    {part: {fg, fg_plant, fg_warehouse, child, wip, rm, in_transit}}.
    """
    out: dict[str, dict] = {}
    for r in annotated_rows:
        part = _s(r.get("_part"))
        if not part:
            continue
        cat = r.get("_category", "other")
        if cat not in ("fg", "child", "wip", "rm"):
            continue
        b = out.setdefault(part, {
            "fg": 0.0, "fg_plant": 0.0, "fg_warehouse": 0.0,
            "child": 0.0, "wip": 0.0, "rm": 0.0, "in_transit": 0.0,
        })
        qty = _num(r.get("_qty"))
        b[cat] += qty
        b["in_transit"] += _num(r.get("_in_transit"))
        if cat == "fg":
            grp = r.get("_plant_group")
            if grp == "warehouse":
                b["fg_warehouse"] += qty
            elif grp == "plant":
                b["fg_plant"] += qty
    return out


def stock_by_part(annotated_rows: list[dict]) -> dict[str, dict]:
    """Aggregate classified rows into per-part category buckets for allocation.

    Returns {part: {fg, child, wip, rm, in_transit}}.
    """
    out: dict[str, dict] = {}
    for r in annotated_rows:
        part = _s(r.get("_part"))
        if not part:
            continue
        cat = r.get("_category", "other")
        if cat not in ("fg", "child", "wip", "rm"):
            continue
        b = out.setdefault(part, {"fg": 0.0, "child": 0.0, "wip": 0.0, "rm": 0.0, "in_transit": 0.0})
        b[cat] += _num(r.get("_qty"))
        b["in_transit"] += _num(r.get("_in_transit"))
    return out
