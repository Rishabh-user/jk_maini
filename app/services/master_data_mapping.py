"""AI-assisted column mapping for Master Data (maini_parts) Excel/CSV uploads.

Different customers label the same concept differently — e.g. JK Maini's own
manufacturer part number shows up in real files as "Maini Part", "F Part",
"Vendor Item", "Supplier Part", or "MFG Item No" depending on which customer
exported the sheet. A fixed alias list can't anticipate every variant a new
customer will use, so this module layers THREE passes, cheapest first:

  1. Deterministic exact-alias match (instant, free, zero ambiguity) —
     handles every variant already seen in the wild.
  2. Claude-based semantic mapping for anything the alias list doesn't
     recognize — sees the header text AND a few sample cell values per
     column, so it can use the DATA SHAPE as a secondary signal (e.g. a
     column full of Maini's own part-number format is a strong hint even
     if the header itself is unfamiliar).
  3. Conservative keyword fallback if the AI is unavailable or fails —
     never guesses when unsure; unsure means the column stays UNMAPPED and
     the raw data is preserved anyway (see upload_master_data in
     app/api/master_data.py, which stashes anything UNMAPPED into
     MainiPart.extra_data instead of dropping it).

No column's data is ever discarded: everything that maps to a known field
is written there; everything else is preserved verbatim in extra_data.
"""
from __future__ import annotations

import json
import re

import anthropic

from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()

UNMAPPED = "UNMAPPED"

# Canonical MainiPart fields the mapper can choose from, with a short
# description that also captures known naming-convention aliases — this
# text goes straight into the AI prompt so Claude's semantic matching has
# the same institutional knowledge the deterministic list has.
MASTER_DATA_FIELDS: dict[str, str] = {
    "customer_name": "Customer Name — the customer company (e.g. 'Woodward', 'Safran HAL').",
    "customer_location": "Customer Location — city/site of that customer (e.g. 'Rockford', 'Niles').",
    "sold_to_party": "Sold To Party — the SAP/ERP 'sold-to' account name, if distinct from Customer Name.",
    "ship_to_party": "Ship To Party — the SAP/ERP 'ship-to' account name, if distinct from Customer Name.",
    "customer_part_no": (
        "Customer Part Number — the PART NUMBER AS THE CUSTOMER NAMES IT. Aliases: "
        "'Part No', 'Part #', 'Material', 'Material Number', 'Component', 'Comp Part', "
        "'P/N', 'Item Number', 'Reference'."
    ),
    "maini_part_no": (
        "Maini Part Number — JK MAINI'S OWN internal/manufacturer part number for the "
        "same physical part (NOT the customer's number). Aliases seen in real customer "
        "files: 'F Part', 'F Part No', 'Vendor Item', 'Vendor Part', 'Supplier Item', "
        "'Supplier Part', 'MFG Item No', 'Internal Part No'. If a column's values look "
        "like a manufacturer-style part code distinct from the customer part number "
        "column, prefer this field."
    ),
    "description": "Description — free-text description of the part.",
    "country": "Country — country of the customer/site (e.g. 'USA', 'France').",
    "unit_price": "Unit Price — a numeric price per piece/unit.",
    "currency": "Currency — a 3-letter currency code (e.g. 'INR', 'USD', 'EUR').",
    "incoterm": "Incoterm — a shipping term code (e.g. 'FOB', 'CIF', 'EXW', 'DAP').",
    "hsn_code": "HSN Code — the HS/HSN tariff classification code (numeric, usually 4-8 digits).",
}

