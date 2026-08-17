import json
import re

import anthropic

from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()

SYSTEM_SCHEMA_COLUMNS = [
    "Customer Part #",
    "Maini Part #",
    "Description",
    "Quantity",
    "Unit Price",
    "Total Price",
    "Currency",
    "Country",
    "HSN Code",
    "Delivery Date",
    "PO Number",
    "PO Date",
    "Customer Name",
    "Remarks",
]

EXACT_COLUMN_MAP = {
    # ── Customer Part # ──────────────────────────────────────────────────
    "material": "Customer Part #",
    "customer material": "Customer Part #",
    "customer material no": "Customer Part #",
    "customer material number": "Customer Part #",
    "customer part": "Customer Part #",
    "customer part #": "Customer Part #",
    "customer part no": "Customer Part #",
    "customer part number": "Customer Part #",
    "part number / eng rev": "Customer Part #",
    "part no": "Customer Part #",
    "part number": "Customer Part #",
    "part nbr": "Customer Part #",           # Parker portal
    "part no.": "Customer Part #",
    # Bare "Part" — used in many customer PDFs / portals as the part number column
    "part": "Customer Part #",
    "p/n": "Customer Part #",
    "p.n.": "Customer Part #",
    "pn": "Customer Part #",
    # Component / Comp — Safran HAL, aerospace files
    "rm specification": "Customer Part #",   # Sigma Aero RFQ — raw-material spec = part #
    "rm spec": "Customer Part #",
    "comp part": "Customer Part #",
    "comp part no": "Customer Part #",
    "comp part number": "Customer Part #",
    "comp. part no": "Customer Part #",
    "comp. part number": "Customer Part #",
    "component": "Customer Part #",
    "component no": "Customer Part #",
    "component number": "Customer Part #",
    "component part": "Customer Part #",
    "component part no": "Customer Part #",
    "component part number": "Customer Part #",
    # "Item Number" in demand/forecast files (Woodward, ASCO) = customer part number.
    # Note: SAP uses bare "ITEM" (without "number") for line sequences → that stays UNMAPPED.
    "item number": "Customer Part #",
    # In some customer portals "Reference" = part reference / customer part number
    "reference": "Customer Part #",
    # French / other languages
    "référence": "Customer Part #",
    "reference article": "Customer Part #",
    "réf article": "Customer Part #",
    "article": "Customer Part #",
    "n° article": "Customer Part #",
    "pièce": "Customer Part #",
    # ── Maini Part # ─────────────────────────────────────────────────────
    "f part": "Maini Part #",
    "f part #": "Maini Part #",
    "f part no": "Maini Part #",
    "f part number": "Maini Part #",
    "maini part": "Maini Part #",
    "maini part #": "Maini Part #",
    "maini part no": "Maini Part #",
    "maini part number": "Maini Part #",
    "vendor item": "Maini Part #",           # vendor = Maini; vendor's item = Maini part #
    "vendor part": "Maini Part #",
    "supplier item": "Maini Part #",
    "supplier part": "Maini Part #",
    "supplier material number": "Maini Part #",  # AirSupply forecast format
    "your material reference": "Maini Part #",
    "mfg item no": "Maini Part #",           # Woodward — manufacturer (Maini) item number
    "mfg item number": "Maini Part #",
    "mfg no": "Maini Part #",
    # ── Description ──────────────────────────────────────────────────────
    "desc": "Description",
    "description": "Description",
    "discription": "Description",
    "material description": "Description",
    "rm specification description": "Description",   # Sigma Aero RFQ
    "rm spec description": "Description",
    "item description": "Description",
    "item spec": "Description",
    "part description": "Description",       # Parker portal
    # French
    "désignation": "Description",
    "designation": "Description",
    "libelle": "Description",
    "libellé": "Description",
    # ── Quantity ─────────────────────────────────────────────────────────
    "ostd qty": "Quantity",
    "outstanding qty": "Quantity",
    "open qty": "Quantity",
    "initial qty": "Quantity",
    "quantity": "Quantity",
    "qty": "Quantity",
    "q'ty": "Quantity",          # Sigma Aero RFQ / common Asian-supplier header
    "qty.": "Quantity",
    "rem. qty": "Quantity",
    "remaining qty": "Quantity",
    "remaining quantity": "Quantity",
    "remaining quantity to be shipped": "Quantity",  # Safran S2 portal — actual open/remaining
    "po quantity": "Quantity",
    "order qty": "Quantity",
    "ordered qty": "Quantity",
    "ordered": "Quantity",                   # Safran HAL Excel
    "qty ordered": "Quantity",               # Suzhou ePO
    "open sched qty": "Quantity",            # Parker portal — open schedule quantity
    "open schedule qty": "Quantity",
    "planned qty": "Quantity",               # Woodward forecast — planned demand quantity
    "planned quantity": "Quantity",
    "requested quantity": "Quantity",        # Safran S2 portal
    "demand quantity": "Quantity",
    # French
    "quantité": "Quantity",
    "qté": "Quantity",
    "quantite": "Quantity",
    "qte": "Quantity",
    # ── Unit Price ───────────────────────────────────────────────────────
    "net price": "Unit Price",
    "unit price": "Unit Price",
    "unit price per pc": "Unit Price",
    "pre-tax unit price": "Unit Price",
    "price per unit": "Unit Price",
    "historical price": "Unit Price",        # Sigma Aero RFQ — last agreed unit price
    "unit cost": "Unit Price",               # Woodward forecast
    "item cost": "Unit Price",               # Safran HAL Excel
    "price": "Unit Price",
    # French
    "prix unitaire": "Unit Price",
    "prix u.": "Unit Price",
    "p.u.": "Unit Price",
    "prix": "Unit Price",
    # ── Currency ─────────────────────────────────────────────────────────
    "curr": "Currency",
    "currency": "Currency",
    # ── PO Number ────────────────────────────────────────────────────────
    "purchase order": "PO Number",
    "po number": "PO Number",
    "po no": "PO Number",
    "po no.": "PO Number",
    "po": "PO Number",
    "po #": "PO Number",
    "po nbr": "PO Number",                   # Parker portal
    "order number": "PO Number",
    "order no": "PO Number",
    "order ref": "PO Number",
    "order reference": "PO Number",
    "order/requisition": "PO Number",        # Woodward — order or procurement requisition
    "requisition": "PO Number",
    "po/pos number": "PO Number",            # Safran S1 customer portal
    "blanket nbr": "PO Number",              # Parker — blanket purchase order number
    "blanket number": "PO Number",
    # French
    "commande": "PO Number",
    "n° commande": "PO Number",
    "numéro commande": "PO Number",
    "bon de commande": "PO Number",
    # ── Delivery Date ────────────────────────────────────────────────────
    "requested delivery date": "Delivery Date",
    "delivery date": "Delivery Date",
    "ship date": "Delivery Date",
    "wanted delivery date": "Delivery Date",
    "required delivery date": "Delivery Date",
    "dock date": "Delivery Date",
    "required date": "Delivery Date",
    "required by": "Delivery Date",
    "due date": "Delivery Date",
    "need date": "Delivery Date",            # Parker portal — customer's need-by date
    "demand/due date": "Delivery Date",      # Woodward forecast
    "promise date": "Delivery Date",         # Parker / Woodward — confirmed delivery date
    "promised date": "Delivery Date",
    "pick-up date": "Delivery Date",         # ASCO portal
    "pick up date": "Delivery Date",
    "safran due date": "Delivery Date",      # Suzhou/Snecma ePO
    "vendor due date": "Delivery Date",      # Suzhou/Snecma ePO
    "date of demand": "Delivery Date",       # Safran S1 portal (customer's demand date)
    "requested date": "Delivery Date",       # Safran S2 portal
    "request date": "Delivery Date",
    # French
    "date livraison": "Delivery Date",
    "date de livraison": "Delivery Date",
    "dt livraison": "Delivery Date",
    # ── PO Date ──────────────────────────────────────────────────────────
    "po date": "PO Date",
    "doc date": "PO Date",
    "order date": "PO Date",
    "document date": "PO Date",
    "po order date": "PO Date",              # Safran HAL Excel
    "creation date": "PO Date",              # ASCO — PO creation date
    # ── Remarks ──────────────────────────────────────────────────────────
    "supplier comments": "Remarks",
    "comments": "Remarks",
    "remarks": "Remarks",
    "status": "Remarks",                     # LATE/FIRM/PREV from SYLK/SLK files
    "supplier comment": "Remarks",           # Safran S2 portal
    "customer comment": "Remarks",           # Safran S2 portal
    # ────────────────────────────────────────────────────────────────────
    # UNMAPPED — columns that exist in customer files but do NOT map to any
    # ZSO field.  Explicitly marking them prevents the AI from guessing wrong.
    # ────────────────────────────────────────────────────────────────────
    # SAP Vendor Schedule specific
    "supplier commitment date": "UNMAPPED",
    "statistic date": "UNMAPPED",
    "supplier description": "UNMAPPED",
    "base uom": "UNMAPPED",
    "po version": "UNMAPPED",
    "item": "UNMAPPED",          # SAP line item sequence (10, 20, 30...) — not a part number
    "item type": "UNMAPPED",
    "item no": "UNMAPPED",       # SAP internal item number
    "line item": "UNMAPPED",
    "supplier code": "UNMAPPED",
    "contract": "UNMAPPED",
    "contract version": "UNMAPPED",
    "ac desc": "UNMAPPED",
    "trace ability": "UNMAPPED",
    "traceability": "UNMAPPED",
    "part configuration revision": "UNMAPPED",
    "stock": "UNMAPPED",
    "past due": "UNMAPPED",
    "planned delivery time": "UNMAPPED",
    "purchase order version": "UNMAPPED",
    "order version": "UNMAPPED",
    "doc version": "UNMAPPED",
    "version": "UNMAPPED",
    # Quantities that are NOT the open demand qty
    "firm qty": "UNMAPPED",          # Woodward — subset of planned qty; use planned qty for ZSO
    "yr req/rem bal": "UNMAPPED",    # Annual remaining balance — not line-level open qty
    "promised quantity": "UNMAPPED", # Supplier's commitment — not customer demand
    "in transit qty": "UNMAPPED",    # Stock in transit
    "qty received": "UNMAPPED",      # Already received — not open
    "qty rejected": "UNMAPPED",
    "last rcpt qty": "UNMAPPED",
    # Revision / sequence / internal identifiers
    "revision": "UNMAPPED",
    "sched rel": "UNMAPPED",
    "blanket po rel": "UNMAPPED",
    "delivery seq": "UNMAPPED",
    "line": "UNMAPPED",
    "line no": "UNMAPPED",
    # UoM — not a ZSO output field
    "unit of measure": "UNMAPPED",
    "uom": "UNMAPPED",
    "u.m.": "UNMAPPED",
    "u/m": "UNMAPPED",
    # Cost / financial fields we calculate ourselves
    "extended cost": "UNMAPPED",     # Line total = qty × price — we calculate this
    # Other non-demand fields
    "demand type": "UNMAPPED",
    "mfg name": "UNMAPPED",          # Manufacturer name = Maini — not a data field for ZSO
    "drawing number": "UNMAPPED",
    "drawing nbr": "UNMAPPED",
    "drawing no": "UNMAPPED",
    "bucket": "UNMAPPED",            # AirSupply forecast period bucket
    "supplier pct share": "UNMAPPED",
    "ecl": "UNMAPPED",               # Engineering change level
    "ppap req": "UNMAPPED",
    "wo": "UNMAPPED",                # Work order
    "wo nr": "UNMAPPED",
    "op nr": "UNMAPPED",
    "invoice no": "UNMAPPED",
    "program": "UNMAPPED",
    "container type": "UNMAPPED",
    "asco location": "UNMAPPED",
    "buyer full name": "UNMAPPED",
    "buyer code": "UNMAPPED",
    "mqi rev nbr": "UNMAPPED",
    "p2p active": "UNMAPPED",
    "po type": "UNMAPPED",
    "po sl": "UNMAPPED",
    "po line": "UNMAPPED",
}

