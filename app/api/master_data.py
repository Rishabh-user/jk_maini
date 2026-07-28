import io

import pandas as pd
from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.data import MainiPart
from app.schemas.data import MainiPartCreate, MainiPartResponse, MasterDataListResponse
from app.services.master_data_mapping import (
    UNMAPPED,
    EXACT_ALIASES,
    normalize_header,
    map_master_data_columns,
)
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/master-data", tags=["Master Data"])


def _match_column(header: str) -> str | None:
    """Quick alias-only lookup — used ONLY for header-row auto-detection
    (deciding whether row 0 already looks like real headers), not for the
    actual upload mapping (that goes through the full AI-assisted
    ``map_master_data_columns``, which also catches aliases this table
    doesn't know about yet)."""
    return EXACT_ALIASES.get(normalize_header(header))


def _clean_text_value(value) -> str | None:
    if value is None or pd.isna(value):
        return None
    if isinstance(value, bool):
        return str(value).strip()
    try:
        numeric = float(value)
        if numeric.is_integer() and str(value).strip().replace(".", "", 1).isdigit():
            return str(int(numeric))
    except (TypeError, ValueError):
        pass
    return str(value).strip()


def _detect_header_row(df: pd.DataFrame) -> pd.DataFrame:
    """Detect if actual headers are in a data row (not row 0) and fix the DataFrame."""
    has_real_headers = any(_match_column(str(c)) is not None for c in df.columns)
    if has_real_headers:
        return df

    for i in range(min(5, len(df))):
        row_vals = [str(v).strip() for v in df.iloc[i] if pd.notna(v)]
        matches = sum(1 for v in row_vals if _match_column(v) is not None)
        if matches >= 2:
            new_headers = [str(v).strip() if pd.notna(v) else f"col_{j}" for j, v in enumerate(df.iloc[i])]
            new_df = df.iloc[i + 1:].copy()
            new_df.columns = new_headers
            new_df = new_df.reset_index(drop=True)
            logger.info(f"Detected header row at index {i}: {new_headers}")
            return new_df

    return df


@router.get("/", response_model=MasterDataListResponse)
async def list_master_data(
    search: str = Query(None),
    skip: int = Query(0, ge=0),
    limit: int = Query(25, ge=1, le=500),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Server-side paginated list — only ``limit`` rows are ever sent to the
    client per request (not the whole table), matching the AG Grid page on
    the Master Data screen."""
    query = select(MainiPart)
    count_query = select(func.count()).select_from(MainiPart)
    if search:
        term = f"%{search}%"
        cond = (
            MainiPart.customer_part_no.ilike(term)
            | MainiPart.maini_part_no.ilike(term)
            | MainiPart.description.ilike(term)
            | MainiPart.customer_name.ilike(term)
            | MainiPart.customer_location.ilike(term)
            | MainiPart.country.ilike(term)
        )
        query = query.where(cond)
        count_query = count_query.where(cond)

    total = (await db.execute(count_query)).scalar_one()
    query = query.order_by(MainiPart.id).offset(skip).limit(limit)
    items = (await db.execute(query)).scalars().all()

    # Union of extra_data keys across the WHOLE table (not just this page)
    # so the frontend's AG Grid columns for "extra" fields stay stable as
    # the user pages through — a key that only appears on row 500 still
    # gets a column even while viewing page 1.
    #
    # Postgres JSON doesn't index well for key enumeration at scale, but
    # maini_parts is a low-thousands-row table — a full-table key scan is
    # cheap enough here. If this table ever grows to hundreds of
    # thousands of rows, replace with a materialized/cached key set.
    extra_rows = (
        await db.execute(select(MainiPart.extra_data).where(MainiPart.extra_data.isnot(None)))
    ).scalars().all()
    extra_columns: list[str] = []
    seen = set()
    for ed in extra_rows:
        if not ed:
            continue
        for k in ed.keys():
            if k not in seen:
                seen.add(k)
                extra_columns.append(k)

    return MasterDataListResponse(total=total, items=items, extra_columns=extra_columns)


@router.post("/upload")
async def upload_master_data(
    file: UploadFile = File(...),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload Excel/CSV file to bulk upsert master data. Matches on customer_part_no — updates existing, inserts new.

    Column mapping uses ``map_master_data_columns`` (deterministic alias
    list, then Claude for anything unfamiliar, using both header text and
    sample cell values). Any column that STILL can't be mapped to a known
    field is NOT dropped — it's preserved verbatim in ``extra_data`` so no
    data from the source file is ever lost.
    """
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

    # Sample values per column (up to 5 non-null cells) — passed to the AI
    # mapper so it can use data shape as a secondary signal, per header
    # text alone being ambiguous (e.g. "Ref" could be almost anything).
    sample_values: dict[str, list] = {}
    for col in df.columns:
        vals = df[col].dropna().head(5).tolist()
        sample_values[str(col)] = [_clean_text_value(v) for v in vals]

    column_mapping = await map_master_data_columns(
        [str(c) for c in df.columns], sample_values,
    )

    if "customer_part_no" not in column_mapping.values():
        raise HTTPException(
            status_code=400,
            detail=(
                "Could not find a 'Customer Part No' column (checked aliases and AI "
                f"mapping). Found columns: {list(df.columns)}"
            ),
        )

    inserted = 0
    updated = 0
    # Track which original headers ended up UNMAPPED, purely for the
    # response summary shown in the UI after upload.
    unmapped_headers = sorted({
        col for col, field in column_mapping.items() if field == UNMAPPED
    })

    for _, row in df.iterrows():
        record: dict = {}
        extras: dict = {}
        for excel_col, db_field in column_mapping.items():
            val = row.get(excel_col)
            if pd.isna(val):
                val = None
            elif db_field == "unit_price" and val is not None:
                try:
                    val = float(val)
                except (ValueError, TypeError):
                    val = None
            else:
                val = _clean_text_value(val)

            if db_field == UNMAPPED:
                if val is not None:
                    extras[str(excel_col)] = val
            else:
                record[db_field] = val

        cust_part = record.get("customer_part_no")
        if not cust_part:
            continue

        result = await db.execute(
            select(MainiPart).where(MainiPart.customer_part_no == cust_part)
        )
        existing = result.scalar_one_or_none()

        if existing:
            for field, value in record.items():
                if field != "customer_part_no" and value is not None:
                    setattr(existing, field, value)
            if extras:
                # Merge, don't overwrite — a prior upload's extra columns
                # (e.g. from a different customer file) shouldn't vanish
                # just because this upload didn't include them.
                merged = dict(existing.extra_data or {})
                merged.update(extras)
                existing.extra_data = merged
            updated += 1
        else:
            part = MainiPart(**record, extra_data=extras or None)
            db.add(part)
            inserted += 1

    await db.flush()
    logger.info(
        f"Master data upload: {inserted} inserted, {updated} updated from {filename}. "
        f"Column mapping: {column_mapping}"
    )
    return {
        "inserted": inserted,
        "updated": updated,
        "total_rows": len(df),
        "column_mapping": column_mapping,
        "unmapped_columns": unmapped_headers,
    }


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
