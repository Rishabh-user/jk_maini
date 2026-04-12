import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import MainiPart
from app.schemas.data import MainiPartCreate, MainiPartResponse
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/master-data", tags=["Master Data"])


# Column name mapping: maps common Excel header variations to DB field names
COLUMN_MAP = {
    "customer_name": ["customer name", "customer", "cust name", "client name"],
    "customer_location": ["customer location", "location", "cust location", "city"],
    "customer_part_no": ["customer_part_no", "customer part no", "customer part #", "cust part no", "cust part #", "part no", "part number", "customer part number"],
    "maini_part_no": ["maini_part_no", "maini part no", "maini part #", "maini part number", "jk maini part", "maini no"],
    "description": ["description", "desc", "part description", "item description"],
    "country": ["country", "country code", "origin"],
    "unit_price": ["unit_price", "unit price", "price", "rate"],
    "currency": ["currency", "curr", "currency code"],
    "hsn_code": ["hsn_code", "hsn code", "hsn", "hs code"],
}


def _match_column(header: str) -> str | None:
    """Match an Excel column header to a DB field name."""
    h = header.strip().lower()
    for field, variants in COLUMN_MAP.items():
        if h in variants:
            return field
    return None


def _detect_header_row(df: pd.DataFrame) -> pd.DataFrame:
    """Detect if actual headers are in a data row (not row 0) and fix the DataFrame."""
    # Check if current columns look like real headers
    has_real_headers = any(_match_column(str(c)) is not None for c in df.columns)
    if has_real_headers:
        return df

    # Scan first 5 rows to find the header row
    for i in range(min(5, len(df))):
        row_vals = [str(v).strip() for v in df.iloc[i] if pd.notna(v)]
        matches = sum(1 for v in row_vals if _match_column(v) is not None)
        if matches >= 2:
            # Found header row — rebuild DataFrame
            new_headers = [str(v).strip() if pd.notna(v) else f"col_{j}" for j, v in enumerate(df.iloc[i])]
            new_df = df.iloc[i + 1:].copy()
            new_df.columns = new_headers
            new_df = new_df.reset_index(drop=True)
            logger.info(f"Detected header row at index {i}: {new_headers}")
            return new_df

    return df


@router.get("/", response_model=list[MainiPartResponse])
async def list_master_data(
    search: str = Query(None),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(MainiPart).order_by(MainiPart.id)
    if search:
        query = query.where(
            MainiPart.customer_part_no.ilike(f"%{search}%")
            | MainiPart.maini_part_no.ilike(f"%{search}%")
            | MainiPart.description.ilike(f"%{search}%")
        )
    result = await db.execute(query)
    return result.scalars().all()


@router.post("/upload")
async def upload_master_data(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload Excel/CSV file to bulk upsert master data. Matches on customer_part_no — updates existing, inserts new."""
    filename = file.filename or ""
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ("xlsx", "xls", "csv"):
        raise HTTPException(status_code=400, detail="Only .xlsx, .xls, or .csv files are supported")

    content = await file.read()

    try:
        if ext == "csv":
            df = pd.read_csv(io.BytesIO(content))
        else:
            try:
                df = pd.read_excel(io.BytesIO(content), engine="openpyxl" if ext == "xlsx" else "xlrd")
            except Exception:
                # Fallback: tab-separated text disguised as .xls
                df = pd.read_csv(io.BytesIO(content), sep="\t")
    except Exception as e:
        raise HTTPException(status_code=400, detail=f"Failed to parse file: {e}")

    df = df.dropna(how="all")
    if df.empty:
        raise HTTPException(status_code=400, detail="File is empty")

    # Auto-detect header row if headers are not in first row
    df = _detect_header_row(df)
    df = df.dropna(how="all")

    # Map Excel columns to DB fields
    col_mapping = {}
    for col in df.columns:
        matched = _match_column(str(col))
        if matched:
            col_mapping[str(col)] = matched

    if "customer_part_no" not in col_mapping.values():
        raise HTTPException(
            status_code=400,
            detail=f"Could not find a 'Customer Part No' column. Found columns: {list(df.columns)}",
        )

    inserted = 0
    updated = 0

    for _, row in df.iterrows():
        record = {}
        for excel_col, db_field in col_mapping.items():
            val = row.get(excel_col)
            if pd.isna(val):
                val = None
            elif db_field == "unit_price" and val is not None:
                try:
                    val = float(val)
                except (ValueError, TypeError):
                    val = None
            else:
                val = str(val).strip() if val is not None else None
            record[db_field] = val

        cust_part = record.get("customer_part_no")
        if not cust_part:
            continue

        # Check if exists
        result = await db.execute(
            select(MainiPart).where(MainiPart.customer_part_no == cust_part)
        )
        existing = result.scalar_one_or_none()

        if existing:
            # Update existing record
            for field, value in record.items():
                if field != "customer_part_no" and value is not None:
                    setattr(existing, field, value)
            updated += 1
        else:
            # Insert new
            part = MainiPart(**record)
            db.add(part)
            inserted += 1

    await db.flush()
    logger.info(f"Master data upload: {inserted} inserted, {updated} updated from {filename}")
    return {"inserted": inserted, "updated": updated, "total_rows": len(df)}


@router.post("/", response_model=MainiPartResponse, status_code=201)
async def create_master_data(
    data: MainiPartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    existing = await db.execute(
        select(MainiPart).where(MainiPart.customer_part_no == data.customer_part_no)
    )
    if existing.scalar_one_or_none():
        raise HTTPException(status_code=400, detail="Customer part number already exists")

    part = MainiPart(**data.model_dump())
    db.add(part)
    await db.flush()
    return part


@router.get("/{part_id}", response_model=MainiPartResponse)
async def get_master_data(
    part_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(MainiPart).where(MainiPart.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")
    return part


@router.put("/{part_id}", response_model=MainiPartResponse)
async def update_master_data(
    part_id: int,
    data: MainiPartCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    result = await db.execute(select(MainiPart).where(MainiPart.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")

    for key, value in data.model_dump().items():
        setattr(part, key, value)
    await db.flush()
    return part


@router.delete("/{part_id}")
async def delete_master_data(
    part_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    result = await db.execute(select(MainiPart).where(MainiPart.id == part_id))
    part = result.scalar_one_or_none()
    if not part:
        raise HTTPException(status_code=404, detail="Part not found")

    await db.delete(part)
    await db.flush()
    return {"detail": "Deleted"}
