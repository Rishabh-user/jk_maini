import io
import math
import os
import re
from collections import defaultdict

import pandas as pd
import pdfplumber
import pytesseract
from PIL import Image

from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()
pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD

_CANONICAL_HEADER_ALIASES: dict[str, tuple[str, ...]] = {
    "item_no": ("item no", "item number", "item #", "line no", "line", "sl no", "sno", "item"),
    "material": ("material", "part no", "part number", "part #", "customer part", "item material", "drawing no"),
    "description": ("description", "desc", "item description", "discription"),
    "quantity": ("quantity", "qty", "outstanding receipt", "ordered", "open qty"),
    "uom": ("uom", "um", "unit of measure"),
    "unit_price": ("unit price", "net price", "price w/o", "price/ea", "unit net", "/ea"),
    "total_price": ("total price", "total w/", "total amount", "line total"),
    "delivery_date": ("delivery date", "due date", "vendor due date", "need by"),
    "po_number": ("po number", "po no", "po #", "purchase order", " po"),
    "reference": ("reference", "ref no", "contract"),
    "vendor": ("vendor", "vendor name", "supplier"),
    "line_status": ("line status", "status"),
}

_TABLE_MIN_SCORE = 3.5
_NOISE_HEADER_MARKERS = (
    "caution",
    "external email",
    "do not open",
    "bcc:",
    "order reschedule--maini",
    "comes from a known",
)
_FOOTER_ROW_MARKERS = (
    "vat amount",
    "total incl",
    "net total",
    "your material",
    "contract n",
    "page ",
    "www.",
    "sasu au capital",
    "terms and conditions",
    "item material quantity unit",
    "sub total", 
    "subtotal",
    "prepaid amount",
    "prepaid a",
    "total: us",
    "total: usd",
)
_DISPLAY_TABLE_TYPES = frozenset({"line_items", "schedule", "other"}) 


