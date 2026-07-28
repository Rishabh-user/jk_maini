from datetime import datetime
from pydantic import BaseModel


class RawDataResponse(BaseModel):
    id: int
    attachment_id: int
    extracted_data: dict | None
    column_mapping: dict | None
    mapped_data: list[dict] | dict | None
    source_type: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class MainiPartCreate(BaseModel):
    customer_name: str | None = None
    customer_location: str | None = None
    sold_to_party: str | None = None
    ship_to_party: str | None = None
    customer_part_no: str
    maini_part_no: str | None = None
    description: str | None = None
    country: str | None = None
    unit_price: float | None = None
    currency: str = "INR"
    incoterm: str | None = None
    hsn_code: str | None = None
    extra_data: dict | None = None


class MainiPartResponse(BaseModel):
    id: int
    customer_name: str | None
    customer_location: str | None
    sold_to_party: str | None = None
    ship_to_party: str | None = None
    customer_part_no: str
    maini_part_no: str | None
    description: str | None
    country: str | None
    unit_price: float | None
    currency: str | None
    incoterm: str | None = None
    hsn_code: str | None
    # Columns from an uploaded file that didn't map to a known field —
    # {original_header: value}. None when the row has nothing extra.
    extra_data: dict | None = None
    created_at: datetime

    model_config = {"from_attributes": True}


class MasterDataListResponse(BaseModel):
    total: int
    items: list[MainiPartResponse]
    # Union of extra_data keys seen across the WHOLE table (not just this
    # page) — lets the frontend build stable AG Grid columns for "extra"
    # fields that don't shift every time you turn the page.
    extra_columns: list[str] = []


class ZSOGenerateRequest(BaseModel):
    email_id: int


class ZSOReportResponse(BaseModel):
    id: int
    email_id: int | None
    created_by: int
    report_data: dict | None
    kas_name: str | None
    total_inr: float | None
    status: str
    export_path: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


class ColumnMappingRequest(BaseModel):
    source_columns: list[str]


class ColumnMappingResponse(BaseModel):
    mapping: dict[str, str]
