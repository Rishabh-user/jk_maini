from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import Email, EmailStatus, Attachment
from app.models.data import RawData
from app.services.file_parser import FileParser
from app.services.ai_mapping import map_columns_with_ai
from app.utils.logging import logger


async def process_email(db: AsyncSession, email_id: int) -> dict:
    """Full pipeline: parse attachments -> AI map columns -> store raw data."""
    result = await db.execute(select(Email).where(Email.id == email_id))
    email = result.scalar_one_or_none()

    if not email:
        raise ValueError(f"Email with id {email_id} not found")

    if email.status == EmailStatus.PROCESSED:
        return {
            "email_id": email.id,
            "status": "already_processed",
            "attachments_processed": 0,
            "raw_data_entries": 0,
            "message": "Email already processed",
        }

    email.status = EmailStatus.PROCESSING
    await db.flush()

    attachments_processed = 0
    raw_data_entries = 0

    try:
        att_result = await db.execute(
            select(Attachment).where(Attachment.email_id == email.id)
        )
        attachments = att_result.scalars().all()

        for attachment in attachments:
            try:
                # Parse the file
                extracted = FileParser.parse(attachment.file_path, attachment.content_type)
                columns = extracted.get("columns", [])

                # AI column mapping
                column_mapping = {}
                mapped_data = extracted.get("rows", [])
                if columns:
                    column_mapping = await map_columns_with_ai(columns)

                    # Apply column mapping to rows
                    mapped_data = []
                    for row in extracted.get("rows", []):
                        mapped_row = {}
                        for src_col, value in row.items():
                            target_col = column_mapping.get(src_col, src_col)
                            if target_col != "UNMAPPED":
                                mapped_row[target_col] = value
                        mapped_data.append(mapped_row)

                # Save raw data
                raw = RawData(
                    attachment_id=attachment.id,
                    extracted_data=extracted,
                    column_mapping=column_mapping,
                    mapped_data=mapped_data,
                    source_type=_get_source_type(attachment.filename),
                )
                db.add(raw)
                raw_data_entries += 1
                attachments_processed += 1
                logger.info(f"Processed attachment: {attachment.filename}")

            except Exception as e:
                logger.error(f"Failed to process attachment {attachment.filename}: {e}")

        email.status = EmailStatus.PROCESSED
        await db.flush()

        return {
            "email_id": email.id,
            "status": "processed",
            "attachments_processed": attachments_processed,
            "raw_data_entries": raw_data_entries,
            "message": f"Successfully processed {attachments_processed} attachments",
        }

    except Exception as e:
        email.status = EmailStatus.FAILED
        email.error_message = str(e)
        await db.flush()
        logger.error(f"Email processing failed: {e}")
        raise


def _get_source_type(filename: str) -> str:
    ext = filename.rsplit(".", 1)[-1].lower() if "." in filename else ""
    type_map = {
        "pdf": "pdf",
        "xlsx": "excel",
        "xls": "excel",
        "csv": "csv",
        "png": "image",
        "jpg": "image",
        "jpeg": "image",
        "tiff": "image",
        "bmp": "image",
    }
    return type_map.get(ext, "unknown")
