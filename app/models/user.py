import enum
from datetime import datetime

from sqlalchemy import String, Boolean, DateTime, Enum, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class UserRole(str, enum.Enum):
    ADMIN = "ADMIN"
    KAS = "KAS"
    VIEWER = "VIEWER"


class User(Base):
    __tablename__ = "users"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    full_name: Mapped[str] = mapped_column(String(255), nullable=False)
    hashed_password: Mapped[str] = mapped_column(String(512), nullable=False)
    role: Mapped[UserRole] = mapped_column(Enum(UserRole), default=UserRole.VIEWER, nullable=False)
    is_active: Mapped[bool] = mapped_column(Boolean, default=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    zso_reports: Mapped[list["ZSOReport"]] = relationship(back_populates="created_by_user", lazy="selectin")
