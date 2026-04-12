import enum
from datetime import datetime

from sqlalchemy import String, Text, DateTime, Enum, Integer, ForeignKey, func
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
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    email: Mapped["Email"] = relationship(back_populates="attachments")
    raw_data: Mapped[list["RawData"]] = relationship(back_populates="attachment", lazy="selectin", cascade="all, delete-orphan")
