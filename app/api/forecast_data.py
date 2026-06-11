"""Forecast Data API.

Manage Maini's internal customer forecast table.

Endpoints:
  GET  /forecast-data/summary          → summary grouped by customer
  GET  /forecast-data/parts?customer=X → per-part schedule for one customer
  POST /forecast-data/upload            → upload forecast Excel (multipart)
  DELETE /forecast-data/{customer_name} → clear all entries for a customer
"""

import os
import tempfile

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.data import ForecastEntry
from app.models.user import User, UserRole
from app.services.forecast_service import (
    get_forecast_parts,
    get_forecast_summary,
    parse_forecast_excel,
    save_forecast_entries,
)
from app.utils.logging import logger
from app.utils.security import get_current_user, require_roles

router = APIRouter(prefix="/forecast-data", tags=["Forecast Data"])


@router.get("/summary")
async def forecast_summary(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return a summary of all forecast data grouped by customer name."""
    return await get_forecast_summary(db)


@router.get("/parts")
async def forecast_parts(
    customer: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Return per-part forecast schedule for a given customer name."""
    return await get_forecast_parts(db, customer)


@router.post("/upload", status_code=201)
async def upload_forecast(
    file: UploadFile = File(...),
    customer_name: str = Form(..., description="Customer name this forecast belongs to (e.g. 'Safran HAL')"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload a Maini forecast Excel file for a specific customer.

    Existing forecast data for that customer is replaced on each upload.
    The file format is: Sl No | Comp. Part Number | <month columns ...>
    """
    if not file.filename:
        raise HTTPException(status_code=400, detail="No file provided")

    ext = os.path.splitext(file.filename)[1].lower()
    if ext not in (".xlsx", ".xls"):
        raise HTTPException(status_code=400, detail="Only .xlsx / .xls files are supported for forecast upload")

    # Save to a temp file for parsing
    with tempfile.NamedTemporaryFile(suffix=ext, delete=False) as tmp:
        content = await file.read()
        tmp.write(content)
        tmp_path = tmp.name

    try:
        entries = parse_forecast_excel(tmp_path, customer_name.strip())
    except ValueError as exc:
        os.unlink(tmp_path)
        raise HTTPException(status_code=422, detail=str(exc))
    finally:
        try:
            os.unlink(tmp_path)
        except OSError:
            pass

    if not entries:
        raise HTTPException(
            status_code=422,
            detail="No forecast data found in file. Check that the file has a 'Part Number' column and month columns with quantities.",
        )

    result = await save_forecast_entries(
        db,
        entries=entries,
        customer_name=customer_name.strip(),
        source_file=file.filename,
        uploaded_by=current_user.id,
    )
    return {
        "detail": f"Forecast uploaded: {result['inserted']} entries for '{result['customer_name']}'",
        "inserted": result["inserted"],
        "customer_name": result["customer_name"],
        "part_count": len({e["part_number"] for e in entries}),
        "period_count": len({e["period"] for e in entries}),
    }


@router.delete("/{customer_name}", status_code=200)
async def delete_forecast(
    customer_name: str,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete all forecast entries for a customer (Admin only)."""
    result = await db.execute(
        select(ForecastEntry).where(
            func.lower(ForecastEntry.customer_name) == customer_name.strip().lower()
        )
    )
    entries = result.scalars().all()
    if not entries:
        raise HTTPException(status_code=404, detail=f"No forecast data found for '{customer_name}'")

    count = len(entries)
    await db.execute(
        delete(ForecastEntry).where(
            func.lower(ForecastEntry.customer_name) == customer_name.strip().lower()
        )
    )
    await db.flush()
    logger.info(f"Deleted {count} forecast entries for '{customer_name}' by user {current_user.email}")
    return {"detail": f"Deleted {count} entries for '{customer_name}'", "deleted": count}