class FileParser:
    """Extract structured data from PDF, Excel, CSV, TXT, and image files."""

    @staticmethod
    def parse(file_path: str, content_type: str | None = None) -> dict:
        ext = os.path.splitext(file_path)[1].lower()
        logger.info(f"Parsing file: {file_path} (ext={ext}, content_type={content_type})")

        if ext == ".pdf":
            return FileParser.parse_pdf(file_path)
        if ext in (".xlsx", ".xls"):
            return FileParser.parse_excel(file_path)
        if ext == ".csv":
            return FileParser.parse_csv(file_path)
        if ext in (".txt", ".text"):
            return FileParser.parse_text(file_path)
        if ext in (".png", ".jpg", ".jpeg", ".tiff", ".bmp"):
            return FileParser.parse_image(file_path)

        logger.warning(f"Unsupported file type: {ext}")
        return {"error": f"Unsupported file type: {ext}", "columns": [], "rows": []}

    @staticmethod
    def parse_pdf(file_path: str) -> dict:
        combined_text: list[str] = []
        raw_candidates: list[dict] = []

        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                combined_text.append(page.extract_text() or "")
            raw_candidates.extend(FileParser._collect_pdf_table_candidates(pdf))
            raw_candidates.extend(FileParser._collect_pdf_layout_candidates(pdf))

        full_text = "\n".join(combined_text)
        airsupply_rows = FileParser._parse_airsupply_po_text(full_text)
        if airsupply_rows:
            raw_candidates.append(
                FileParser._make_candidate(
                    "doc_airsupply_po",
                    "pdf_text_airsupply_po",
                    airsupply_rows,
                    page_no=0,
                )
            )
        headered_rows = FileParser._parse_headered_line_item_text(full_text)
        if headered_rows:
            raw_candidates.append(
                FileParser._make_candidate(
                    "doc_headered_line_items",
                    "pdf_text_headered_line_items",
                    headered_rows,
                    page_no=0,
                )
            )
        text_rows = FileParser._parse_delimited_or_line_item_text(full_text)
        if text_rows:
            raw_candidates.append(
                FileParser._make_candidate("doc_text", "pdf_text_fallback", text_rows, page_no=0)
            )
        po_rows = FileParser._parse_po_numeric_lines(full_text)
        if po_rows:
            raw_candidates.append(
                FileParser._make_candidate("doc_po_pattern", "pdf_text_po_pattern", po_rows, page_no=0)
            )

        scored_tables: list[dict] = []
        for cand in raw_candidates:
            if not cand:
                continue
            prepared = FileParser._prepare_table_candidate(cand)
            if prepared and prepared["score"] >= _TABLE_MIN_SCORE:
                scored_tables.append(prepared)

        scored_tables = FileParser._dedupe_table_candidates(scored_tables)
        scored_tables.sort(key=lambda t: t["score"], reverse=True)

        selected_tables = [
            t
            for t in scored_tables
            if t["table_type"] in _DISPLAY_TABLE_TYPES and not FileParser._is_prose_table(t["columns"], t["rows"])
        ]
        primary = FileParser._pick_primary_table(selected_tables)

        if not primary:
            ocr_rows, ocr_text = FileParser._ocr_pdf(file_path)
            if ocr_rows:
                primary = FileParser._prepare_table_candidate(
                    FileParser._make_candidate("doc_ocr", "pdf_ocr_fallback", ocr_rows, page_no=0)
                )
                if primary:
                    selected_tables = [primary]
            elif ocr_text:
                return {
                    "raw_text": ocr_text,
                    "columns": [],
                    "rows": [],
                    "tables": [],
                    "_debug": {"selected_strategy": "pdf_ocr_text_only", "table_candidates": []},
                }

        if not primary:
            return {
                "raw_text": full_text.strip(),
                "columns": [],
                "rows": [],
                "tables": [],
                "_debug": {"selected_strategy": "none", "table_candidates": []},
            }

        logger.info(
            f"PDF parsed final: primary={primary['table_id']} type={primary['table_type']} "
            f"strategy={primary['strategy']} score={primary['score']:.2f} "
            f"columns={len(primary['columns'])} rows={len(primary['rows'])} tables={len(selected_tables)}"
        )
        return {
            "columns": primary["columns"],
            "rows": primary["rows"],
            "tables": selected_tables,
            "selected_table_ids": [t["table_id"] for t in selected_tables],
            "primary_table_id": primary["table_id"],
            "_debug": {
                "selected_strategy": primary["strategy"],
                "selected_table_id": primary["table_id"],
                "table_type": primary["table_type"],
                "canonical_fields": primary["canonical_fields"],
                "table_candidates": [
                    {
                        "table_id": t["table_id"],
                        "page_no": t["page_no"],
                        "strategy": t["strategy"],
                        "table_type": t["table_type"],
                        "score": round(t["score"], 2),
                        "row_count": len(t["rows"]),
                        "columns": t["columns"][:12],
                        "canonical_fields": t["canonical_fields"],
                    }
                    for t in scored_tables
                ],
            },
        }

    @staticmethod
    def _make_candidate(
        table_id: str,
        strategy: str,
        rows: list[dict],
        page_no: int = 0,
    ) -> dict | None:
        if not rows:
            return None
        return {
            "table_id": table_id,
            "page_no": page_no,
            "strategy": strategy,
            "columns": list(rows[0].keys()),
            "rows": rows,
        }

    @staticmethod
    def _collect_pdf_table_candidates(pdf) -> list[dict]:
        candidates: list[dict] = []
        settings_list = (
            ("lines", {"vertical_strategy": "lines", "horizontal_strategy": "lines", "snap_tolerance": 5, "join_tolerance": 5}),
            ("text", {"vertical_strategy": "text", "horizontal_strategy": "text"}),
        )
        for page_no, page in enumerate(pdf.pages, start=1):
            for mode, table_settings in settings_list:
                try:
                    tables = page.extract_tables(table_settings) or []
                except Exception:
                    tables = []
                for t_idx, table in enumerate(tables):
                    rows = FileParser._table_to_rows(table)
                    if not rows:
                        continue
                    base_id = f"p{page_no}_{mode}_t{t_idx}"
                    candidates.append(
                        FileParser._make_candidate(base_id, f"pdf_tables_{mode}", rows, page_no=page_no)
                    )
                    reframed = FileParser._reframe_table_rows(rows)
                    if reframed and len(reframed) >= 2:
                        candidates.append(
                            FileParser._make_candidate(
                                f"{base_id}_reframed",
                                f"pdf_table_reframed_{mode}",
                                reframed,
                                page_no=page_no,
                            )
                        )
        return [c for c in candidates if c]

    @staticmethod
    def _collect_pdf_layout_candidates(pdf) -> list[dict]:
        candidates: list[dict] = []
        for page_no, page in enumerate(pdf.pages, start=1):
            rows = FileParser._extract_layout_rows_for_page(page)
            if rows:
                candidates.append(
                    FileParser._make_candidate(
                        f"p{page_no}_layout",
                        "pdf_layout_words",
                        rows,
                        page_no=page_no,
                    )
                )
        return candidates

    @staticmethod
    def _extract_layout_rows_for_page(page) -> list[dict]:
        words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False) or []
        if len(words) < 10:
            return []
        words = FileParser._filter_words_to_body_region(words, float(page.height))
        if len(words) < 10:
            return []

        line_groups: dict[int, list] = defaultdict(list)
        for word in words:
            y_key = round(float(word["top"]) / 3) * 3
            line_groups[y_key].append(word)

        lines: list[list[str]] = []
        for y_key in sorted(line_groups.keys()):
            line_words = sorted(line_groups[y_key], key=lambda w: float(w["x0"]))
            values = [w["text"].strip() for w in line_words if w["text"].strip()]
            if values:
                lines.append(values)

        if len(lines) < 2:
            return []

        header = lines[0]
        if len(header) < 2:
            return []
        headers = FileParser._unique_headers(header)

        rows: list[dict] = []
        for line in lines[1:]:
            if len(line) < 2:
                continue
            if len(line) > len(headers):
                line = line[: len(headers)]
            if len(line) < len(headers):
                line += [""] * (len(headers) - len(line))
            rows.append({headers[i]: line[i] for i in range(len(headers))})
        return rows

    @staticmethod
    def _prepare_table_candidate(cand: dict) -> dict | None:
        columns = cand["columns"]
        canonical = FileParser._canonical_fields_from_headers(columns)
        table_type = FileParser._classify_table_type(columns, canonical)
        filtered = FileParser._filter_table_rows(cand["rows"], columns, table_type, canonical)
        if not filtered:
            return None

        score = FileParser._score_table_candidate(columns, filtered, canonical, table_type, cand["strategy"])
        if table_type == "noise" or score < _TABLE_MIN_SCORE:
            return None

        return {
            "table_id": cand["table_id"],
            "page_no": cand["page_no"],
            "strategy": cand["strategy"],
            "table_type": table_type,
            "columns": columns,
            "rows": filtered,
            "canonical_fields": sorted(canonical),
            "score": score,
        }

    @staticmethod
    def _canonical_fields_from_headers(columns: list[str]) -> set[str]:
        matched: set[str] = set()
        short_exact = {
            "po": "po_number",
            "item": "item_no",
            "line": "item_no",
            "qty": "quantity",
            "um": "uom",
        }
        header_blob = " " + " ".join(FileParser._normalize_header(h) for h in columns) + " "
        for col in columns:
            norm = FileParser._normalize_header(col)
            if norm in short_exact:
                matched.add(short_exact[norm])
        for field, aliases in _CANONICAL_HEADER_ALIASES.items():
            if field in matched:
                continue
            if any(f" {alias} " in header_blob for alias in aliases):
                matched.add(field)
            else:
                for col in columns:
                    norm = FileParser._normalize_header(col)
                    if any(alias in norm for alias in aliases):
                        matched.add(field)
                        break
        return matched

    @staticmethod
    def _normalize_header(header: str) -> str:
        return re.sub(r"\s+", " ", (header or "").replace("\n", " ").strip().lower())

    @staticmethod
    def _classify_table_type(columns: list[str], canonical: set[str]) -> str:
        header_blob = " ".join(FileParser._normalize_header(c) for c in columns)
        if any(marker in header_blob for marker in _NOISE_HEADER_MARKERS):
            return "noise"
        if sum(1 for c in columns if c.lower().startswith("column")) >= max(2, len(columns) // 2):
            return "noise"
        if FileParser._is_weak_address_layout(columns):
            return "noise"

        if "item_no" in canonical and "quantity" in canonical and (
            "material" in canonical or "po_number" in canonical or "unit_price" in canonical
        ):
            return "line_items"
        if canonical >= {"item_no", "quantity"} or canonical >= {"material", "quantity"}:
            return "line_items"
        if (
            "item_no" in canonical
            and "delivery_date" in canonical
            and "reference" in canonical
            and "po_number" not in canonical
        ):
            return "schedule"
        if "material" in canonical and "delivery_date" in canonical and "reference" in canonical:
            return "schedule"
        if "item_no" in canonical and "delivery_date" in canonical:
            return "schedule"
        if "total_price" in canonical and len(columns) <= 4:
            return "footer"
        if FileParser._is_prose_table(columns, []):
            return "noise"
        if len(columns) == 1:
            return "noise"
        if canonical:
            return "other"
        return "noise"

    @staticmethod
    def _is_weak_address_layout(columns: list[str]) -> bool:
        norms = {FileParser._normalize_header(c) for c in columns}
        weak = {"po", "version", "number", "revise", "date", "remark"}
        if len(norms) >= 4 and norms.issubset(weak | {"company", "address", "vendor"}):
            return True
        if norms <= weak and len(norms) >= 4:
            return True
        return False

    @staticmethod
    def _is_prose_table(columns: list[str], rows: list[dict]) -> bool:
        norms = [FileParser._normalize_header(c) for c in columns if FileParser._normalize_header(c)]
        if not norms:
            return True

        canonical = FileParser._canonical_fields_from_headers(columns)
        if canonical >= {"item_no", "quantity"} or canonical >= {"material", "quantity"}:
            return False
        if "delivery_date" in canonical and ("item_no" in canonical or "material" in canonical):
            return False

        header_blob = " ".join(norms)
        prose_markers = (
            "dear ",
            "please ",
            "kindly ",
            "thank",
            "regards",
            "attached",
            "following",
            "subject:",
            "from:",
            "sent:",
            "note:",
            "terms and conditions",
        )
        if not canonical and any(marker in header_blob for marker in prose_markers):
            return True

        long_headers = sum(1 for h in norms if len(h) > 35 or len(h.split()) >= 7)
        if not canonical and len(norms) <= 2 and long_headers:
            return True
        if not canonical and len(norms) >= 3 and long_headers >= max(2, math.ceil(len(norms) * 0.6)):
            return True

        sample = rows[: min(30, len(rows))]
        prose_rows = 0
        numeric_rows = 0
        filled_rows = 0
        for row in sample:
            vals = [str(v).strip() for v in row.values() if str(v).strip()]
            if not vals:
                continue
            filled_rows += 1
            joined = " ".join(vals)
            has_numeric = bool(re.search(r"\b\d+(?:[,.]\d+)?\b", joined))
            has_date = bool(re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", joined))
            if has_numeric or has_date:
                numeric_rows += 1
                continue

            word_count = len(re.findall(r"[A-Za-z]{2,}", joined))
            sentence_like = word_count >= 10 or bool(re.search(r"[.!?;:]$", joined))
            if len(vals) <= 2 and len(joined) > 45 and sentence_like:
                prose_rows += 1

        if filled_rows and numeric_rows == 0 and (prose_rows / filled_rows) > 0.55:
            return True

        return False

    @staticmethod
    def _filter_table_rows(
        rows: list[dict],
        columns: list[str],
        table_type: str,
        canonical: set[str],
    ) -> list[dict]:
        out: list[dict] = []
        strict_line_filter = table_type == "line_items" and len(rows) > 3
        for row in rows:
            if FileParser._is_low_information_row(row):
                continue
            if FileParser._is_footer_or_metadata_row(row):
                continue
            if FileParser._is_header_duplicate_row(row, columns):
                continue
            if strict_line_filter and not FileParser._is_plausible_line_item_row(row, canonical):
                continue
            out.append(row)
        return out

    @staticmethod
    def _is_footer_or_metadata_row(row: dict) -> bool:
        blob = " ".join(str(v).strip().lower() for v in row.values() if str(v).strip())
        if not blob:
            return True
        if any(marker in blob for marker in _FOOTER_ROW_MARKERS):
            return True
        if re.search(r"\bpage\s+\d+\s*/\s*\d+\b", blob):
            return True
        if "purchase order www." in blob or "copy-no" in blob:
            return True
        return False

    @staticmethod
    def _is_header_duplicate_row(row: dict, columns: list[str]) -> bool:
        vals = [str(v).strip().lower() for v in row.values() if str(v).strip()]
        if not vals:
            return False
        col_terms = [FileParser._normalize_header(c) for c in columns]
        hits = sum(
            1
            for v in vals
            for c in col_terms
            if c and (v == c or (len(c) > 5 and c in v))
        )
        return hits >= max(2, min(3, len(col_terms)))

    @staticmethod
    def _is_plausible_line_item_row(row: dict, canonical: set[str]) -> bool:
        blob = " ".join(str(v).strip() for v in row.values() if str(v).strip())
        if not blob:
            return False
        if _is_number(blob.replace(",", "")):
            return False
        has_part = bool(
            re.search(r"\b\d{5}\b", blob)
            or re.search(r"\b\d{3}-\d{3}-\d{3}", blob)
            or re.search(r"\b[A-Z0-9]{2,}-[A-Z0-9]{2,}-[A-Z0-9]{2,}", blob, re.I)
        )
        has_qty = any(_is_number(str(v)) for v in row.values())
        has_date = any(re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", str(v)) for v in row.values())
        if "quantity" in canonical or "item_no" in canonical:
            return has_part or (has_qty and has_date) or (has_qty and len(blob) < 80)
        return has_qty or has_part or has_date

    @staticmethod
    def _score_table_candidate(
        columns: list[str],
        rows: list[dict],
        canonical: set[str],
        table_type: str,
        strategy: str,
    ) -> float:
        score = len(canonical) * 1.4
        header_blob = " ".join(FileParser._normalize_header(c) for c in columns)

        if table_type == "line_items":
            score += 3.0
        elif table_type == "schedule":
            score += 2.0
        elif table_type == "footer":
            score -= 2.0

        if strategy == "pdf_text_po_pattern":
            score += 4.0
        if strategy == "pdf_text_airsupply_po":
            score += 8.0
        if strategy == "pdf_text_headered_line_items":
            score += 6.0

        if {"item_no", "quantity"} <= canonical:
            score += 2.0
        if "material" in canonical and "quantity" in canonical:
            score += 1.5
        if "po_number" in canonical and "item_no" in canonical:
            score += 2.5
        if "vendor" in canonical and "po_number" in canonical and "item_no" in canonical:
            score += 5.0
        if FileParser._is_po_detail_table(columns):
            score += 10.0

        score += FileParser._header_quality_score(columns)

        generic = sum(1 for c in columns if c.lower().startswith("column"))
        score -= generic * 0.6
        if any(marker in header_blob for marker in _NOISE_HEADER_MARKERS):
            score -= 4.0
        if FileParser._is_weak_address_layout(columns):
            score -= 5.0

        sample = rows[: min(20, len(rows))]
        if sample:
            good = sum(1 for r in sample if not FileParser._is_footer_or_metadata_row(r))
            score += (good / len(sample)) * 3.0
        score += min(len(rows), 120) / 30.0
        score -= FileParser._repetition_penalty(rows)
        return score

    @staticmethod
    def _dedupe_table_candidates(tables: list[dict]) -> list[dict]:
        if not tables:
            return []
        kept: list[dict] = []
        for table in sorted(tables, key=lambda t: t["score"], reverse=True):
            sig = (
                table["page_no"],
                tuple(sorted(FileParser._normalize_header(c) for c in table["columns"][:6])),
                table["table_type"],
            )
            duplicate = False
            for existing in kept:
                existing_sig = (
                    existing["page_no"],
                    tuple(sorted(FileParser._normalize_header(c) for c in existing["columns"][:6])),
                    existing["table_type"],
                )
                if sig == existing_sig:
                    duplicate = True
                    break
            if not duplicate:
                kept.append(table)
        return kept

    @staticmethod
    def _header_quality_score(columns: list[str]) -> float:
        score = 0.0
        for col in columns:
            norm = FileParser._normalize_header(col)
            if not norm or norm.startswith("column"):
                score -= 1.0
                continue
            if len(norm) > 45:
                score -= 4.0
            elif len(norm) > 28:
                score -= 2.0
            else:
                score += 1.2
            alias_hits = 0
            for aliases in _CANONICAL_HEADER_ALIASES.values():
                if any(alias in norm for alias in aliases):
                    alias_hits += 1
            if alias_hits >= 2:
                score -= 3.0
            if len(norm.split()) >= 4 and alias_hits >= 2:
                score -= 8.0
        return score

    @staticmethod
    def _is_po_detail_table(columns: list[str]) -> bool:
        norms = [FileParser._normalize_header(c) for c in columns]
        if any(len(n) > 32 or len(n.split()) >= 5 for n in norms):
            return False
        has_vendor = any("vendor" in n for n in norms)
        has_po = any(n == "po" or "po number" in n for n in norms)
        has_item = any(n == "item" or "item number" in n for n in norms)
        return has_vendor and has_po and has_item

    @staticmethod
    def _pick_primary_table(tables: list[dict]) -> dict | None:
        if not tables:
            return None
        po_detail = [t for t in tables if t["table_type"] == "line_items" and FileParser._is_po_detail_table(t["columns"])]
        if po_detail:
            return max(
                po_detail,
                key=lambda t: (
                    FileParser._header_quality_score(t["columns"]),
                    t["score"],
                    len(t["rows"]),
                ),
            )

        type_priority = {"line_items": 0, "schedule": 1, "other": 2, "footer": 3}

        def rank_key(t: dict) -> tuple:
            effective = t["score"] + FileParser._header_quality_score(t["columns"])
            return (type_priority.get(t["table_type"], 9), -effective)

        return sorted(tables, key=rank_key)[0]

    @staticmethod
    def _extract_pdf_tables(pdf) -> list[dict]:
        rows = []
        settings_list = (
            {"vertical_strategy": "lines", "horizontal_strategy": "lines", "snap_tolerance": 5, "join_tolerance": 5},
            {"vertical_strategy": "text", "horizontal_strategy": "text"},
        )

        for page in pdf.pages:
            for table_settings in settings_list:
                try:
                    tables = page.extract_tables(table_settings) or []
                except Exception:
                    tables = []
                for table in tables:
                    rows.extend(FileParser._table_to_rows(table))
        return rows

    @staticmethod
    def _extract_pdf_layout_rows(pdf) -> list[dict]:
        rows = []
        for page in pdf.pages:
            words = page.extract_words(x_tolerance=2, y_tolerance=2, keep_blank_chars=False) or []
            if len(words) < 10:
                continue
            words = FileParser._filter_words_to_body_region(words, float(page.height))
            if len(words) < 10:
                continue

            line_groups = defaultdict(list)
            for word in words:
                y_key = round(float(word["top"]) / 3) * 3
                line_groups[y_key].append(word)

            lines = []
            for y_key in sorted(line_groups.keys()):
                line_words = sorted(line_groups[y_key], key=lambda w: float(w["x0"]))
                values = [w["text"].strip() for w in line_words if w["text"].strip()]
                if values:
                    lines.append(values)

            if len(lines) < 2:
                continue

            header = lines[0]
            if len(header) < 2:
                continue
            headers = FileParser._unique_headers(header)

            for line in lines[1:]:
                if len(line) < 2:
                    continue
                if len(line) > len(headers):
                    line = line[:len(headers)]
                if len(line) < len(headers):
                    line += [""] * (len(headers) - len(line))
                rows.append({headers[i]: line[i] for i in range(len(headers))})
        return rows

    @staticmethod
    def _reframe_table_rows(rows: list[dict]) -> list[dict]:
        if not rows:
            return []
        flat_rows = [list(r.values()) for r in rows]
        header_keywords = ("item", "material", "part", "qty", "quantity", "uom", "unit", "price", "amount", "date", "description")
        stop_markers = ("terms", "conditions", "invoice", "shipping", "payment", "buyer", "supplier", "contact")

        best_start = -1
        best_headers = []
        for i, values in enumerate(flat_rows[: min(80, len(flat_rows))]):
            clean = [FileParser._clean_cell(v) for v in values if FileParser._clean_cell(v)]
            if len(clean) < 3:
                continue
            hits = sum(1 for c in clean if any(k in c.lower() for k in header_keywords))
            if hits >= 3:
                headers = FileParser._unique_headers(clean[:8])
                if len(headers) >= 3:
                    best_start = i
                    best_headers = headers
                    break

        if best_start < 0 or not best_headers:
            return []

        out = []
        for values in flat_rows[best_start + 1 :]:
            clean = [FileParser._clean_cell(v) for v in values]
            non_empty = [c for c in clean if c]
            if not non_empty:
                continue
            text_blob = " ".join(non_empty).lower()
            if any(marker in text_blob for marker in stop_markers) and len(non_empty) <= 3:
                if out:
                    break
            if len(non_empty) < 2:
                continue
            row_vals = non_empty[: len(best_headers)]
            if len(row_vals) < len(best_headers):
                row_vals += [""] * (len(best_headers) - len(row_vals))
            row = {best_headers[idx]: row_vals[idx] for idx in range(len(best_headers))}
            if FileParser._is_low_information_row(row):
                continue
            out.append(row)
        return out

    @staticmethod
    def _clean_cell(value) -> str:
        cell = re.sub(r"\s+", " ", str(value or "").replace("\n", " ").strip())
        return cell

    @staticmethod
    def _is_low_information_row(row: dict) -> bool:
        vals = [str(v).strip() for v in row.values() if str(v).strip()]
        if not vals:
            return True
        if len(vals) == 1 and len(vals[0]) < 4:
            return True
        has_signal = any(_is_number(v) for v in vals) or any(re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", v) for v in vals)
        return not has_signal and len(" ".join(vals)) < 14

    @staticmethod
    def _filter_words_to_body_region(words: list[dict], page_height: float) -> list[dict]:
        if not words:
            return []
        # Drop top and bottom bands where repeated PO headers/footers usually dominate.
        top_cut = page_height * 0.10
        bottom_cut = page_height * 0.92
        body_words = [w for w in words if top_cut <= float(w.get("top", 0)) <= bottom_cut]
        return body_words if len(body_words) >= max(8, int(len(words) * 0.35)) else words

    @staticmethod
    def _table_to_rows(table: list[list[str | None]]) -> list[dict]:
        if not table or len(table) < 2:
            return []
        header_raw = table[0]
        if not header_raw:
            return []
        headers = FileParser._unique_headers([str(c).strip() if c else "" for c in header_raw])
        rows = []
        for row in table[1:]:
            if not row:
                continue
            values = [str(c).strip() if c is not None else "" for c in row]
            if not any(values):
                continue
            rows.append({headers[i]: values[i] if i < len(values) else "" for i in range(len(headers))})
        return rows

    @staticmethod
    def _parse_delimited_or_line_item_text(text: str) -> list[dict]:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            return []

        for delimiter in ("|", "\t", ","):
            header_idx = -1
            headers = []
            for i, line in enumerate(lines):
                if delimiter not in line:
                    continue
                cells = [c.strip() for c in line.split(delimiter) if c.strip()]
                if len(cells) >= 3 and sum(1 for c in cells if re.search(r"[A-Za-z]", c)) >= 2:
                    headers = FileParser._unique_headers(cells)
                    header_idx = i
                    break

            if header_idx >= 0:
                rows = []
                for line in lines[header_idx + 1:]:
                    if delimiter not in line:
                        if rows and re.search(r"total|shipping|tax|notes|address", line, re.IGNORECASE):
                            break
                        continue
                    cells = [c.strip() for c in line.split(delimiter)]
                    if len(cells) > len(headers):
                        cells = cells[:len(headers)]
                    if len(cells) < len(headers):
                        cells += [""] * (len(headers) - len(cells))
                    rows.append({headers[i]: cells[i] for i in range(len(headers))})
                if rows:
                    return rows

        wrapped_rows = FileParser._parse_wrapped_records(lines)
        if wrapped_rows:
            return wrapped_rows

        line_patterns = (
            re.compile(r"^\s*(?P<item>\d{1,6})\s*\|\s*(?P<desc>[^|]+?)\s*\|\s*(?P<qty>\d+(?:\.\d+)?)\s*\|\s*(?P<price>\d+(?:\.\d+)?)\s*$"),
            re.compile(r"^\s*(?P<item>[A-Za-z0-9\-/]+)\s+(?P<desc>.+?)\s+(?P<qty>\d+(?:\.\d+)?)\s+(?P<uom>[A-Za-z]{1,5})\s+(?P<price>\d+(?:\.\d+)?)\s*$"),
        )

        rows = []
        for line in lines:
            for pattern in line_patterns:
                match = pattern.match(line)
                if not match:
                    continue
                data = match.groupdict()
                rows.append(
                    {
                        "Item": data.get("item", ""),
                        "Description": (data.get("desc", "") or "").strip(),
                        "Quantity": data.get("qty", ""),
                        "UoM": data.get("uom", ""),
                        "Unit Price": data.get("price", ""),
                    }
                )
                break
        return rows

    @staticmethod
    def _parse_headered_line_item_text(text: str) -> list[dict]:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines:
            return []

        header_re = re.compile(
            r"\bitem\b.*\bmaterial\b.*\bquantity\b.*\bunit\b.*\bnet\s+price\b.*"
            r"\bdelivery\s+date\b.*\btotal\s+w/o\s+tax\b",
            re.I,
        )
        row_re = re.compile(
            r"^(?P<item>\d{1,6})\s+"
            r"(?P<material>[A-Z0-9][A-Z0-9./_-]{2,})\s+"
            r"(?P<quantity>\d+(?:[,.]\d+)?)\s+"
            r"(?P<unit>[A-Z]{1,5})\s+"
            r"(?P<net_price>[\d,]+(?:\.\d+)?(?:/[A-Z]{1,5})?)\s+"
            r"(?P<delivery_date>\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+"
            r"(?P<total>[\d,]+(?:\.\d+)?)\s*"
            r"(?P<currency>[A-Z]{3})?\s*$",
            re.I,
        )
        stop_markers = (
            "contractual data",
            "net total",
            "vat amount",
            "total incl",
            "terms \"buyer\"",
            "the terms \"buyer\"",
            "safran aerospace composites",
            "www.",
        )

        in_table = False
        rows: list[dict] = []
        current: dict | None = None

        for line in lines:
            if header_re.search(line):
                if current:
                    rows.append(current)
                    current = None
                in_table = True
                continue

            if not in_table:
                continue

            lower = line.lower()
            if any(marker in lower for marker in stop_markers):
                if current:
                    rows.append(current)
                    current = None
                if rows:
                    break
                continue

            match = row_re.match(line)
            if match:
                if current:
                    rows.append(current)
                data = match.groupdict()
                total = data["total"]
                currency = data.get("currency") or ""
                current = {
                    "Item": data["item"],
                    "Material": data["material"],
                    "Quantity": data["quantity"],
                    "Unit": data["unit"].upper(),
                    "Net price w/o tax": data["net_price"],
                    "Delivery date": data["delivery_date"],
                    "Total w/o tax": f"{total} {currency}".strip(),
                    "Description": "",
                    "Your material reference": "",
                }
                continue

            if not current:
                continue

            if lower.startswith("your material reference"):
                current["Your material reference"] = re.sub(
                    r"^your\s+material\s+reference\s*:?",
                    "",
                    line,
                    flags=re.I,
                ).strip()
                continue

            if re.search(r"\b(purchase order|delivery|supplier|page\s+\d+)\b", lower):
                continue

            current["Description"] = " ".join(
                part for part in (current.get("Description", ""), line) if part
            ).strip()

        if current:
            rows.append(current)

        return rows

    @staticmethod
    def _parse_airsupply_po_text(text: str) -> list[dict]:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        if not lines or "AirSupply" not in text or "Line Material Description" not in text:
            return []

        po_number = ""
        po_revision = ""
        po_date = ""
        change_date = ""
        po_match = re.search(
            r"\b(?P<po>\d{8,12})\s*-\s*(?P<revision>\d+)\s*/\s*"
            r"(?P<po_date>\d{2}\.\d{2}\.\d{4})\s*/\s*(?P<change_date>\d{2}\.\d{2}\.\d{4})",
            text,
        )
        if po_match:
            po_number = po_match.group("po")
            po_revision = po_match.group("revision")
            po_date = po_match.group("po_date")
            change_date = po_match.group("change_date")

        item_re = re.compile(r"^(?P<line>\d{5})\s+(?P<material>[A-Z0-9][A-Z0-9./_-]{2,})\s+(?P<desc>.+)$")
        price_re = re.compile(
            r"^(?P<quantity>[\d ]+(?:[.,]\d+)?)\s+"
            r"(?P<uom>[A-Z]{1,5})\s+"
            r"(?P<unit_price>[\d ]+(?:[.,]\d+)?)\s+"
            r"(?P<currency>[A-Z]{3})\s*/\s*"
            r"(?P<price_unit>\d+\s*[A-Z]{1,5})\s+"
            r"(?P<total>[\d ]+(?:[.,]\d+)?)\s+"
            r"(?P<total_currency>[A-Z]{3})$"
        )
        schedule_re = re.compile(
            r"^(?P<schedule_line>\d{4})\s+"
            r"(?P<req_qty>[\d ]+(?:[.,]\d+)?)\s+"
            r"(?P<req_uom>[A-Z]{1,5})\s+"
            r"(?P<req_date>\d{2}\.\d{2}\.\d{4})\s+"
            r"(?P<prom_qty>[\d ]+(?:[.,]\d+)?)\s+"
            r"(?P<prom_uom>[A-Z]{1,5})\s+"
            r"(?P<prom_date>\d{2}\.\d{2}\.\d{4})\s+"
            r"(?P<status>[A-Z]+)$"
        )

        def clean_amount(value: str) -> str:
            value = re.sub(r"\s+", "", value or "")
            if "." in value and len(value.split(".")[0]) > 3:
                whole, decimal = value.rsplit(".", 1)
                whole = f"{int(whole):,}" if whole.isdigit() else whole
                return f"{whole}.{decimal}"
            return value

        rows: list[dict] = []
        idx = 0
        while idx < len(lines):
            match = item_re.match(lines[idx])
            if not match:
                idx += 1
                continue

            data = match.groupdict()
            row = {
                "Item": data["line"],
                "Material": data["material"],
                "Description": data["desc"].strip(),
                "Quantity": "",
                "UoM": "",
                "Unit Price": "",
                "Currency": "",
                "Price Unit": "",
                "Total Price": "",
                "Supplier Material Number": "",
                "MSN": "",
                "Contract": "",
                "Contract Line": "",
                "Incoterm": "",
                "Delivery Location": "",
                "Schedule Line": "",
                "Requested Quantity": "",
                "Requested Date": "",
                "Promised Quantity": "",
                "Delivery Date": "",
                "Status": "",
                "PO Number": po_number,
                "PO Revision": po_revision,
                "PO Date": po_date,
                "PO Change Date": change_date,
            }

            idx += 1
            while idx < len(lines):
                line = lines[idx]
                lower = line.lower()
                if item_re.match(line):
                    break
                if line.startswith("PO:") or lower.startswith('"back of order') or lower.startswith("vat amount"):
                    break

                price_match = price_re.match(line)
                if price_match:
                    price = price_match.groupdict()
                    row["Quantity"] = clean_amount(price["quantity"])
                    row["UoM"] = price["uom"]
                    row["Unit Price"] = clean_amount(price["unit_price"])
                    row["Currency"] = price["currency"]
                    row["Price Unit"] = re.sub(r"\s+", "", price["price_unit"])
                    row["Total Price"] = f"{clean_amount(price['total'])} {price['total_currency']}"
                    idx += 1
                    continue

                schedule_match = schedule_re.match(line)
                if schedule_match:
                    schedule = schedule_match.groupdict()
                    row["Schedule Line"] = schedule["schedule_line"]
                    row["Requested Quantity"] = f"{clean_amount(schedule['req_qty'])} {schedule['req_uom']}"
                    row["Requested Date"] = schedule["req_date"]
                    row["Promised Quantity"] = f"{clean_amount(schedule['prom_qty'])} {schedule['prom_uom']}"
                    row["Delivery Date"] = schedule["prom_date"]
                    row["Status"] = schedule["status"]
                    idx += 1
                    continue

                if lower.startswith("supplier material number:"):
                    row["Supplier Material Number"] = line.split(":", 1)[1].strip()
                elif lower.startswith("to be delivered for msn:"):
                    row["MSN"] = line.split(":", 1)[1].strip()
                elif lower.startswith("ordered against contract:"):
                    contract_match = re.search(r"contract:\s*(?P<contract>\S+)\s+line\s+(?P<line>\S+)", line, re.I)
                    if contract_match:
                        row["Contract"] = contract_match.group("contract")
                        row["Contract Line"] = contract_match.group("line")
                elif lower.startswith("incoterm:"):
                    incoterm = line.split(":", 1)[1].strip()
                    parts = [part.strip() for part in incoterm.split("/", 1)]
                    row["Incoterm"] = parts[0]
                    if len(parts) > 1:
                        row["Delivery Location"] = parts[1]
                elif not lower.startswith(("line material", "order qty", "sl req.")):
                    row["Description"] = " ".join(
                        part for part in (row["Description"], line) if part
                    ).strip()

                idx += 1

            if row["Quantity"] or row["Delivery Date"]:
                rows.append(row)

        return rows

    @staticmethod
    def _parse_wrapped_records(lines: list[str]) -> list[dict]:
        date_start_re = re.compile(r"^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}\b")
        date_value_re = re.compile(r"^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$")
        records = []
        current = []

        for line in lines:
            tokens = line.split()
            if not tokens:
                continue
            if date_start_re.match(line) and FileParser._find_qty_uom_plant_index(tokens) is not None:
                if current:
                    records.append(" ".join(current))
                current = [line]
            elif current:
                current.append(line)
        if current:
            records.append(" ".join(current))

        rows = []
        for record in records:
            tokens = record.split()
            if len(tokens) < 7:
                continue
            qty_idx = FileParser._find_qty_uom_plant_index(tokens)
            if qty_idx is None or qty_idx + 2 >= len(tokens):
                continue

            run_date = tokens[0]
            customer_part = tokens[1]
            before_qty = tokens[2:qty_idx]

            po_number = ""
            if len(before_qty) >= 3 and _is_number(before_qty[-3]) and _is_number(before_qty[-2]) and _is_number(before_qty[-1]):
                po_number = before_qty[-3]
                desc_tokens = before_qty[:-3]
            elif before_qty and before_qty[-1] == "-":
                po_number = "-"
                desc_tokens = before_qty[:-1]
            else:
                desc_tokens = before_qty

            plant_idx = qty_idx + 2
            delivery_date = ""
            for token in tokens[plant_idx + 1:]:
                if date_value_re.match(token):
                    delivery_date = token
                    break

            rows.append(
                {
                    "Run Date": run_date,
                    "Customer Part #": customer_part,
                    "Description": " ".join(desc_tokens).strip(),
                    "PO Number": po_number,
                    "Quantity": tokens[qty_idx],
                    "UoM": tokens[qty_idx + 1],
                    "Plant": tokens[plant_idx],
                    "Delivery Date": delivery_date,
                }
            )
        return rows

    @staticmethod
    def _find_qty_uom_plant_index(tokens: list[str]) -> int | None:
        for i in range(2, len(tokens) - 2):
            if _is_number(tokens[i]) and tokens[i + 1].isalpha() and len(tokens[i + 1]) <= 5 and _is_number(tokens[i + 2]):
                return i
        return None

    @staticmethod
    def _ocr_pdf(file_path: str) -> tuple[list[dict], str]:
        rows = []
        texts = []
        try:
            with pdfplumber.open(file_path) as pdf:
                for page in pdf.pages:
                    page_image = page.to_image(resolution=300).original
                    page_text = pytesseract.image_to_string(page_image) or ""
                    texts.append(page_text)
                    rows.extend(FileParser._parse_delimited_or_line_item_text(page_text))
        except Exception as e:
            logger.warning(f"PDF OCR fallback failed: {e}")
        return rows, "\n".join(texts).strip()

    @staticmethod
    def _parse_po_numeric_lines(text: str) -> list[dict]:
        lines = [ln.strip() for ln in text.splitlines() if ln.strip()]
        rows = []
        line_pattern = re.compile(
            r"^\s*(?P<sl>\d{1,4})\s+"
            r"(?P<due>\d{1,2}[/-]\d{1,2}[/-]\d{2,4})\s+"
            r"(?P<rest>.+)$"
        )

        for line in lines:
            match = line_pattern.match(line)
            if not match:
                continue
            rest_tokens = match.group("rest").split()
            if len(rest_tokens) < 4:
                continue

            qty = ""
            price = ""
            total = ""
            idx = len(rest_tokens) - 1
            nums = []
            while idx >= 0 and len(nums) < 3:
                token = rest_tokens[idx].replace(",", "")
                if _is_number(token):
                    nums.insert(0, token)
                    idx -= 1
                else:
                    break

            if len(nums) == 3:
                qty, price, total = nums
            uom = ""
            if idx >= 0 and re.match(r"^[A-Za-z]{1,8}\.?$", rest_tokens[idx]):
                uom = rest_tokens[idx]
                idx -= 1

            lead = rest_tokens[: idx + 1]
            part = lead[0] if lead else ""
            desc = " ".join(lead[1:]) if len(lead) > 1 else ""

            rows.append(
                {
                    "SL No": match.group("sl"),
                    "Due Date": match.group("due"),
                    "Part": part,
                    "Description": desc,
                    "UoM": uom,
                    "Quantity": qty,
                    "Unit Price": price,
                    "Total Price": total,
                }
            )
        return rows

    @staticmethod
    def parse_excel(file_path: str) -> dict:
        ext = os.path.splitext(file_path)[1].lower()
        engine = "xlrd" if ext == ".xls" else "openpyxl"
        all_rows = []
        columns = []

        try:
            xls = pd.ExcelFile(file_path, engine=engine)
            for sheet_name in xls.sheet_names:
                df_raw = pd.read_excel(xls, sheet_name=sheet_name, header=None)
                df = FileParser._normalize_excel_table(df_raw)
                if df.empty:
                    continue
                df.columns = FileParser._unique_headers([str(c).strip() for c in df.columns])
                if not columns:
                    columns = df.columns.tolist()
                all_rows.extend(df.fillna("").to_dict(orient="records"))
                logger.info(f"Excel sheet '{sheet_name}': {len(df.columns)} columns, {len(df)} rows")
        except Exception:
            logger.warning(f"Binary Excel parse failed, trying as tab/comma/HTML: {file_path}")
            try:
                df = pd.read_csv(file_path, sep="\t").dropna(how="all")
                if df.empty:
                    df = pd.read_csv(file_path).dropna(how="all")
                df.columns = [str(c).strip() for c in df.columns]
                columns = df.columns.tolist()
                all_rows = df.fillna("").to_dict(orient="records")
            except Exception:
                try:
                    dfs = pd.read_html(file_path)
                    if dfs:
                        df = dfs[0].dropna(how="all")
                        df.columns = [str(c).strip() for c in df.columns]
                        columns = df.columns.tolist()
                        all_rows = df.fillna("").to_dict(orient="records")
                except Exception as e3:
                    logger.error(f"All Excel parse methods failed: {e3}")
                    return {"error": str(e3), "columns": [], "rows": []}

        all_rows = FileParser._sanitize_rows(all_rows)
        logger.info(f"Excel parsed total: {len(columns)} columns, {len(all_rows)} rows")
        return {"columns": columns, "rows": all_rows}

    @staticmethod
    def _normalize_excel_table(df_raw: pd.DataFrame) -> pd.DataFrame:
        if df_raw is None or df_raw.empty:
            return pd.DataFrame()

        df = df_raw.dropna(how="all").copy()
        if df.empty:
            return pd.DataFrame()

        best_idx = None
        best_score = -1.0
        max_scan = min(len(df), 30)

        for i in range(max_scan):
            row = df.iloc[i].tolist()
            cells = [FileParser._clean_cell(v) for v in row]
            non_empty = [c for c in cells if c]
            if len(non_empty) < 3:
                continue

            unnamed_like = sum(1 for c in non_empty if c.lower().startswith("unnamed"))
            alpha_like = sum(1 for c in non_empty if re.search(r"[A-Za-z]", c))
            keyword_hits = sum(
                1
                for c in non_empty
                if re.search(r"\b(item|part|material|description|qty|quantity|uom|unit|date|po|order|vendor|supplier)\b", c, re.I)
            )
            diversity = len(set(c.lower() for c in non_empty))
            score = (
                min(len(non_empty), 20) * 0.6
                + alpha_like * 0.2
                + keyword_hits * 2.0
                + diversity * 0.15
                - unnamed_like * 1.5
            )
            if score > best_score:
                best_score = score
                best_idx = i

        if best_idx is None:
            # Fallback: first row as header.
            header = [FileParser._clean_cell(v) or f"Column_{idx+1}" for idx, v in enumerate(df.iloc[0].tolist())]
            body = df.iloc[1:].copy()
        else:
            header = [FileParser._clean_cell(v) or f"Column_{idx+1}" for idx, v in enumerate(df.iloc[best_idx].tolist())]
            body = df.iloc[best_idx + 1 :].copy()

        if body.empty:
            return pd.DataFrame()

        body.columns = header
        body = body.dropna(how="all")
        # Drop rows that are effectively empty/noise across the detected headers.
        keep_mask = []
        for _, row in body.iterrows():
            vals = [FileParser._clean_cell(v) for v in row.tolist()]
            non_empty = [v for v in vals if v]
            keep_mask.append(len(non_empty) >= 2)
        if keep_mask:
            body = body.loc[keep_mask]
        return body.reset_index(drop=True)

    @staticmethod
    def parse_csv(file_path: str) -> dict:
        df = pd.read_csv(file_path)
        df = df.dropna(how="all")
        df.columns = [str(c).strip() for c in df.columns]
        columns = df.columns.tolist()
        rows = df.fillna("").to_dict(orient="records")
        rows = FileParser._sanitize_rows(rows)
        logger.info(f"CSV parsed: {len(columns)} columns, {len(rows)} rows")
        return {"columns": columns, "rows": rows}

    @staticmethod
    def parse_text(file_path: str) -> dict:
        with open(file_path, encoding="utf-8", errors="replace") as f:
            text = f.read()
        rows = FileParser._parse_delimited_or_line_item_text(text)
        if rows:
            return {
                "columns": list(rows[0].keys()),
                "rows": rows,
                "raw_text": text,
                "_debug": {"selected_strategy": "text_structured", "row_count": len(rows)},
            }
        lines = [line.strip() for line in text.splitlines() if line.strip()]
        if lines:
            rows = [{"email_text": line} for line in lines]
            return {
                "columns": ["email_text"],
                "rows": rows,
                "raw_text": text,
                "_debug": {"selected_strategy": "text_lines", "row_count": len(rows)},
            }
        return {"raw_text": text, "columns": [], "rows": [], "_debug": {"selected_strategy": "text_empty", "row_count": 0}}

    @staticmethod
    def parse_image(file_path: str) -> dict:
        image = Image.open(file_path)
        text = pytesseract.image_to_string(image)
        rows = FileParser._parse_delimited_or_line_item_text(text)
        if rows:
            return {"columns": list(rows[0].keys()), "rows": rows, "raw_text": text}
        lines = [line.strip() for line in text.split("\n") if line.strip()]
        rows = [{"ocr_text": line} for line in lines]
        return {"columns": ["ocr_text"] if rows else [], "rows": rows, "raw_text": text}

    @staticmethod
    def _sanitize_rows(rows: list[dict]) -> list[dict]:
        sanitized = []
        for row in rows:
            clean = {}
            for k, v in row.items():
                if isinstance(v, pd.Timestamp):
                    clean[k] = v.strftime("%Y-%m-%d") if not pd.isna(v) else ""
                elif isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    clean[k] = ""
                elif hasattr(v, "isoformat"):
                    clean[k] = v.isoformat()
                else:
                    clean[k] = v
            sanitized.append(clean)
        return sanitized

    @staticmethod
    def _unique_headers(headers: list[str]) -> list[str]:
        seen = {}
        out = []
        for raw in headers:
            key = re.sub(r"\s+", " ", (raw or "").replace("\n", " ").strip()) or "Column"
            count = seen.get(key, 0)
            seen[key] = count + 1
            out.append(key if count == 0 else f"{key}_{count}")
        return out

    @staticmethod
    def _strategy_stat(name: str, rows: list[dict]) -> dict:
        row_count = len(rows or [])
        score = FileParser._score_rows(rows or [])
        return {"strategy": name, "row_count": row_count, "score": score}

    @staticmethod
    def _score_rows(rows: list[dict]) -> float:
        if not rows:
            return 0.0
        headers = [h.lower() for h in rows[0].keys()]
        header_score = 0.0
        for key in ("part", "customer part", "quantity", "qty", "po", "price", "date", "description"):
            if any(key in h for h in headers):
                header_score += 1.0
        header_score = min(header_score, 6.0)
        generic_header_penalty = sum(1 for h in headers if h.startswith("column")) * 0.35
        noisy_header_penalty = 0.8 if any("vendor information" in h for h in headers) else 0.0
        weak_header_pairs = {("number", "version"), ("purchase", "order")}
        pair_penalty = 2.5 if tuple(headers) in weak_header_pairs else 0.0

        sample = rows[: min(25, len(rows))]
        value_score = 0.0
        filled = 0
        non_numeric_lines = 0
        for row in sample:
            values = [str(v).strip() for v in row.values() if str(v).strip()]
            if values:
                filled += 1
            if any(_is_number(v) for v in values):
                value_score += 0.5
            if any(re.match(r"^\d{1,2}[-/]\d{1,2}[-/]\d{2,4}$", v) for v in values):
                value_score += 0.5
            if values and all(not _is_number(v) and not re.search(r"\d{1,2}[-/]\d{1,2}[-/]\d{2,4}", v) for v in values):
                non_numeric_lines += 1
        density_score = (filled / len(sample)) * 2.0 if sample else 0.0
        repetition_penalty = FileParser._repetition_penalty(rows)
        text_heavy_penalty = (non_numeric_lines / len(sample)) * 1.5 if sample else 0.0
        return (
            header_score
            + value_score
            + density_score
            + min(len(rows), 200) / 50.0
            - generic_header_penalty
            - noisy_header_penalty
            - pair_penalty
            - repetition_penalty
            - text_heavy_penalty
        )

    @staticmethod
    def _repetition_penalty(rows: list[dict]) -> float:
        sample = rows[: min(80, len(rows))]
        if not sample:
            return 0.0
        normalized = []
        for row in sample:
            parts = []
            for value in row.values():
                s = str(value).strip().lower()
                s = re.sub(r"\s+", " ", s)
                parts.append(s)
            normalized.append("|".join(parts))
        unique = len(set(normalized))
        dup_ratio = 1.0 - (unique / len(normalized))
        return max(0.0, (dup_ratio - 0.10) * 3.0)

    @staticmethod
    def _is_low_quality_layout(rows: list[dict]) -> bool:
        if not rows:
            return True
        headers = [h.lower().strip() for h in rows[0].keys()]
        if tuple(headers) in {("number", "version"), ("purchase", "order")}:
            return True
        if any(h.startswith("column") for h in headers):
            return True
        if not FileParser._looks_like_business_headers(headers):
            return True

        weak_markers = ("vendor information", "purchase", "order", "copy-no", "transmit")
        if len(headers) == 2 and all(any(marker in h for marker in weak_markers) for h in headers):
            return True

        non_alnum_heavy = sum(1 for h in headers if len(re.sub(r"[a-z0-9 ]", "", h)) >= 2)
        tiny_or_noise = sum(1 for h in headers if len(h.strip()) <= 2 or "*" in h)
        if non_alnum_heavy >= max(1, len(headers) // 2):
            return True
        if tiny_or_noise >= max(1, len(headers) // 2):
            return True

        # If both columns are mostly long free text values, this is likely not tabular demand data.
        sample = rows[: min(30, len(rows))]
        long_cell_ratio = 0.0
        total_cells = 0
        long_cells = 0
        for row in sample:
            for val in row.values():
                s = str(val).strip()
                if not s:
                    continue
                total_cells += 1
                if len(s) > 28:
                    long_cells += 1
        if total_cells:
            long_cell_ratio = long_cells / total_cells
        if long_cell_ratio > 0.45:
            return True

        # For 3+ columns, reject when most rows look like sentence fragments, not tabular records.
        if len(headers) >= 3:
            sentence_like = 0
            for row in sample:
                vals = [str(v).strip() for v in row.values() if str(v).strip()]
                if not vals:
                    continue
                joined = " ".join(vals)
                if len(joined) > 50 and not re.search(r"\b\d+(?:\.\d+)?\b", joined):
                    sentence_like += 1
            if sample and (sentence_like / len(sample)) > 0.35:
                return True
        return False

    @staticmethod
    def _looks_like_business_headers(headers: list[str]) -> bool:
        business_terms = ("part", "customer", "quantity", "qty", "po", "price", "amount", "date", "description", "uom", "material")
        return any(any(term in h for term in business_terms) for h in headers)

    @staticmethod
    def _has_richer_schema(rows: list[dict]) -> bool:
        if not rows:
            return False
        headers = [h.lower().strip() for h in rows[0].keys()]
        if len(headers) >= 4:
            return True
        if len(headers) < 3:
            return False
        return FileParser._looks_like_business_headers(headers)


def _is_number(value: str) -> bool:
    try:
        float(str(value).replace(",", ""))
        return True
    except (TypeError, ValueError):
        return False
