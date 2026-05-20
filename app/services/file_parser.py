import io
import os
import re

import pandas as pd
import pdfplumber
import pytesseract
from PIL import Image

from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()
pytesseract.pytesseract.tesseract_cmd = settings.TESSERACT_CMD


class FileParser:
    """Extracts structured data from PDF, Excel, CSV, and image files."""

    @staticmethod
    def _sanitize_rows(rows: list[dict]) -> list[dict]:
        """Convert non-JSON-serializable values (Timestamps, NaN, etc.) to strings."""
        import math
        sanitized = []
        for row in rows:
            clean = {}
            for k, v in row.items():
                if isinstance(v, pd.Timestamp):
                    clean[k] = v.strftime("%Y-%m-%d") if not pd.isna(v) else ""
                elif isinstance(v, float) and (math.isnan(v) or math.isinf(v)):
                    clean[k] = ""
                elif hasattr(v, 'isoformat'):
                    clean[k] = v.isoformat()
                else:
                    clean[k] = v
            sanitized.append(clean)
        return sanitized

    @staticmethod
    def parse(file_path: str, content_type: str | None = None) -> dict:
        ext = os.path.splitext(file_path)[1].lower()
        logger.info(f"Parsing file: {file_path} (ext={ext}, content_type={content_type})")

        if ext == ".pdf":
            return FileParser.parse_pdf(file_path)
        elif ext in (".xlsx", ".xls"):
            return FileParser.parse_excel(file_path)
        elif ext == ".csv":
            return FileParser.parse_csv(file_path)
        elif ext in (".png", ".jpg", ".jpeg", ".tiff", ".bmp"):
            return FileParser.parse_image(file_path)
        else:
            logger.warning(f"Unsupported file type: {ext}")
            return {"error": f"Unsupported file type: {ext}", "columns": [], "rows": []}

    @staticmethod
    def parse_pdf(file_path: str) -> dict:
        all_rows = []
        columns = []

        # --- Attempt 1: pdfplumber table extraction with custom settings ---
        with pdfplumber.open(file_path) as pdf:
            # Try with explicit table settings for better detection
            table_settings = {
                "vertical_strategy": "lines",
                "horizontal_strategy": "lines",
                "snap_tolerance": 5,
                "join_tolerance": 5,
                "edge_min_length": 10,
            }

            for page in pdf.pages:
                # Try with custom settings first, then default
                tables = page.extract_tables(table_settings)
                if not tables:
                    tables = page.extract_tables()

                for table in tables:
                    if not table:
                        continue
                    if not columns and table[0]:
                        columns = [str(c).strip() if c else f"col_{i}" for i, c in enumerate(table[0])]
                    data_rows = table[1:] if not all_rows else table
                    for row in data_rows:
                        if row and any(cell for cell in row):
                            all_rows.append(
                                {columns[i]: (str(cell).strip() if cell else "") for i, cell in enumerate(row) if i < len(columns)}
                            )

        logger.info(f"PDF table extraction: {len(columns)} columns, {len(all_rows)} rows")

        # --- Attempt 2: If table extraction yielded very few rows, try text-based parsing ---
        if len(all_rows) < 5:
            logger.info("Table extraction yielded few rows, trying text-based parsing...")
            text_rows = FileParser._parse_pdf_text(file_path)
            if len(text_rows) > len(all_rows):
                logger.info(f"Text-based parsing found {len(text_rows)} rows (better than {len(all_rows)})")
                if text_rows:
                    columns = list(text_rows[0].keys())
                    all_rows = text_rows

        # --- Attempt 3: If still no data, return raw text ---
        if not columns and not all_rows:
            with pdfplumber.open(file_path) as pdf:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
            return {"raw_text": text, "columns": [], "rows": []}

        logger.info(f"PDF parsed final: {len(columns)} columns, {len(all_rows)} rows")
        return {"columns": columns, "rows": all_rows}

    @staticmethod
    def _parse_pdf_text(file_path: str) -> list[dict]:
        """
        Text-based fallback parser for complex multi-page PO PDFs.

        Correct column structure (from VALEO PO format):
          SL. No | Due Date | Part | Description | Drawing Number | Tax | UOM | Quantity | Unit Price | Total Price

        In the PDF text, each item spans TWO lines:
          Line 1 (data):  1  06/08/2025  338-062-102-0                      Each  30.00  29.26   877.80
          Line 2 (desc):       COMPONENT-TUBE AIR-338-062-003-0

        Some rows also have a Drawing Number between Part and UOM:
          2  06/08/2025  362-177-030-0  DOC00222383  Each  60.00  68.68  4,120.80
               COUPLING
        """
        full_text = ""
        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
                page_text = page.extract_text() or ""
                full_text += page_text + "\n"

        lines = full_text.split("\n")
        rows = []
        current_row = None

        def is_number(s):
            """Check if string looks like a number (with optional commas and decimals)."""
            return bool(re.match(r'^[\d,]+\.?\d*$', s.strip()))

        # Pattern: line starting with SL number + date, then remaining fields
        # Date patterns: DD/MM/YYYY, MM/DD/YYYY, DD-MM-YYYY, etc.
        data_line_pattern = re.compile(
            r'^\s*(\d{1,4})\s+'                              # SL No
            r'(\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4})\s+'     # Due Date
            r'(.+)$'                                          # Rest of line
        )

        # Keywords that indicate header/footer lines to skip
        skip_keywords = [
            'page', 'total', 'subtotal', 'sub total', 'grand total',
            'purchase order', 'po number', 'vendor', 'supplier',
            'delivery', 'payment', 'terms', 'note:', 'remark',
            'authorized', 'signature', 'printed', 'date:',
            'sl no', 'sl.no', 'sl. no', 'due date', 'part number',
            'uom', 'unit price', 'total price', 'quantity', 'amount',
            'description', 'drawing number', 'sr no', 'sr.no', 'tax',
            'currency', 'prepared', 'approved', 'revision', 'issued',
        ]

        for line in lines:
            line = line.strip()
            if not line:
                continue

            # Check if this is a data line (starts with SL number + date)
            match = data_line_pattern.match(line)
            if match:
                sl_no = match.group(1)
                due_date = match.group(2)
                rest = match.group(3).strip()

                # Parse the rest from RIGHT to LEFT:
                # The rightmost 3 number tokens are: Total Price, Unit Price, Quantity
                # Then UOM (a word like Each/Nos/Kg/Pcs)
                # Then optionally Drawing Number
                # Then Part number
                tokens = rest.split()

                if len(tokens) >= 4:
                    # Extract numbers from the right
                    total_price = ""
                    unit_price = ""
                    qty = ""
                    uom = ""
                    part = ""
                    drawing_number = ""

                    # Find rightmost 3 numbers
                    right_idx = len(tokens) - 1
                    number_fields = []

                    while right_idx >= 0 and len(number_fields) < 3:
                        if is_number(tokens[right_idx]):
                            number_fields.insert(0, tokens[right_idx])
                            right_idx -= 1
                        else:
                            break

                    if len(number_fields) == 3:
                        qty = number_fields[0].replace(",", "")
                        unit_price = number_fields[1].replace(",", "")
                        total_price = number_fields[2].replace(",", "")

                        # Next token to the left should be UOM (a word)
                        remaining = tokens[:right_idx + 1]

                        if remaining:
                            # Check if last remaining token is UOM (alphabetic word)
                            potential_uom = remaining[-1]
                            if re.match(r'^[A-Za-z]+\.?$', potential_uom):
                                uom = potential_uom
                                remaining = remaining[:-1]

                        # Skip Tax field if present (usually empty or "0")
                        # In text extraction, tax "0" might appear as a token
                        if remaining and remaining[-1] in ("0", "0.00", "0.0"):
                            remaining = remaining[:-1]

                        # Now remaining = Part [Drawing Number]
                        # Part is typically the first token (like 338-062-102-0)
                        # Drawing Number is anything after Part (like DOC00222383 or 649-481-103/154 0)
                        if remaining:
                            part = remaining[0]
                            if len(remaining) > 1:
                                drawing_number = " ".join(remaining[1:])
                            else:
                                drawing_number = ""

                        current_row = {
                            "SL No": sl_no,
                            "Due Date": due_date,
                            "Part": part.strip(),
                            "Description": "",
                            "Drawing Number": drawing_number.strip(),
                            "Tax": "",
                            "UOM": uom.strip(),
                            "Quantity": qty,
                            "Unit Price": unit_price,
                            "Total Price": total_price,
                        }
                        rows.append(current_row)
                        continue

                # If we couldn't parse the numbers, still save what we can
                current_row = {
                    "SL No": sl_no,
                    "Due Date": due_date,
                    "Part": tokens[0] if tokens else "",
                    "Description": "",
                    "Drawing Number": " ".join(tokens[1:]) if len(tokens) > 1 else "",
                    "Tax": "",
                    "UOM": "",
                    "Quantity": "",
                    "Unit Price": "",
                    "Total Price": "",
                }
                rows.append(current_row)
                continue

            # If no data pattern matched, this might be a description line for the previous row
            if current_row and not re.match(r'^\s*\d{1,4}\s+\d{1,2}[/\-\.]', line):
                line_lower = line.lower().strip()
                # Skip header/footer lines
                if any(kw in line_lower for kw in skip_keywords):
                    continue
                # Skip lines that are too long (likely paragraphs/notes)
                if len(line) > 200:
                    continue
                # Skip lines that look like page numbers or dates only
                if re.match(r'^\d+$', line) or re.match(r'^\d{1,2}[/\-\.]\d{1,2}[/\-\.]\d{2,4}$', line):
                    continue

                # Append as description to the current row
                existing = current_row.get("Description", "")
                current_row["Description"] = (existing + " " + line).strip() if existing else line

        logger.info(f"PDF text-based parsing found {len(rows)} rows")
        return rows

    @staticmethod
    def parse_excel(file_path: str) -> dict:
        ext = os.path.splitext(file_path)[1].lower()
        engine = "xlrd" if ext == ".xls" else "openpyxl"
        # Try all sheets — some XLS files have data in non-default sheets
        all_rows = []
        columns = []
        try:
            xls = pd.ExcelFile(file_path, engine=engine)
            for sheet_name in xls.sheet_names:
                df = pd.read_excel(xls, sheet_name=sheet_name)
                df = df.dropna(how="all")
                if df.empty:
                    continue
                df.columns = [str(c).strip() for c in df.columns]
                if not columns:
                    columns = df.columns.tolist()
                rows = df.fillna("").to_dict(orient="records")
                all_rows.extend(rows)
                logger.info(f"Excel sheet '{sheet_name}': {len(df.columns)} columns, {len(rows)} rows")
        except Exception:
            # Many .xls files are actually TSV/CSV/HTML saved with .xls extension
            logger.warning(f"Binary Excel parse failed, trying as tab-separated text: {file_path}")
            try:
                df = pd.read_csv(file_path, sep="\t")
                df = df.dropna(how="all")
                if df.empty:
                    # Try comma-separated
                    df = pd.read_csv(file_path)
                    df = df.dropna(how="all")
                df.columns = [str(c).strip() for c in df.columns]
                columns = df.columns.tolist()
                all_rows = df.fillna("").to_dict(orient="records")
                logger.info(f"Parsed as TSV/CSV: {len(columns)} columns, {len(all_rows)} rows")
            except Exception:
                # Try as HTML table (Excel web export)
                try:
                    dfs = pd.read_html(file_path)
                    if dfs:
                        df = dfs[0].dropna(how="all")
                        df.columns = [str(c).strip() for c in df.columns]
                        columns = df.columns.tolist()
                        all_rows = df.fillna("").to_dict(orient="records")
                        logger.info(f"Parsed as HTML table: {len(columns)} columns, {len(all_rows)} rows")
                except Exception as e3:
                    logger.error(f"All Excel parse methods failed: {e3}")
                    return {"error": str(e3), "columns": [], "rows": []}

        all_rows = FileParser._sanitize_rows(all_rows)
        logger.info(f"Excel parsed total: {len(columns)} columns, {len(all_rows)} rows")
        return {"columns": columns, "rows": all_rows}

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
    def parse_image(file_path: str) -> dict:
        image = Image.open(file_path)
        text = pytesseract.image_to_string(image)
        lines = [line.strip() for line in text.split("\n") if line.strip()]

        rows = []
        columns = []
        for i, line in enumerate(lines):
            parts = [p.strip() for p in line.split("|") if p.strip()]
            if not parts:
                parts = [p.strip() for p in line.split("\t") if p.strip()]
            if i == 0 and len(parts) > 1:
                columns = parts
            elif columns and len(parts) == len(columns):
                rows.append({columns[j]: parts[j] for j in range(len(columns))})

        logger.info(f"Image OCR parsed: {len(columns)} columns, {len(rows)} rows")
        return {"columns": columns, "rows": rows, "raw_text": text}
