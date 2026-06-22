import base64
import os
import re as _re

_re_num = _re.compile(r"\d[\d,.\s]*")

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import Email, EmailStatus, Attachment
from app.models.data import RawData
from app.services.file_parser import FileParser
from app.services.ai_mapping import map_columns_with_ai
from app.services.ai_extraction import extract_with_ai
from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()

# Single-column junk produced by line-by-line text/OCR fallback — treat as "no real table"
_JUNK_COLUMNS = ({"email_text"}, {"ocr_text"})
_IMAGE_MEDIA = {
    "png": "image/png", "jpg": "image/jpeg", "jpeg": "image/jpeg",
    "gif": "image/gif", "webp": "image/webp", "bmp": "image/bmp", "tiff": "image/tiff",
}


def _has_meaningful_column(columns: list[str]) -> bool:
    """True if any column maps to a core demand field (part/qty/po/price/date/desc).

    A genuine demand table always has at least one of these. A table of address
    lines, footers, or page furniture won't — so its absence signals a bad parse.
    """
    from app.services.ai_mapping import EXACT_COLUMN_MAP, _normalize_column_name
    # A real demand table needs a part/qty/desc column. PO Number / Currency etc.
    # are EXCLUDED as the sole signal because the PDF parser auto-stamps them onto
    # any table — so an address-block table can falsely look like demand otherwise.
    core = {"Customer Part #", "Maini Part #", "Quantity", "Unit Price",
            "Delivery Date", "Description"}
    stamped = {"po number", "po date", "currency", "incoterm",
               "customer name", "country", "doc date", "ship date"}
    keywords = {"part", "qty", "quantity", "material", "price", "date",
                "desc", "designation", "item"}
    for c in columns or []:
        norm = _normalize_column_name(c)
        if norm in stamped:
            continue
        if EXACT_COLUMN_MAP.get(norm) in core:
            return True
        tokens = set(_re.split(r"[^a-z0-9]+", norm)) - {""}
        if tokens & keywords:
            return True
    return False


def _looks_numeric(v) -> bool:
    """True if the value is a number (allowing commas, currency, trailing unit)."""
    s = str(v or "").strip()
    if not s:
        return False
    m = _re_num.search(s)
    if not m:
        return False
    # Numeric portion should dominate — guards against "CA CODE 305" / "BUYER CODE 523"
    digits = sum(c.isdigit() for c in s)
    letters = sum(c.isalpha() for c in s)
    return digits > 0 and letters <= 2


def _quantity_values_are_garbage(extracted: dict) -> bool:
    """True if a Quantity/Unit-Price column exists but its values aren't numeric.

    Catches mis-aligned PDF tables where columns look right (QUANTITY, UNIT PRICE)
    but the cells are scrambled prose ("REQUIREME ****", "CA CODE 305").
    """
    from app.services.ai_mapping import EXACT_COLUMN_MAP, _normalize_column_name
    rows = extracted.get("rows") or []
    cols = extracted.get("columns") or []
    if len(rows) < 2:
        return False

    numeric_cols = []
    for c in cols:
        mapped = EXACT_COLUMN_MAP.get(_normalize_column_name(c))
        norm = _normalize_column_name(c)
        if mapped in ("Quantity", "Unit Price") or norm in ("quantity", "qty", "unit price"):
            numeric_cols.append(c)
    if not numeric_cols:
        return False

    # If EVERY numeric-expected column is almost entirely non-numeric → garbage parse
    for c in numeric_cols:
        vals = [r.get(c) for r in rows if r.get(c) not in (None, "")]
        if not vals:
            continue
        ratio = sum(_looks_numeric(v) for v in vals) / len(vals)
        if ratio >= 0.3:
            return False   # at least one numeric column looks real → trust the parse
    return True


def _is_weak_extraction(extracted: dict) -> bool:
    """True if deterministic parsing failed to find a real table of line items.

    Weak when: no rows, OR only junk single-column text/OCR output, OR no column
    looks like a demand field, OR the quantity/price columns contain non-numeric
    garbage (a mis-aligned table).
    """
    rows = extracted.get("rows") or []
    if not rows:
        return True
    cols = set(extracted.get("columns") or [])
    if cols in _JUNK_COLUMNS:
        return True
    if not _has_meaningful_column(extracted.get("columns") or []):
        return True
    if _quantity_values_are_garbage(extracted):
        return True
    return False


