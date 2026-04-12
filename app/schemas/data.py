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
    customer_part_no: str
    maini_part_no: str | None = None
    description: str | None = None
    country: str | None = None
    unit_price: float | None = None
    currency: str = "INR"
    hsn_code: str | None = None


class MainiPartResponse(BaseModel):
    id: int
    customer_name: str | None
    customer_location: str | None
    customer_part_no: str
    maini_part_no: str | None
    description: str | None
    country: str | None
    unit_price: float | None
    currency: str | None
    hsn_code: str | None
    created_at: datetime

    model_config = {"from_attributes": True}


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
