import os

from fastapi import APIRouter, Depends, HTTPException, Query, UploadFile, File
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.email import Email, EmailStatus, Attachment
from app.models.data import RawData
from app.services.file_parser import FileParser
from app.services.ai_mapping import map_columns_with_ai
from app.utils.config import get_settings
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

settings = get_settings()
router = APIRouter(prefix="/uploads", tags=["Document Upload"])

ALLOWED_EXTENSIONS = {
    "pdf", "xlsx", "xls", "csv",
    "png", "jpg", "jpeg", "tiff", "bmp",
}


def _get_source_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    type_map = {
        "pdf": "pdf", "xlsx": "excel", "xls": "excel", "csv": "csv",
        "png": "image", "jpg": "image", "jpeg": "image",
        "tiff": "image", "bmp": "image",
    }
    return type_map.get(ext, "unknown")


@router.post("/document")
async def upload_document(
    file: UploadFile = File(...),
    process: bool = Query(True, description="Auto-process the file after upload"),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Upload a document manually (PDF, Excel, CSV, Image) and optionally process it."""
    filename = file.filename or "unknown"
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""

    if ext not in ALLOWED_EXTENSIONS:
        raise HTTPException(
            status_code=400,
            detail=f"Unsupported file type: .{ext}. Allowed: {', '.join(sorted(ALLOWED_EXTENSIONS))}",
        )

    content = await file.read()
    if not content:
        raise HTTPException(status_code=400, detail="File is empty")

    # Create a virtual "email" record to keep the same data flow as Gmail imports
    email = Email(
        gmail_message_id=f"manual-upload-{os.urandom(8).hex()}",
        subject=f"Manual Upload: {filename}",
        sender=current_user.email,
        body=f"Manually uploaded document by {current_user.full_name or current_user.email}",
        status=EmailStatus.UNPROCESSED,
    )
    db.add(email)
    await db.flush()

    # Save file to disk
    email_dir = os.path.join(settings.UPLOAD_DIR, str(email.id))
    os.makedirs(email_dir, exist_ok=True)
    file_path = os.path.join(email_dir, filename)
    with open(file_path, "wb") as f:
        f.write(content)

    # Create attachment record
    attachment = Attachment(
        email_id=email.id,
        filename=filename,
        content_type=file.content_type or "application/octet-stream",
        file_path=file_path,
        file_size=len(content),
    )
    db.add(attachment)
    await db.flush()

    logger.info(f"Manual upload: {filename} ({len(content)} bytes) by {current_user.email}")

    result = {
        "email_id": email.id,
        "attachment_id": attachment.id,
        "filename": filename,
        "file_size": len(content),
        "source_type": _get_source_type(filename),
        "status": "uploaded",
    }

    # Auto-process if requested
    if process:
        try:
            extracted = FileParser.parse(file_path, file.content_type)
            columns = extracted.get("columns", [])

            column_mapping = {}
            mapped_data = extracted.get("rows", [])

            if columns:
                column_mapping = await map_columns_with_ai(columns)
                mapped_data = []
                for row in extracted.get("rows", []):
                    mapped_row = {}
                    for src_col, value in row.items():
                        target_col = column_mapping.get(src_col, src_col)
                        if target_col != "UNMAPPED":
                            mapped_row[target_col] = value
                    mapped_data.append(mapped_row)

            raw = RawData(
                attachment_id=attachment.id,
                extracted_data=extracted,
                column_mapping=column_mapping,
                mapped_data=mapped_data,
                source_type=_get_source_type(filename),
            )
            db.add(raw)
            await db.flush()

            email.status = EmailStatus.PROCESSED
            await db.flush()

            result["status"] = "processed"
            result["rows_extracted"] = len(extracted.get("rows", []))
            result["columns"] = columns
            result["column_mapping"] = column_mapping
            result["raw_data_id"] = raw.id

            logger.info(f"Auto-processed: {filename} — {len(extracted.get('rows', []))} rows, {len(columns)} columns")

        except Exception as e:
            email.status = EmailStatus.FAILED
            email.error_message = str(e)
            await db.flush()
            result["status"] = "upload_ok_process_failed"
            result["error"] = str(e)
            logger.error(f"Auto-process failed for {filename}: {e}")

    return result


@router.post("/document/{upload_id}/process")
async def process_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    """Process a previously uploaded document that wasn't auto-processed."""
    email_result = await db.execute(select(Email).where(Email.id == upload_id))
    email = email_result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Upload not found")

    if email.status == EmailStatus.PROCESSED:
        return {"status": "already_processed", "email_id": email.id}

    att_result = await db.execute(select(Attachment).where(Attachment.email_id == email.id))
    attachments = att_result.scalars().all()

    if not attachments:
        raise HTTPException(status_code=404, detail="No attachments found for this upload")

    email.status = EmailStatus.PROCESSING
    await db.flush()

    total_rows = 0
    raw_ids = []

    try:
        for attachment in attachments:
            extracted = FileParser.parse(attachment.file_path, attachment.content_type)
            columns = extracted.get("columns", [])

            column_mapping = {}
            mapped_data = extracted.get("rows", [])

            if columns:
                column_mapping = await map_columns_with_ai(columns)
                mapped_data = []
                for row in extracted.get("rows", []):
                    mapped_row = {}
                    for src_col, value in row.items():
                        target_col = column_mapping.get(src_col, src_col)
                        if target_col != "UNMAPPED":
                            mapped_row[target_col] = value
                    mapped_data.append(mapped_row)

            raw = RawData(
                attachment_id=attachment.id,
                extracted_data=extracted,
                column_mapping=column_mapping,
                mapped_data=mapped_data,
                source_type=_get_source_type(attachment.filename),
            )
            db.add(raw)
            await db.flush()

            total_rows += len(extracted.get("rows", []))
            raw_ids.append(raw.id)

        email.status = EmailStatus.PROCESSED
        await db.flush()

        return {
            "status": "processed",
            "email_id": email.id,
            "rows_extracted": total_rows,
            "raw_data_ids": raw_ids,
        }

    except Exception as e:
        email.status = EmailStatus.FAILED
        email.error_message = str(e)
        await db.flush()
        raise HTTPException(status_code=500, detail=f"Processing failed: {e}")


@router.get("/documents")
async def list_uploads(
    skip: int = Query(0, ge=0),
    limit: int = Query(50, ge=1, le=200),
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """List all manually uploaded documents."""
    query = (
        select(Email)
        .where(Email.gmail_message_id.like("manual-upload-%"))
        .order_by(Email.created_at.desc())
        .offset(skip)
        .limit(limit)
    )
    result = await db.execute(query)
    emails = result.scalars().all()

    count_result = await db.execute(
        select(func.count(Email.id)).where(Email.gmail_message_id.like("manual-upload-%"))
    )
    total = count_result.scalar() or 0

    uploads = []
    for email in emails:
        att_result = await db.execute(select(Attachment).where(Attachment.email_id == email.id))
        atts = att_result.scalars().all()

        # Check if raw data exists
        raw_count = 0
        total_rows = 0
        for att in atts:
            raw_result = await db.execute(select(RawData).where(RawData.attachment_id == att.id))
            raws = raw_result.scalars().all()
            raw_count += len(raws)
            for r in raws:
                total_rows += len((r.extracted_data or {}).get("rows", []))

        uploads.append({
            "id": email.id,
            "filename": atts[0].filename if atts else "Unknown",
            "file_size": atts[0].file_size if atts else 0,
            "source_type": _get_source_type(atts[0].filename) if atts else "unknown",
            "status": email.status.value if hasattr(email.status, 'value') else str(email.status),
            "rows_extracted": total_rows,
            "uploaded_by": email.sender,
            "error_message": email.error_message,
            "created_at": email.created_at.isoformat() if email.created_at else None,
            "attachment_id": atts[0].id if atts else None,
        })

    return {"total": total, "uploads": uploads}


@router.delete("/document/{upload_id}")
async def delete_upload(
    upload_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN)),
):
    """Delete a manually uploaded document."""
    result = await db.execute(select(Email).where(Email.id == upload_id))
    email = result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Upload not found")

    await db.delete(email)
    await db.flush()
    return {"detail": "Upload deleted"}
