from datetime import datetime

from sqlalchemy import String, Text, Integer, Float, Boolean, DateTime, ForeignKey, JSON, func
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
    sold_to_party: Mapped[str | None] = mapped_column(String(255))
    ship_to_party: Mapped[str | None] = mapped_column(String(255))
    customer_part_no: Mapped[str] = mapped_column(String(255), unique=True, index=True, nullable=False)
    maini_part_no: Mapped[str | None] = mapped_column(String(255), index=True)
    description: Mapped[str | None] = mapped_column(Text)
    country: Mapped[str | None] = mapped_column(String(100))
    unit_price: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(10), default="INR")
    incoterm: Mapped[str | None] = mapped_column(String(50))
    hsn_code: Mapped[str | None] = mapped_column(String(50))
    # Any column from an uploaded Excel/CSV that didn't map to one of the
    # fixed fields above (via the AI/alias mapper) lands here instead of
    # being silently dropped — {original_header: cell_value}. Keeps every
    # column from the source file, even ones this schema has no dedicated
    # field for.
    extra_data: Mapped[dict | None] = mapped_column(JSON)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ReportVersion(Base):
    """A version in a report's history chain. Snapshot-preserving: each version
    points to a full ZSOReport; the deltas live in ReportChange. Chains group
    re-uploads of the same logical demand (matched by part-number overlap, so
    adding/removing individual POs stays within the chain as V2/V3…)."""
    __tablename__ = "report_versions"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    demand_doc_key: Mapped[str] = mapped_column(String(128), index=True)   # stable chain id (assigned at V1)
    version_number: Mapped[int] = mapped_column(Integer, default=1)
    # CASCADE: a version IS its ZSOReport snapshot — a version-history entry
    # pointing at a deleted (gone) snapshot has no meaning, so it goes too.
    zso_report_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("zso_reports.id", ondelete="CASCADE"), index=True
    )  # full snapshot
    is_base: Mapped[bool] = mapped_column(Boolean, default=False)
    source: Mapped[str | None] = mapped_column(String(20))                 # manual | email
    source_email_id: Mapped[int | None] = mapped_column(Integer)
    doc_class: Mapped[str | None] = mapped_column(String(20))              # PO | FORECAST
    customer_name: Mapped[str | None] = mapped_column(String(255))
    total_rows: Mapped[int] = mapped_column(Integer, default=0)
    added_rows: Mapped[int] = mapped_column(Integer, default=0)
    removed_rows: Mapped[int] = mapped_column(Integer, default=0)
    modified_rows: Mapped[int] = mapped_column(Integer, default=0)
    unchanged_rows: Mapped[int] = mapped_column(Integer, default=0)
    created_by: Mapped[int | None] = mapped_column(Integer)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ReportChange(Base):
    """One field-level delta between a version and the previous version."""
    __tablename__ = "report_changes"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    # CASCADE: a change-log row is a child record of its version — no
    # meaning once the version it describes is gone.
    version_id: Mapped[int] = mapped_column(
        Integer, ForeignKey("report_versions.id", ondelete="CASCADE"), index=True
    )
    row_key: Mapped[str | None] = mapped_column(String(255), index=True)   # row_id / line identity
    cust_part_no: Mapped[str | None] = mapped_column(String(255))
    po_number: Mapped[str | None] = mapped_column(String(120))
    change_type: Mapped[str] = mapped_column(String(20))                   # added | removed | modified
    field_name: Mapped[str | None] = mapped_column(String(60))             # null for added/removed
    old_value: Mapped[str | None] = mapped_column(Text)
    new_value: Mapped[str | None] = mapped_column(Text)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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


class DemandLine(Base):
    """Canonical ledger of unique demand lines — the deduplication + version store.

    Each real demand line (PO line, or a forecast part-period) is registered here
    keyed by its business IDENTITY (line_key). A second fingerprint (content_hash)
    includes the quantity so we can tell an exact duplicate from a revision:
      - new line_key            → new demand line (version 1, status 'current')
      - same line_key + hash    → exact DUPLICATE (from a different source) → logged, not re-added
      - same line_key, new hash → REVISION → old row marked 'superseded', new row 'current' (version++)
    Superseded rows are retained for audit / version history.
    """
    __tablename__ = "demand_lines"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    line_key: Mapped[str] = mapped_column(String(128), index=True)      # identity fingerprint
    content_hash: Mapped[str] = mapped_column(String(128), index=True)  # identity + qty (+ price)

    # Business fields (denormalized for display / audit)
    po_number: Mapped[str | None] = mapped_column(String(120))
    po_line: Mapped[str | None] = mapped_column(String(60))
    cust_part_no: Mapped[str | None] = mapped_column(String(255), index=True)
    maini_part_no: Mapped[str | None] = mapped_column(String(255))
    customer_name: Mapped[str | None] = mapped_column(String(255))
    delivery_date: Mapped[str | None] = mapped_column(String(60))
    period: Mapped[str | None] = mapped_column(String(60))              # forecast bucket, if any
    quantity: Mapped[float | None] = mapped_column(Float)
    unit_price: Mapped[float | None] = mapped_column(Float)
    currency: Mapped[str | None] = mapped_column(String(10))
    is_forecast: Mapped[bool] = mapped_column(Boolean, default=False)

    # Version / dedup bookkeeping
    version: Mapped[int] = mapped_column(Integer, default=1)
    status: Mapped[str] = mapped_column(String(20), default="current", index=True)  # current | superseded
    superseded_by_id: Mapped[int | None] = mapped_column(Integer)
    duplicate_count: Mapped[int] = mapped_column(Integer, default=0)     # times this exact line re-arrived
    source_email_id: Mapped[int | None] = mapped_column(Integer, index=True)  # source of demand (for idempotency)
    also_seen_in: Mapped[list | None] = mapped_column(JSON)              # provenance of duplicate sources

    first_seen_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class DemandFollowUp(Base):
    """Audit trail for abrupt demand changes flagged during version comparison.

    When a part's quantity changes sharply between two report versions, the KAS
    logs a follow-up (e.g. "confirmed with customer") here. Provides the audit
    trail required by the MoM versioning point.
    """
    __tablename__ = "demand_followups"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    current_report_id: Mapped[int] = mapped_column(Integer, index=True)
    previous_report_id: Mapped[int] = mapped_column(Integer, index=True)
    row_id: Mapped[str | None] = mapped_column(String(255), index=True)   # the changed line row_id
    part: Mapped[str | None] = mapped_column(String(255))
    customer: Mapped[str | None] = mapped_column(String(255))
    change_type: Mapped[str | None] = mapped_column(String(50))           # increase/decrease/new/removed
    prev_qty: Mapped[float | None] = mapped_column(Float)
    curr_qty: Mapped[float | None] = mapped_column(Float)
    note: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(20), default="open")       # open / done
    created_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )


