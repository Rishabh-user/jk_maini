from datetime import datetime, timezone

from fastapi import APIRouter, Depends, HTTPException
from pydantic import BaseModel, Field
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.data import ForexRate
from app.models.user import User, UserRole
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/forex", tags=["Forex Rates"])


class ForexRateCreate(BaseModel):
    currency_from: str = Field(..., description="Source currency, e.g. 'USD'")
    currency_to: str = Field("INR", description="Target currency, default INR")
    rate: float = Field(..., gt=0, description="Exchange rate (1 unit of currency_from = rate units of currency_to)")
    effective_date: datetime = Field(..., description="Date from which this rate is effective")
    notes: str | None = Field(None, description="Optional note, e.g. 'April 2026 rate approved by finance'")


class ForexRateResponse(BaseModel):
    id: int
    currency_from: str
    currency_to: str
    rate: float
    effective_date: datetime
    notes: str | None
    created_at: datetime
    entered_by: int

    class Config:
        from_attributes = True


@router.get("/", response_model=list[ForexRateResponse])
async def list_forex_rates(
    currency_from: str | None = None,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all forex rates, optionally filtered by source currency."""
    query = select(ForexRate).order_by(ForexRate.effective_date.desc())
    if currency_from:
        query = query.where(ForexRate.currency_from == currency_from.upper())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/current", response_model=dict)
async def get_current_rates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the latest active rate for every currency → INR."""
    result = await db.execute(
        select(ForexRate).order_by(ForexRate.currency_from, ForexRate.effective_date.desc())
    )
    all_rates = result.scalars().all()

    # Keep only the most recent rate per currency pair
    seen: set[tuple] = set()
    current_rates: dict[str, dict] = {}
    for r in all_rates:
        key = (r.currency_from, r.currency_to)
        if key not in seen:
            seen.add(key)
            current_rates[r.currency_from] = {
                "rate": r.rate,
                "currency_to": r.currency_to,
                "effective_date": r.effective_date.isoformat(),
                "notes": r.notes,
                "id": r.id,
            }

    return current_rates


@router.post("/", response_model=ForexRateResponse, status_code=201)
async def add_forex_rate(
    data: ForexRateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Add a new forex rate entry. Finance team enters this periodically."""
    rate = ForexRate(
        currency_from=data.currency_from.upper().strip(),
        currency_to=data.currency_to.upper().strip(),
        rate=data.rate,
        effective_date=data.effective_date,
        notes=data.notes,
        entered_by=current_user.id,
    )
    db.add(rate)
    await db.flush()
    logger.info(
        f"Forex rate added: 1 {rate.currency_from} = {rate.rate} {rate.currency_to} "
        f"effective {rate.effective_date.date()} by user {current_user.email}"
    )
    return rate


@router.delete("/{rate_id}")
async def delete_forex_rate(
    rate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete a forex rate entry (admin only)."""
    result = await db.execute(select(ForexRate).where(ForexRate.id == rate_id))
    rate = result.scalar_one_or_none()
    if not rate:
        raise HTTPException(status_code=404, detail="Forex rate not found")
    await db.delete(rate)
    await db.flush()
    return {"detail": "Deleted"}
