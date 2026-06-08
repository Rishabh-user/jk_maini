import json

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
    "vendor item": "Maini Part #",   # vendor = Maini; vendor's item = Maini part #
    "vendor part": "Maini Part #",
    "supplier item": "Maini Part #",
    "supplier part": "Maini Part #",
    "your material reference": "Maini Part #",
    # ── Description ──────────────────────────────────────────────────────
    "desc": "Description",
    "description": "Description",
    "discription": "Description",
    "material description": "Description",
    "item description": "Description",
    "item spec": "Description",
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
    "rem. qty": "Quantity",
    "remaining qty": "Quantity",
    "remaining quantity": "Quantity",
    "po quantity": "Quantity",
    "order qty": "Quantity",
    "ordered qty": "Quantity",
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
    "unit cost": "Unit Price",
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
    "order number": "PO Number",
    "order no": "PO Number",
    "order ref": "PO Number",
    "order reference": "PO Number",
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
    # French
    "date livraison": "Delivery Date",
    "date de livraison": "Delivery Date",
    "dt livraison": "Delivery Date",
    # ── PO Date ──────────────────────────────────────────────────────────
    "po date": "PO Date",
    "doc date": "PO Date",
    "order date": "PO Date",
    "document date": "PO Date",
    # ── Remarks ──────────────────────────────────────────────────────────
    "supplier comments": "Remarks",
    "comments": "Remarks",
    "remarks": "Remarks",
    "status": "Remarks",      # LATE/FIRM/PREV from SYLK/SLK files
    "supplier commitment date": "UNMAPPED",
    "statistic date": "UNMAPPED",
    "supplier description": "UNMAPPED",
    "base uom": "UNMAPPED",
    # SAP / Safran Procurement Plan columns that must NOT be confused with mapped fields
    "po version": "UNMAPPED",
    "item": "UNMAPPED",
    "item type": "UNMAPPED",
    "item no": "UNMAPPED",
    "item number": "UNMAPPED",
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

    if not settings.ANTHROPIC_API_KEY:
        logger.warning("ANTHROPIC_API_KEY not set, falling back to basic mapping")
        return _fallback_mapping(source_columns)

    client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)

    prompt = MAPPING_PROMPT_TEMPLATE.format(
        source_columns=json.dumps(source_columns),
        schema_columns=json.dumps(SYSTEM_SCHEMA_COLUMNS),
    )

    try:
        message = client.messages.create(
            model="claude-sonnet-4-20250514",
            max_tokens=1024,
            messages=[{"role": "user", "content": prompt}],
        )

        response_text = message.content[0].text.strip()

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


def _fallback_mapping(source_columns: list[str]) -> dict[str, str]:
    """Basic keyword-based fallback mapping when AI is unavailable."""
    keyword_map = {
        "material": "Customer Part #",
        "part": "Customer Part #",
        "cus": "Customer Part #",
        "customer": "Customer Part #",
        "maini": "Maini Part #",
        "desc": "Description",
        "description": "Description",
        "qty": "Quantity",
        "quantity": "Quantity",
        "price": "Unit Price",
        "unit": "Unit Price",
        "total": "Total Price",
        "amount": "Total Price",
        "currency": "Currency",
        "country": "Country",
        "hsn": "HSN Code",
        "delivery": "Delivery Date",
        "date": "Delivery Date",
        "po": "PO Number",
        "order": "PO Number",
        "name": "Customer Name",
        "remark": "Remarks",
        "note": "Remarks",
    }

    mapping = {}
    for col in source_columns:
        col_lower = _normalize_column_name(col)
        matched = EXACT_COLUMN_MAP.get(col_lower, "UNMAPPED")
        if matched == "UNMAPPED" and col_lower not in EXACT_COLUMN_MAP:
            for keyword, schema_col in keyword_map.items():
                if keyword in col_lower:
                    matched = schema_col
                    break
        mapping[col] = matched

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
