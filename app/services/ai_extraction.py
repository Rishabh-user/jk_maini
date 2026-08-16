"""AI-powered extraction fallback.

When the deterministic parsers fail or produce low-confidence output — email
bodies with embedded tables, inline screenshots, scanned PDFs, messy mixed
content — we hand the raw text / HTML / images to Claude and ask it to return
clean structured rows aligned to our ZSO schema, plus any natural-language
instructions found in the message (e.g. "discard PO 200981234").

This is a *fallback*: clean Excel/CSV/born-digital PDFs still go through the
fast deterministic parsers. Only weak results are escalated here.
"""
import json

import anthropic

from app.services.ai_mapping import SYSTEM_SCHEMA_COLUMNS
from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()

# Cap raw text/html sent to the model so a giant forwarded thread can't blow the
# token budget. ~120k chars ≈ well within a single request.
_MAX_CHARS = 120_000
_MAX_IMAGES = 6   # inline screenshots / scanned pages per message

_SYSTEM = """You are a data-extraction engine for a manufacturing purchase-order system (Maini).
You receive the raw content of a customer email/attachment: free text, HTML, and/or images
(screenshots, scanned pages). Your job is to find the PURCHASE-ORDER / DEMAND line items and
return them as clean structured rows, plus any instructions the sender gave in prose.

Extract a row for every distinct demand line (part + quantity, optionally PO/date/price).
Pull data from tables (HTML or image), and also from sentences like
"We want the material with PO 200981234, item 01, quantity 2" — that is a real line item.

For each row, map values to these canonical fields (use null when absent):
""" + json.dumps(SYSTEM_SCHEMA_COLUMNS) + """

Notes on mapping:
- "Customer Material Number" / "Comp Part" / bare "Part" → "Customer Part #"
- "Supplier Material Number" / vendor item → "Maini Part #" (Maini is the supplier)
- Quantities like "Open Qty", "Ordered", "Requested Quantity" → "Quantity"
- Keep part numbers EXACTLY as written (preserve dashes, leading zeros).
- Do NOT invent data. If a column isn't present, use null.

Also capture sender INSTRUCTIONS that should affect the order — e.g.
"discard PO X", "ignore the highlighted line", "increase qty for part Y to 50",
"this PO is cancelled". Each instruction has:
- type: one of "discard_po", "adjust_qty", "ignore_line", "note"
- target: the PO number / part number it refers to (or null)
- detail: the verbatim instruction text

Return ONLY valid JSON, no prose, in exactly this shape:
{"rows": [ { ...canonical fields... } ], "instructions": [ {"type":..., "target":..., "detail":...} ]}
If there are no demand line items, return {"rows": [], "instructions": [...]}.
"""


def _truncate(s: str | None) -> str:
    if not s:
        return ""
    s = s.strip()
    if len(s) > _MAX_CHARS:
        return s[:_MAX_CHARS] + "\n…[truncated]"
    return s


async def extract_with_ai(
    *,
    text: str | None = None,
    html: str | None = None,
    images: list[tuple[str, str]] | None = None,   # list of (media_type, base64_data)
    source_hint: str = "",
) -> dict:
    """Extract structured rows + instructions from messy content using Claude.

    Returns {"columns": [...], "rows": [...], "instructions": [...], "_source": "ai"}.
    Returns an empty result ({"columns": [], "rows": [], "instructions": []}) on any failure.
    """
    empty = {"columns": [], "rows": [], "instructions": []}

    from app.services import llm
    if not llm.ai_enabled():
        logger.warning("AI extraction skipped — no API key for the active AI_PROVIDER")
        return empty

    text = _truncate(text)
    html = _truncate(html)
    images = (images or [])[:_MAX_IMAGES]

    if not text and not html and not images:
        return empty

    # Build the combined user text (provider-neutral; llm.py wraps images per provider)
    parts = []
    if source_hint:
        parts.append(f"Source: {source_hint}")
    if text:
        parts.append("=== EMAIL / DOCUMENT TEXT ===\n" + text)
    if html:
        parts.append("=== HTML CONTENT (may contain tables) ===\n" + html)
    if images:
        parts.append(f"=== {len(images)} IMAGE(S) ATTACHED — extract any tables/line items visible in them ===")
    user_text = "\n\n".join(parts) or "(no text)"

    try:
        raw = await llm.complete_vision_json(system=_SYSTEM, user_text=user_text, images=images, max_tokens=8000)
    except Exception as e:
        logger.error(f"AI extraction API call failed ({source_hint}): {e}")
        return empty

    raw = (raw or "").strip()
    # Strip markdown fences if present (OpenAI JSON mode returns clean JSON; this
    # only matters for the Anthropic provider path).
    if "```" in raw:
        start = raw.find("{")
        end = raw.rfind("}") + 1
        if start != -1 and end > start:
            raw = raw[start:end]

    try:
        data = json.loads(raw)
    except Exception as e:
        logger.error(f"AI extraction returned non-JSON ({source_hint}): {e}; raw={raw[:300]}")
        return empty

    rows = data.get("rows") or []
    instructions = data.get("instructions") or []

    # Drop empty rows (all-null) and build the column list from what's actually present
    clean_rows = []
    for r in rows:
        if not isinstance(r, dict):
            continue
        if any((v not in (None, "", [])) for v in r.values()):
            clean_rows.append({k: v for k, v in r.items() if v not in (None, "")})

    columns = list(clean_rows[0].keys()) if clean_rows else []
    logger.info(
        f"AI extraction ({source_hint}): {len(clean_rows)} rows, "
        f"{len(instructions)} instructions"
    )
    return {
        "columns": columns,
        "rows": clean_rows,
        "instructions": instructions,
        "_source": "ai",
    }
