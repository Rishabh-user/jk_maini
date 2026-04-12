from datetime import datetime

from sqlalchemy import String, Text, Integer, Float, DateTime, ForeignKey, JSON, func
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db.session import Base


class RawData(Base):
    __tablename__ = "raw_data"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    attachment_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("attachments.id", ondelete="CASCADE"), index=True
    )
    extracted_data: Mapped[dict | None] = mapped_column(JSON)
    column_mapping: Mapped[dict | None] = mapped_column(JSON)
    mapped_data: Mapped[dict | None] = mapped_column(JSON)
    source_type: Mapped[str | None] = mapped_column(String(50))  # pdf, excel, csv, image
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    attachment: Mapped["Attachment"] = relationship(back_populates="raw_data")


class MainiPart(Base):
    __tablename__ = "maini_parts"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    customer_name: Mapped[str | None] = mapped_column(String(255))
    customer_location: Mapped[str | None] = mapped_column(String(255))
    customer_part_no: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    maini_part_no: Mapped[str | None] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(String(100))
    unit_price: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(10), default="INR")
    hsn_code: Mapped[str | None] = mapped_column(String(50))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ZSOReport(Base):
    __tablename__ = "zso_reports"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    email_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("emails.id"), index=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    report_data: Mapped[dict | None] = mapped_column(JSON)
    kas_name: Mapped[str | None] = mapped_column(String(255))
    total_inr: Mapped[float | None] = mapped_column(Float, default=0.0)
    status: Mapped[str] = mapped_column(String(50), default="draft", index=True)
    export_path: Mapped[str | None] = mapped_column(String(1000))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    created_by_user: Mapped["User"] = relationship(back_populates="zso_reports")


class DemandUpload(Base):
    __tablename__ = "demand_uploads"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    upload_type: Mapped[str] = mapped_column(String(50))  # vmi, safety_stock, sap, manual
    filename: Mapped[str] = mapped_column(String(500))
    parsed_data: Mapped[dict | None] = mapped_column(JSON)
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class InventoryStock(Base):
    __tablename__ = "inventory_stocks"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    stock_type: Mapped[str] = mapped_column(String(50), index=True)  # fg_inhouse, fg_warehouse, wip
    filename: Mapped[str] = mapped_column(String(500))
    parsed_data: Mapped[dict | None] = mapped_column(JSON)  # list of stock rows
    row_count: Mapped[int] = mapped_column(Integer, default=0)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class AllocationResult(Base):
    __tablename__ = "allocation_results"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    zso_report_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("zso_reports.id"), nullable=True)
    allocation_type: Mapped[str] = mapped_column(String(50))  # fg, wip, combined
    result_data: Mapped[dict | None] = mapped_column(JSON)  # list of allocation rows
    summary: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class CoverageReport(Base):
    __tablename__ = "coverage_reports"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    created_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    allocation_id: Mapped[int | None] = mapped_column(Integer, ForeignKey("allocation_results.id"), nullable=True)
    report_data: Mapped[dict | None] = mapped_column(JSON)
    exceptions: Mapped[dict | None] = mapped_column(JSON)
    status: Mapped[str] = mapped_column(String(50), default="generated")
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class SalesData(Base):
    __tablename__ = "sales_data"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(20), index=True)
    filename: Mapped[str] = mapped_column(String(500))
    monthly_data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class BudgetData(Base):
    __tablename__ = "budget_data"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    uploaded_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    fiscal_year: Mapped[str] = mapped_column(String(20), index=True)
    filename: Mapped[str] = mapped_column(String(500))
    monthly_data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
