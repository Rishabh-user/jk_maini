import os

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.db.session import get_db
from app.models.user import User, UserRole
from app.models.email import Email
from app.models.data import RawData, ZSOReport
from app.schemas.data import ZSOGenerateRequest, ZSOReportResponse, ColumnMappingRequest, ColumnMappingResponse
from app.services.matching_service import match_with_maini_parts
from app.services.zso_service import build_zso_data, save_zso_report
from app.services.excel_export import export_zso_to_excel
from app.services.ai_mapping import map_columns_with_ai
from app.utils.security import get_current_user, require_roles
from app.utils.logging import logger

router = APIRouter(prefix="/zso", tags=["ZSO Reports"])


@router.post("/generate", response_model=ZSOReportResponse)
async def generate_zso(
    request: ZSOGenerateRequest,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    # Verify email exists and is processed
    email_result = await db.execute(select(Email).where(Email.id == request.email_id))
    email = email_result.scalar_one_or_none()
    if not email:
        raise HTTPException(status_code=404, detail="Email not found")

    # Gather all mapped data from attachments
    raw_result = await db.execute(
        select(RawData)
        .join(RawData.attachment)
        .where(RawData.attachment.has(email_id=email.id))
    )
    raw_data_entries = raw_result.scalars().all()

    if not raw_data_entries:
        raise HTTPException(status_code=400, detail="No processed data found for this email. Process the email first.")

    # Combine all mapped rows
    all_mapped_rows = []
    for entry in raw_data_entries:
        if entry.mapped_data and isinstance(entry.mapped_data, list):
            all_mapped_rows.extend(entry.mapped_data)

    if not all_mapped_rows:
        raise HTTPException(status_code=400, detail="No structured data rows found in attachments")

    # Match with maini_parts
    matched_rows = await match_with_maini_parts(db, all_mapped_rows)

    # Build ZSO report
    zso_data = build_zso_data(matched_rows, kas_name=current_user.full_name)

    # Save report
    report = await save_zso_report(db, email.id, current_user, zso_data)
    return report


@router.get("/", response_model=list[ZSOReportResponse])
async def list_zso_reports(
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    query = select(ZSOReport).order_by(ZSOReport.created_at.desc())

    # Non-admin users only see their own reports
    if current_user.role not in (UserRole.ADMIN,):
        query = query.where(ZSOReport.created_by == current_user.id)

    result = await db.execute(query)
    return result.scalars().all()


@router.get("/{report_id}", response_model=ZSOReportResponse)
async def get_zso_report(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    result = await db.execute(select(ZSOReport).where(ZSOReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="ZSO report not found")
    return report


@router.post("/export/{report_id}")
async def export_zso(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    result = await db.execute(select(ZSOReport).where(ZSOReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="ZSO report not found")

    if not report.report_data:
        raise HTTPException(status_code=400, detail="No report data to export")

    filepath = export_zso_to_excel(report.report_data)
    if not filepath:
        raise HTTPException(status_code=500, detail="Export failed — no data")

    # Update report with export path
    report.export_path = filepath
    report.status = "exported"
    await db.flush()

    return FileResponse(
        path=filepath,
        filename=os.path.basename(filepath),
        media_type="application/vnd.openxmlformats-officedocument.spreadsheetml.sheet",
    )


@router.post("/map-columns", response_model=ColumnMappingResponse)
async def map_columns(
    request: ColumnMappingRequest,
    current_user: User = Depends(require_roles(UserRole.ADMIN, UserRole.KAS)),
):
    mapping = await map_columns_with_ai(request.source_columns)
    return ColumnMappingResponse(mapping=mapping)