MAPPING_PROMPT_TEMPLATE = """You are a data mapping expert for a manufacturing parts management system.

Given the following source column names extracted from a customer email/attachment:
{source_columns}

Map each source column to the closest matching system schema column from this list:
{schema_columns}

Rules:
1. Map each source column to exactly one system schema column or "UNMAPPED" if no match.
2. Use fuzzy matching — e.g., "Cus Part" maps to "Customer Part #", "Qty" maps to "Quantity".
3. Be case-insensitive and handle abbreviations.
4. Return ONLY valid JSON with no extra text.

Return a JSON object where keys are source column names and values are system schema column names.

Example:
Input: ["Cus Part", "Qty", "Desc"]
Output: {{"Cus Part": "Customer Part #", "Qty": "Quantity", "Desc": "Description"}}
"""


async def map_columns_with_ai(source_columns: list[str]) -> dict[str, str]:
    """Use Claude API to map extracted columns to system schema."""
    if not source_columns:
        return {}

    from app.services import llm
    if not llm.ai_enabled():
        logger.warning("No AI key for active provider, falling back to basic mapping")
        return _fallback_mapping(source_columns)

    prompt = MAPPING_PROMPT_TEMPLATE.format(
        source_columns=json.dumps(source_columns),
        schema_columns=json.dumps(SYSTEM_SCHEMA_COLUMNS),
    )

    try:
        response_text = await llm.complete_json(prompt, kind="map", max_tokens=1024)
        response_text = (response_text or "").strip()

        # Extract JSON from response (handle markdown code blocks)
        if "```" in response_text:
            json_start = response_text.find("{")
            json_end = response_text.rfind("}") + 1
            response_text = response_text[json_start:json_end]

        mapping = json.loads(response_text)
        mapping.update(_deterministic_mapping(source_columns))
        logger.info(f"AI column mapping completed: {len(mapping)} columns mapped")
        return mapping

    except Exception as e:
        logger.error(f"AI mapping failed: {e}, falling back to basic mapping")
        return _fallback_mapping(source_columns)