# Deterministic alias list — same proven aliases the app already used
# before AI mapping existed, kept as the fast/free first pass. Anything
# matched here never goes to the AI (cheaper, and zero ambiguity for
# well-known variants).
EXACT_ALIASES: dict[str, str] = {
    "customer name": "customer_name", "customer": "customer_name",
    "cust name": "customer_name", "client name": "customer_name",
    "customer location": "customer_location", "location": "customer_location",
    "cust location": "customer_location", "city": "customer_location",
    "site": "customer_location", "site location": "customer_location",
    "sold to party": "sold_to_party", "sold-to party": "sold_to_party",
    "sold to": "sold_to_party", "soldto": "sold_to_party", "sold to party name": "sold_to_party",
    "ship to party": "ship_to_party", "ship-to party": "ship_to_party",
    "ship to": "ship_to_party", "shipto": "ship_to_party", "ship to party name": "ship_to_party",
    "customer_part_no": "customer_part_no", "customer part no": "customer_part_no",
    "customer part #": "customer_part_no", "customer part": "customer_part_no",
    "cust part no": "customer_part_no", "cust part #": "customer_part_no", "cust part": "customer_part_no",
    "customer material": "customer_part_no", "customer material no": "customer_part_no",
    "customer material number": "customer_part_no", "material": "customer_part_no",
    "material no": "customer_part_no", "material number": "customer_part_no",
    "part no": "customer_part_no", "part number": "customer_part_no",
    "customer part number": "customer_part_no", "part": "customer_part_no", "p/n": "customer_part_no",
    "maini_part_no": "maini_part_no", "maini part no": "maini_part_no", "maini part #": "maini_part_no",
    "maini part": "maini_part_no", "maini part number": "maini_part_no", "jk maini part": "maini_part_no",
    "maini no": "maini_part_no",
    "f part #": "maini_part_no", "f part no": "maini_part_no", "f part": "maini_part_no",
    "f part number": "maini_part_no",
    "finished part #": "maini_part_no", "finished part no": "maini_part_no", "finished part": "maini_part_no",
    "internal part #": "maini_part_no", "internal part no": "maini_part_no", "internal part number": "maini_part_no",
    "vendor item": "maini_part_no", "vendor part": "maini_part_no",
    "supplier item": "maini_part_no", "supplier part": "maini_part_no",
    "mfg item no": "maini_part_no", "mfg item number": "maini_part_no", "mfg no": "maini_part_no",
    "description": "description", "discription": "description", "desc": "description",
    "part description": "description", "item description": "description", "material description": "description",
    "country": "country", "country code": "country", "origin": "country",
    "unit_price": "unit_price", "unit price": "unit_price", "unit price per pc": "unit_price",
    "unit price per piece": "unit_price", "price per pc": "unit_price", "price per piece": "unit_price",
    "unit rate": "unit_price", "price": "unit_price", "rate": "unit_price", "net price": "unit_price",
    "currency": "currency", "curr": "currency", "currency code": "currency",
    "incoterm": "incoterm", "incoterms": "incoterm", "inco term": "incoterm", "inco terms": "incoterm",
    "delivery term": "incoterm", "delivery terms": "incoterm",
    "hsn_code": "hsn_code", "hsn code": "hsn_code", "hsn": "hsn_code", "hs code": "hsn_code",
}


def normalize_header(header: str) -> str:
    return " ".join(str(header or "").replace("_", " ").replace("-", " ").strip().lower().split())


def _deterministic_pass(source_columns: list[str]) -> dict[str, str]:
    """Exact-alias match. Returns only the columns it recognized."""
    mapping: dict[str, str] = {}
    for col in source_columns:
        norm = normalize_header(col)
        if norm in EXACT_ALIASES:
            mapping[col] = EXACT_ALIASES[norm]
    return mapping


def _keyword_fallback(col: str) -> str:
    """Conservative whole-token guess, used only when AI is unavailable/fails.
    Returns UNMAPPED rather than risk a wrong guess."""
    tokens = set(re.split(r"[^a-z0-9]+", normalize_header(col))) - {""}

    def has(*words):
        return all(w in tokens for w in words)

    if "maini" in tokens:
        return "maini_part_no"
    if has("vendor", "item") or has("vendor", "part") or has("supplier", "item") or has("supplier", "part"):
        return "maini_part_no"
    if tokens & {"description", "desc", "discription"}:
        return "description"
    if "country" in tokens:
        return "country"
    if tokens & {"currency", "curr"}:
        return "currency"
    if "incoterm" in tokens or "incoterms" in tokens:
        return "incoterm"
    if "hsn" in tokens:
        return "hsn_code"
    if tokens & {"price", "rate", "cost"}:
        return "unit_price"
    _NOT_PART = {"group", "org", "organization", "kit", "config", "configuration", "index"}
    if tokens & _NOT_PART:
        return UNMAPPED
    if has("customer", "part") or has("cust", "part") or has("part", "no") or has("part", "number"):
        return "customer_part_no"
    return UNMAPPED


