from datetime import datetime
from pydantic import BaseModel

from app.models.email import EmailStatus


class AttachmentResponse(BaseModel):
    id: int
    email_id: int
    filename: str
    content_type: str | None
    file_size: int | None
    created_at: datetime
    # False when nothing was extracted from this file (e.g. an email signature
    # logo). Lets the Raw Data viewer hide decorative images instead of listing
    # them as empty entries. Defaults True so other callers are unaffected.
    has_raw_data: bool = True

    model_config = {"from_attributes": True}


class EmailResponse(BaseModel):
    id: int
    gmail_message_id: str
    subject: str | None
    sender: str | None
    body: str | None
    received_at: datetime | None
    status: EmailStatus
    error_message: str | None
    created_at: datetime
    attachments: list[AttachmentResponse] = []

    model_config = {"from_attributes": True}


class EmailListResponse(BaseModel):
    total: int
    emails: list[EmailResponse]


class ProcessEmailResponse(BaseModel):
    email_id: int
    status: str
    attachments_processed: int
    raw_data_entries: int
    message: str
