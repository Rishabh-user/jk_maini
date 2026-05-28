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


@router.get("/{attachment_id}/raw-data-debug")
async def get_attachment_raw_data_debug(
    attachment_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(RawData).where(RawData.attachment_id == attachment_id))
    entries = result.scalars().all()
    if not entries:
        return {"attachment_id": attachment_id, "entries": []}

    debug_entries = []
    for entry in entries:
        extracted = entry.extracted_data or {}
        tables = extracted.get("tables") or []
        debug_entries.append(
            {
                "raw_data_id": entry.id,
                "source_type": entry.source_type,
                "row_count": len(extracted.get("rows", []) or []),
                "column_count": len(extracted.get("columns", []) or []),
                "columns_preview": (extracted.get("columns", []) or [])[:15],
                "table_count": len(tables),
                "tables_summary": [
                    {
                        "table_id": t.get("table_id"),
                        "table_type": t.get("table_type"),
                        "page_no": t.get("page_no"),
                        "row_count": len(t.get("rows", []) or []),
                        "columns": (t.get("columns") or [])[:10],
                        "score": t.get("score"),
                    }
                    for t in tables
                ],
                "primary_table_id": extracted.get("primary_table_id"),
                "parse_debug": extracted.get("_debug"),
            }
        )
    return {"attachment_id": attachment_id, "entries": debug_entries}