class ForecastEntry(Base):
    """Internal forecast data uploaded by Maini (e.g. Safran HAL Maini Forecast).

    Each row represents one part × one period (month) with its forecast quantity.
    The linking key to ZSO / master data is customer_part_no (= Comp. Part Number in the file).
    """
    __tablename__ = "forecast_entries"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    customer_name: Mapped[str] = mapped_column(String(255), index=True)       # e.g. "Safran HAL"
    part_number: Mapped[str] = mapped_column(String(255), index=True)         # Customer part # (Comp. Part Number)
    period: Mapped[str] = mapped_column(String(30))                            # e.g. "Nov-2025"
    period_date: Mapped[datetime | None] = mapped_column(DateTime)             # parsed first day of month for sorting
    quantity: Mapped[float] = mapped_column(Float, default=0.0)
    source_file: Mapped[str | None] = mapped_column(String(500))
    uploaded_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    uploaded_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


class ForexRate(Base):
    """Manually entered exchange rates used for INR conversion in ZSO reports.

    Finance team enters rates periodically (e.g., monthly). Exactly ONE row
    per currency_from is the active one at any time (enforced in
    app/api/forex.py, not at the DB constraint level — SQLite/Postgres
    partial-unique-index support varies and the app-level check is simple
    enough). That row's rate is what ZSO report generation uses; the rate
    and its entry date are stamped on every ZSO report for transparency.

    is_active replaces an earlier "most recent effective_date wins"
    scheme — that broke down when two rows shared the same effective_date
    (their relative order was whatever Postgres felt like on a given
    query, since there was no secondary sort key), so which rate a report
    used could silently flip between generations. is_active is an
    explicit, user-controlled flag instead.
    """
    __tablename__ = "forex_rates"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    currency_from: Mapped[str] = mapped_column(String(10), nullable=False, index=True)  # e.g. "USD"
    currency_to: Mapped[str] = mapped_column(String(10), nullable=False, default="INR")
    rate: Mapped[float] = mapped_column(Float, nullable=False)                           # e.g. 84.5
    effective_date: Mapped[datetime] = mapped_column(DateTime(timezone=True), nullable=False)
    entered_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    notes: Mapped[str | None] = mapped_column(String(500))
    is_active: Mapped[bool] = mapped_column(Boolean, default=True, nullable=False, index=True)
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())


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
    # SET NULL: an allocation result is an independent downstream artifact
    # that only references a report for context — deleting the report
    # shouldn't destroy allocation history, just sever the now-dangling link.
    zso_report_id: Mapped[int | None] = mapped_column(
        Integer, ForeignKey("zso_reports.id", ondelete="SET NULL"), nullable=True
    )
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


class MasterDataCorrection(Base):
    """Correction requests for master data fields submitted by KAS / admin.

    Workflow: KAS submits a request → Admin approves or rejects.
    On approval the corresponding MainiPart record is automatically updated.
    """
    __tablename__ = "master_data_corrections"

    id: Mapped[int] = mapped_column(primary_key=True, index=True)
    customer_part_no: Mapped[str] = mapped_column(String(255), index=True)
    customer_name: Mapped[str | None] = mapped_column(String(255))
    field_name: Mapped[str] = mapped_column(String(100))   # e.g. "maini_part_no", "unit_price", "description"
    old_value: Mapped[str | None] = mapped_column(String(500))
    new_value: Mapped[str] = mapped_column(String(500))
    reason: Mapped[str | None] = mapped_column(Text)
    status: Mapped[str] = mapped_column(String(50), default="pending", index=True)  # pending | approved | rejected
    requested_by: Mapped[int] = mapped_column(Integer, ForeignKey("users.id"), index=True)
    reviewed_by: Mapped[int | None] = mapped_column(Integer, ForeignKey("users.id"), nullable=True)
    reviewed_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True), nullable=True)
    review_notes: Mapped[str | None] = mapped_column(String(500))
    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