MAPPING_PROMPT_TEMPLATE = """You map spreadsheet column headers from a customer parts file to a fixed database schema for JK Maini, an aerospace/industrial parts manufacturer.

Target schema fields (choose ONLY from these, or "UNMAPPED"):
{schema_block}

For each source column below, you're given the header text AND a few sample cell values from that column (data can disambiguate an unfamiliar header — e.g. a column of prices should map to unit_price even with an odd header).

Source columns with samples:
{columns_block}

Rules:
1. Map each source column to exactly ONE schema field key, or "UNMAPPED" if nothing fits.
2. Different customers use very different words for the same concept — use semantic judgment, not just literal string matching. Example: a column literally named "F Part" almost always means "maini_part_no" (JK Maini's own manufacturer part number), even though the words don't overlap at all.
3. customer_part_no and maini_part_no are DIFFERENT concepts — customer_part_no is how the CUSTOMER names the part; maini_part_no is JK MAINI'S OWN part number for the same physical item. Don't confuse them.
4. Never invent a field not in the schema list. Never map two source columns to the same field unless they are genuinely duplicates of the same data.
5. Return ONLY valid JSON, no markdown fences, no commentary.

Return a JSON object: {{"source_column_name": "schema_field_key_or_UNMAPPED", ...}}
"""


def _build_prompt(columns: list[str], sample_values: dict[str, list] | None) -> str:
    schema_block = "\n".join(f"- {key}: {desc}" for key, desc in MASTER_DATA_FIELDS.items())
    lines = []
    for col in columns:
        samples = (sample_values or {}).get(col) or []
        samples = [str(s) for s in samples[:3] if s is not None and str(s).strip()]
        sample_str = f" (samples: {', '.join(samples)})" if samples else " (no sample data)"
        lines.append(f'- "{col}"{sample_str}')
    return MAPPING_PROMPT_TEMPLATE.format(schema_block=schema_block, columns_block="\n".join(lines))


async def map_master_data_columns(
    source_columns: list[str],
    sample_values: dict[str, list] | None = None,
) -> dict[str, str]:
    """Map uploaded Excel/CSV column headers to MainiPart field names.

    Returns a dict covering EVERY column in ``source_columns`` — value is
    either a valid MainiPart field name or the literal string "UNMAPPED".
    Callers should route UNMAPPED columns into ``extra_data`` rather than
    discarding them.
    """
    if not source_columns:
        return {}

    mapping = _deterministic_pass(source_columns)
    unresolved = [c for c in source_columns if c not in mapping]

    if not unresolved:
        return mapping

    if not settings.ANTHROPIC_API_KEY:
        logger.warning(
            "master_data_mapping: ANTHROPIC_API_KEY not set — using keyword "
            "fallback for %d unresolved column(s): %s",
            len(unresolved), unresolved,
        )
        for col in unresolved:
            mapping[col] = _keyword_fallback(col)
        return mapping

    try:
        client = anthropic.Anthropic(api_key=settings.ANTHROPIC_API_KEY)
        prompt = _build_prompt(unresolved, sample_values)
        message = client.messages.create(
            model=settings.AI_MODEL,
            max_tokens=1024,
            temperature=0,
            messages=[{"role": "user", "content": prompt}],
        )
        response_text = message.content[0].text.strip()
        if "```" in response_text:
            json_start = response_text.find("{")
            json_end = response_text.rfind("}") + 1
            response_text = response_text[json_start:json_end]
        ai_mapping = json.loads(response_text)

        valid_fields = set(MASTER_DATA_FIELDS.keys()) | {UNMAPPED}
        for col in unresolved:
            value = ai_mapping.get(col, UNMAPPED)
            mapping[col] = value if value in valid_fields else UNMAPPED

        logger.info(
            "master_data_mapping: AI resolved %d/%d previously-unmapped columns",
            sum(1 for c in unresolved if mapping.get(c) != UNMAPPED), len(unresolved),
        )
        return mapping

    except Exception as e:  # noqa: BLE001
        logger.error("master_data_mapping: AI call failed (%s) — using keyword fallback", e)
        for col in unresolved:
            mapping[col] = _keyword_fallback(col)
        return mapping
