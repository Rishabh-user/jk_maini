import io
import os

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

        with pdfplumber.open(file_path) as pdf:
            for page in pdf.pages:
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

            if not columns and not all_rows:
                text = "\n".join(page.extract_text() or "" for page in pdf.pages)
                return {"raw_text": text, "columns": [], "rows": []}

        logger.info(f"PDF parsed: {len(columns)} columns, {len(all_rows)} rows")
        return {"columns": columns, "rows": all_rows}

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