def _keyword_guess(col_lower: str) -> str | None:
    """Conservative WHOLE-TOKEN keyword guess. Returns None (→ UNMAPPED) when
    unsure — a wrong guess (e.g. "Cust. Group" → part #, "Kit component" → PO)
    is worse than no guess. Tokens, never substrings: avoids 'po' matching
    'comPOnent' and 'cus' matching 'CUStomer Group'.
    """
    tokens = set(re.split(r"[^a-z0-9]+", col_lower)) - {""}

    def has(*words):  # all words present as whole tokens
        return all(w in tokens for w in words)

    # ── Most specific first ──────────────────────────────────────────────
    if "maini" in tokens:
        return "Maini Part #"
    if has("supplier", "material", "number") or has("vendor", "item") or has("supplier", "part"):
        return "Maini Part #"
    # Description must win over the generic "material"/"part" part-number rule
    if "description" in tokens or "desc" in tokens or "designation" in tokens or "discription" in tokens:
        return "Description"
    if "quantity" in tokens or "qty" in tokens or "qte" in tokens:
        return "Quantity"
    if "price" in tokens or "prix" in tokens:
        return "Unit Price"
    if "currency" in tokens or "curr" in tokens:
        return "Currency"
    if "country" in tokens:
        return "Country"
    if "hsn" in tokens:
        return "HSN Code"
    if has("po", "number") or has("purchase", "order") or has("po", "no") or col_lower.strip() == "po":
        return "PO Number"
    if "date" in tokens or "delivery" in tokens:
        return "Delivery Date"
    # Part-number — only on clear part tokens, and NOT group/org/kit/etc.
    _NOT_PART = {"group", "org", "organization", "kit", "alternative", "config",
                 "configuration", "standard", "option", "header", "component", "plan", "index"}
    if tokens & _NOT_PART:
        return None
    if has("customer", "part") or has("cust", "part") or has("comp", "part"):
        return "Customer Part #"
    if "part" in tokens and not (tokens & _NOT_PART):
        return "Customer Part #"
    if has("customer", "material", "number") or has("material", "number"):
        return "Customer Part #"
    return None


def _fallback_mapping(source_columns: list[str]) -> dict[str, str]:
    """Keyword fallback when AI is unavailable. Exact map first, then a
    conservative whole-token guess; otherwise UNMAPPED."""
    mapping = {}
    for col in source_columns:
        col_lower = _normalize_column_name(col)
        if col_lower in EXACT_COLUMN_MAP:
            mapping[col] = EXACT_COLUMN_MAP[col_lower]
        else:
            mapping[col] = _keyword_guess(col_lower) or "UNMAPPED"
    return mapping


def _deterministic_mapping(source_columns: list[str]) -> dict[str, str]:
    mapping = {}
    for col in source_columns:
        normalized = _normalize_column_name(col)
        if normalized in EXACT_COLUMN_MAP:
            mapping[col] = EXACT_COLUMN_MAP[normalized]
    return mapping


def _normalize_column_name(column: str) -> str:
    return " ".join(str(column or "").replace("_", " ").replace("-", " ").lower().split())