def _image_file_for_ai(filename: str, file_path: str | None) -> list[tuple[str, str]]:
    """Read a standalone image file as a single (media_type, base64) pair."""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    media = _IMAGE_MEDIA.get(ext)
    if not media or not file_path or not os.path.exists(file_path):
        return []
    try:
        with open(file_path, "rb") as f:
            data = f.read()
        if media not in ("image/png", "image/jpeg", "image/gif", "image/webp"):
            from PIL import Image
            import io
            im = Image.open(io.BytesIO(data)).convert("RGB")
            buf = io.BytesIO(); im.save(buf, format="PNG"); data = buf.getvalue(); media = "image/png"
        return [(media, base64.b64encode(data).decode("ascii"))]
    except Exception as e:
        logger.warning(f"Could not read image '{filename}' for AI extraction: {e}")
        return []


def _pdf_images_for_ai(file_path: str | None, max_pages: int = 4) -> list[tuple[str, str]]:
    """Render up to `max_pages` PDF pages to PNG (via poppler's pdftoppm) for AI vision.

    Used for scanned / image-only PDFs where text extraction yields nothing —
    the page image is far more reliable than OCR text for the model.
    """
    import shutil
    import subprocess
    import tempfile
    import glob as _glob

    if not file_path or not os.path.exists(file_path):
        return []
    pdftoppm = shutil.which("pdftoppm")
    if not pdftoppm:
        logger.warning("pdftoppm not found — cannot render PDF pages for AI vision")
        return []
    images: list[tuple[str, str]] = []
    try:
        with tempfile.TemporaryDirectory() as tmp:
            prefix = os.path.join(tmp, "page")
            subprocess.run(
                [pdftoppm, "-png", "-r", "150", "-l", str(max_pages), file_path, prefix],
                check=True, capture_output=True, timeout=60,
            )
            for png in sorted(_glob.glob(prefix + "*.png"))[:max_pages]:
                with open(png, "rb") as f:
                    images.append(("image/png", base64.b64encode(f.read()).decode("ascii")))
    except Exception as e:
        logger.warning(f"PDF→image render failed for '{file_path}': {e}")
    return images


_BODY_SOURCES = {"email_body", "email_msg", "email_eml"}


async def apply_ai_fallback(extracted: dict, *, filename: str, file_path: str | None = None) -> dict:
    """Escalate to AI extraction when needed, and ALWAYS preserve+scan email bodies.

    Two responsibilities:
      1. Row recovery — when a deterministic parse is weak (0 rows, junk columns,
         or no demand-like column), AI re-extracts the rows.
      2. Body capture — for any email body, the raw text is always saved, and the
         body is ALWAYS scanned by AI for line items AND sender instructions
         (e.g. "discard PO 200981234") — even when a table was already found,
         because instructions live in the prose, not the table.

    Returns the (possibly updated) extracted dict with heavy blobs stripped.
    """
    src = _get_source_type(filename)
    is_body = src in _BODY_SOURCES or extracted.get("_source") == "email_body"
    weak = _is_weak_extraction(extracted)

    # Gather AI inputs (body text/html + any inline images / rendered pages)
    ai_text = extracted.get("raw_text") or extracted.get("_body_text") or ""
    ai_html = extracted.get("raw_html") or extracted.get("_body_html") or ""
    ai_images = list(extracted.get("_inline_images") or [])
    if not ai_images and src == "image":
        ai_images = _image_file_for_ai(filename, file_path)
    if not ai_images and src == "pdf" and file_path and file_path.lower().endswith(".pdf"):
        ai_images = _pdf_images_for_ai(file_path)

    # Always persist the body text so it's saved in the DB JSON (table or not)
    if is_body and ai_text and not extracted.get("body_text"):
        extracted["body_text"] = ai_text

    have_input = bool(ai_text or ai_html or ai_images)
    # Run AI when: the parse is weak (need rows) OR this is an email body (always
    # scan prose for line items + instructions, even if a table was found).
    if have_input and (weak or is_body):
        ai = await extract_with_ai(text=ai_text, html=ai_html, images=ai_images, source_hint=filename)

        # Use AI rows when the parse was weak (recovery) OR this is an email body
        # (the AI sees prose + table + images together and returns one unified,
        # de-duplicated set — so a prose order alongside a reference table is kept).
        if ai.get("rows") and (weak or is_body):
            logger.info(f"AI extracted {len(ai['rows'])} rows from '{filename}'"
                        f"{' (body)' if is_body else ' (weak parse)'}")
            extracted = {**extracted, "columns": ai["columns"], "rows": ai["rows"], "_ai_extracted": True}

        if ai.get("instructions"):
            extracted["instructions"] = ai["instructions"]

    # If we still have no real table and the deterministic rows are clearly
    # non-demand junk (e.g. an email signature / contact block parsed as a
    # table — no demand-like column), drop those rows rather than store/show a
    # fake table. The body text is preserved for viewing. This keeps garbage out
    # even when AI is unavailable.
    if not extracted.get("_ai_extracted"):
        cols = extracted.get("columns") or []
        if extracted.get("rows") and (set(cols) in _JUNK_COLUMNS or not _has_meaningful_column(cols)):
            logger.info(f"Dropping non-demand junk rows from '{filename}' (no real table found)")
            extracted["columns"] = []
            extracted["rows"] = []

    for k in ("_inline_images", "_body_text", "_body_html"):
        extracted.pop(k, None)
    return extracted


