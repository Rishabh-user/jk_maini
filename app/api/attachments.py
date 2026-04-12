from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User
from app.models.email import Attachment
from app.models.data import RawData
from app.schemas.email import AttachmentResponse
from app.schemas.data import RawDataResponse
from app.utils.security import get_current_user

router = APIRouter(prefix="/attachments", tags=["Attachments"])


@router.get("/{attachment_id}", response_model=AttachmentResponse)
async def get_attachment(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Attachment).where(Attachment.id == attachment_id))
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")
    return attachment


@router.get("/{attachment_id}/download")
async def download_attachment(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(Attachment).where(Attachment.id == attachment_id))
    attachment = result.scalar_one_or_none()
    if not attachment:
        raise HTTPException(status_code=404, detail="Attachment not found")

    return FileResponse(
        path=attachment.file_path,
        filename=attachment.filename,
        media_type=attachment.content_type or "application/octet-stream",
    )


@router.get("/{attachment_id}/raw-data", response_model=list[RawDataResponse])
async def get_attachment_raw_data(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(RawData).where(RawData.attachment_id == attachment_id))
    return result.scalars().all()
