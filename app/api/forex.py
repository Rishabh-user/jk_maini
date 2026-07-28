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


class ForexRateUpdate(BaseModel):
    # currency_from is deliberately NOT editable here — it's the row's
    # identity for "which currency does this rate apply to". To change
    # it, add a new rate instead (keeps history honest: this rate really
    # was for USD, even if you later realize you meant EUR).
    currency_to: str | None = Field(None, description="Target currency")
    rate: float | None = Field(None, gt=0, description="Exchange rate")
    effective_date: datetime | None = Field(None, description="Date from which this rate is effective")
    notes: str | None = Field(None, description="Optional note")


class ForexRateResponse(BaseModel):
    id: int
    currency_from: str
    currency_to: str
    rate: float
    effective_date: datetime
    notes: str | None
    is_active: bool
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
    """List all forex rates, optionally filtered by source currency.

    Ordered with the active rate for each currency always first
    (is_active DESC), then newest-created next — deterministic regardless
    of whether two rows happen to share the same effective_date (the old
    "most recent effective_date wins" ordering had no tie-breaker, so two
    same-date rows could silently swap which one looked "active" between
    requests).
    """
    query = select(ForexRate).order_by(
        ForexRate.currency_from,
        ForexRate.is_active.desc(),
        ForexRate.created_at.desc(),
        ForexRate.id.desc(),
    )
    if currency_from:
        query = query.where(ForexRate.currency_from == currency_from.upper())
    result = await db.execute(query)
    return result.scalars().all()


@router.get("/current", response_model=dict)
async def get_current_rates(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Get the currently ACTIVE rate for every currency → INR (explicit
    is_active flag, not date-recency guesswork)."""
    result = await db.execute(select(ForexRate).where(ForexRate.is_active.is_(True)))
    current_rates: dict[str, dict] = {}
    for r in result.scalars().all():
        current_rates[r.currency_from] = {
            "rate": r.rate,
            "currency_to": r.currency_to,
            "effective_date": r.effective_date.isoformat(),
            "notes": r.notes,
            "id": r.id,
        }
    return current_rates


async def _deactivate_siblings(db: AsyncSession, currency_from: str, except_id: int | None = None) -> None:
    """Set is_active=False on every OTHER row sharing this currency_from.
    Exactly one active row per currency_from is the invariant this whole
    feature exists to enforce."""
    query = select(ForexRate).where(ForexRate.currency_from == currency_from)
    if except_id is not None:
        query = query.where(ForexRate.id != except_id)
    siblings = (await db.execute(query)).scalars().all()
    for s in siblings:
        s.is_active = False


@router.post("/", response_model=ForexRateResponse, status_code=201)
async def add_forex_rate(
    data: ForexRateCreate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Add a new forex rate entry. Finance team enters this periodically.

    The new rate becomes ACTIVE immediately (matches the intuitive
    expectation "the rate I just entered is the one now in effect") —
    every other rate for the same currency_from is deactivated. To keep
    an older rate active instead, use POST /forex/{id}/activate on it
    afterward.
    """
    rate = ForexRate(
        currency_from=data.currency_from.upper().strip(),
        currency_to=data.currency_to.upper().strip(),
        rate=data.rate,
        effective_date=data.effective_date,
        notes=data.notes,
        entered_by=current_user.id,
        is_active=True,
    )
    db.add(rate)
    await db.flush()
    await _deactivate_siblings(db, rate.currency_from, except_id=rate.id)
    await db.flush()
    logger.info(
        f"Forex rate added: 1 {rate.currency_from} = {rate.rate} {rate.currency_to} "
        f"effective {rate.effective_date.date()} by user {current_user.email} (now active)"
    )
    return rate


@router.patch("/{rate_id}", response_model=ForexRateResponse)
async def update_forex_rate(
    rate_id: int,
    data: ForexRateUpdate,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Edit an existing rate in place (correct a typo, adjust the date,
    update notes) without needing to delete and re-add it. Does not
    change which rate is active — use /activate for that."""
    result = await db.execute(select(ForexRate).where(ForexRate.id == rate_id))
    rate = result.scalar_one_or_none()
    if not rate:
        raise HTTPException(status_code=404, detail="Forex rate not found")

    changes = data.model_dump(exclude_unset=True)
    if "currency_to" in changes and changes["currency_to"]:
        changes["currency_to"] = changes["currency_to"].upper().strip()
    for key, value in changes.items():
        setattr(rate, key, value)

    await db.flush()
    logger.info(f"Forex rate {rate_id} updated by {current_user.email}: {list(changes.keys())}")
    return rate


@router.post("/{rate_id}/activate", response_model=ForexRateResponse)
async def activate_forex_rate(
    rate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Switch which rate is active for this currency_from. Deactivates
    every other rate sharing the same currency_from so exactly one stays
    active — this is what ZSO report generation reads."""
    result = await db.execute(select(ForexRate).where(ForexRate.id == rate_id))
    rate = result.scalar_one_or_none()
    if not rate:
        raise HTTPException(status_code=404, detail="Forex rate not found")

    rate.is_active = True
    await db.flush()
    await _deactivate_siblings(db, rate.currency_from, except_id=rate.id)
    await db.flush()
    logger.info(
        f"Forex rate {rate_id} ({rate.currency_from}={rate.rate}) activated by {current_user.email}"
    )
    return rate


@router.delete("/{rate_id}")
async def delete_forex_rate(
    rate_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete a forex rate entry (admin only).

    If the deleted rate was the active one for its currency, the most
    recently created remaining rate for that currency (if any) becomes
    active automatically — otherwise that currency would silently have
    NO active rate and ZSO reports would stop converting it (falling back
    to rate=1.0, i.e. no conversion, with no visible warning).
    """
    result = await db.execute(select(ForexRate).where(ForexRate.id == rate_id))
    rate = result.scalar_one_or_none()
    if not rate:
        raise HTTPException(status_code=404, detail="Forex rate not found")

    was_active = rate.is_active
    currency_from = rate.currency_from
    await db.delete(rate)
    await db.flush()

    if was_active:
        next_best = (await db.execute(
            select(ForexRate)
            .where(ForexRate.currency_from == currency_from)
            .order_by(ForexRate.created_at.desc(), ForexRate.id.desc())
            .limit(1)
        )).scalar_one_or_none()
        if next_best:
            next_best.is_active = True
            await db.flush()
            logger.info(
                f"Forex rate {rate_id} (active) deleted — {next_best.id} "
                f"({currency_from}={next_best.rate}) promoted to active"
            )

    return {"detail": "Deleted"}
