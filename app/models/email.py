import enum
from datetime import datetime

from sqlalchemy import String, Text, DateTime, Enum, Integer, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class EmailStatus(str, enum.Enum):
    UNPROCESSED = "unprocessed"
    PROCESSING = "processing"
    PROCESSED = "processed"
    FAILED = "failed"


class Email(Base):
    __tablename__ = "emails"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    gmail_message_id: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    subject: Mapped[str | None] = mapped_column(String(1000))
    sender: Mapped[str | None] = mapped_column(String(255), index=True)
    body: Mapped[str | None] = mapped_column(Text)
    received_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    status: Mapped[EmailStatus] = mapped_column(
        Enum(EmailStatus), default=EmailStatus.UNPROCESSED, index=True
    )
    error_message: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    attachments: Mapped[list["Attachment"]] = relationship(back_populates="email", lazy="selectin", cascade="all, delete-orphan")


class Attachment(Base):
    __tablename__ = "attachments"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email_id: Mapped[int] = mapped_column(Integer, ForeignKey("emails.id", ondelete="CASCADE"), index=True)
    filename: Mapped[str] = mapped_column(String(500), nullable=False)
    content_type: Mapped[str | None] = mapped_column(String(255))
    file_path: Mapped[str] = mapped_column(String(1000), nullable=False)
    file_size: Mapped[int | None] = mapped_column(Integer)
    # SHA-256 of the file bytes — lets us detect the same file being re-uploaded.
    file_hash: Mapped[str | None] = mapped_column(String(64), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    email: Mapped["Email"] = relationship(back_populates="attachments")
    raw_data: Mapped[list["RawData"]] = relationship(back_populates="attachment", lazy="selectin", cascade="all, delete-orphan")


class GmailCredential(Base):
    """OAuth token for the single Gmail mailbox this app connects to.

    Stored as a DB row rather than token.json — a file-based token silently
    vanishes on every Render redeploy (the disk doesn't persist), which was
    the recurring cause of "Gmail authentication expired" needing a manual
    fix each time. One row (the app connects exactly one mailbox), upserted
    on every re-authorization and every access-token refresh.
    """
    __tablename__ = "gmail_credentials"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    account_email: Mapped[str | None] = mapped_column(String(255))
    token_data: Mapped[dict] = mapped_column(JSON, nullable=False)
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )
