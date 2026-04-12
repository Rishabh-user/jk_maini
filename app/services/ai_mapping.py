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
        logger.info(f"AI column mapping completed: {len(mapping)} columns mapped")
        return mapping

    except Exception as e:
        logger.error(f"AI mapping failed: {e}, falling back to basic mapping")
        return _fallback_mapping(source_columns)


def _fallback_mapping(source_columns: list[str]) -> dict[str, str]:
    """Basic keyword-based fallback mapping when AI is unavailable."""
    keyword_map = {
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
        col_lower = col.lower().strip()
        matched = "UNMAPPED"
        for keyword, schema_col in keyword_map.items():
            if keyword in col_lower:
                matched = schema_col
                break
        mapping[col] = matched

    return mapping