async def process_email(db: AsyncSession, email_id: int) -> dict:
    """Full pipeline: parse body/attachments -> AI map columns -> store raw data."""
    result = await db.execute(select(Email).where(Email.id == email_id))
    email = result.scalar_one_or_none()

    if not email:
        raise ValueError(f"Email with id {email_id} not found")

    if email.status == EmailStatus.PROCESSED:
        return {
            "email_id": email.id,
            "status": "already_processed",
            "attachments_processed": 0,
            "raw_data_entries": 0,
            "message": "Email already processed",
        }

    email.status = EmailStatus.PROCESSING
    await db.flush()

    attachments_processed = 0
    raw_data_entries = 0

    try:
        att_result = await db.execute(
            select(Attachment).where(Attachment.email_id == email.id)
        )
        attachments = list(att_result.scalars().all())

        body_attachment = await _ensure_body_attachment(db, email, attachments)
        if body_attachment:
            attachments.append(body_attachment)

        for attachment in attachments:
            try:
                # 1. Deterministic parse (fast path for clean Excel/CSV/PDF/HTML tables)
                extracted = FileParser.parse(attachment.file_path, attachment.content_type)

                # 2. AI fallback when the deterministic parse is weak (email bodies,
                #    embedded tables, screenshots, scanned PDFs, mixed .msg/.eml).
                extracted = await apply_ai_fallback(
                    extracted, filename=attachment.filename, file_path=attachment.file_path
                )

                columns = extracted.get("columns", [])

                # 3. Column mapping → canonical schema (identity-ish for AI rows)
                column_mapping = {}
                mapped_data = extracted.get("rows", [])
                if columns:
                    column_mapping = await map_columns_with_ai(columns)
                    mapped_data = []
                    for row in extracted.get("rows", []):
                        mapped_row = {}
                        for src_col, value in row.items():
                            target_col = column_mapping.get(src_col, src_col)
                            if target_col != "UNMAPPED":
                                mapped_row[target_col] = value
                        mapped_data.append(mapped_row)

                raw = RawData(
                    attachment_id=attachment.id,
                    extracted_data=extracted,
                    column_mapping=column_mapping,
                    mapped_data=mapped_data,
                    source_type=_get_source_type(attachment.filename),
                )
                db.add(raw)
                raw_data_entries += 1
                attachments_processed += 1
                logger.info(f"Processed attachment: {attachment.filename}")

            except Exception as e:
                logger.error(f"Failed to process attachment {attachment.filename}: {e}")

        email.status = EmailStatus.PROCESSED
        await db.flush()

        return {
            "email_id": email.id,
            "status": "processed",
            "attachments_processed": attachments_processed,
            "raw_data_entries": raw_data_entries,
            "message": f"Successfully processed {attachments_processed} attachments",
        }

    except Exception as e:
        email.status = EmailStatus.FAILED
        email.error_message = str(e)
        await db.flush()
        logger.error(f"Email processing failed: {e}")
        raise


def _get_source_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    type_map = {
        "pdf": "pdf",
        "xlsx": "excel",
        "xls": "excel",
        "csv": "csv",
        "png": "image",
        "jpg": "image",
        "jpeg": "image",
        "tiff": "image",
        "bmp": "image",
        "gif": "image",
        "webp": "image",
        "txt": "email_body",
        "text": "email_body",
        "html": "email_body",
        "htm": "email_body",
        "msg": "email_msg",
        "eml": "email_eml",
    }
    return type_map.get(ext, "unknown")


async def _ensure_body_attachment(
    db: AsyncSession,
    email: Email,
    attachments: list[Attachment],
) -> Attachment | None:
    body = (email.body or "").strip()
    if not body:
        return None

    for attachment in attachments:
        # Skip if a body already exists. Prefer the HTML body (preserves tables);
        # the plain-text part just flattens the same content into junk lines.
        if attachment.filename in ("email_body.txt", "email_body.html"):
            return None

    email_dir = os.path.join(settings.UPLOAD_DIR, str(email.id))
    os.makedirs(email_dir, exist_ok=True)
    file_path = os.path.join(email_dir, "email_body.txt")
    with open(file_path, "w", encoding="utf-8") as f:
        f.write(body)

    attachment = Attachment(
        email_id=email.id,
        filename="email_body.txt",
        content_type="text/plain",
        file_path=file_path,
        file_size=os.path.getsize(file_path),
    )
    db.add(attachment)
    await db.flush()
    logger.info(f"Created body attachment for email id={email.id}")
    return attachment
