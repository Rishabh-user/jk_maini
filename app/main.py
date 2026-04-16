import os
from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from sqladmin import Admin, ModelView
from sqlalchemy import create_engine

from app.db.session import engine, Base
from app.models import (  # noqa: F401 — register models
    User, Email, Attachment, RawData, MainiPart, ZSOReport,
    DemandUpload, InventoryStock, AllocationResult,
    CoverageReport, SalesData, BudgetData,
)
from app.api import auth, users, emails, attachments, zso, dashboard, master_data
from app.api import demand, inventory, coverage, performance, uploads
from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()


@asynccontextmanager
async def lifespan(app: FastAPI):
    # Startup: create tables and upload directory
    async with engine.begin() as conn:
        await conn.run_sync(Base.metadata.create_all)
    os.makedirs(settings.UPLOAD_DIR, exist_ok=True)
    logger.info("Application started — tables created")
    yield
    # Shutdown
    await engine.dispose()
    logger.info("Application shut down")


app = FastAPI(
    title=settings.APP_NAME,
    description="AI-powered email processing and ZSO report generation for JK Maini",
    version="1.0.0",
    lifespan=lifespan,
)

# CORS
app.add_middleware(
    CORSMiddleware,
    allow_origins=["*"],
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

# Routes
app.include_router(auth.router)
app.include_router(users.router)
app.include_router(emails.router)
app.include_router(attachments.router)
app.include_router(zso.router)
app.include_router(dashboard.router)
app.include_router(master_data.router)
app.include_router(demand.router)
app.include_router(inventory.router)
app.include_router(coverage.router)
app.include_router(performance.router)
app.include_router(uploads.router)


# ──────────────────────────────────────────────
# SQLAdmin — Database Admin Panel at /admin
# ──────────────────────────────────────────────
sync_engine = create_engine(settings.DATABASE_URL_SYNC)
admin = Admin(app, sync_engine, title="JK Maini DB Admin")


class UserAdmin(ModelView, model=User):
    column_list = [User.id, User.email, User.full_name, User.role, User.is_active, User.created_at]
    column_searchable_list = [User.email, User.full_name]
    column_sortable_list = [User.id, User.email, User.role, User.created_at]
    can_create = True
    can_edit = True
    can_delete = True
    name = "User"
    name_plural = "Users"
    icon = "fa-solid fa-users"


class EmailAdmin(ModelView, model=Email):
    column_list = [Email.id, Email.gmail_message_id, Email.subject, Email.sender, Email.status, Email.created_at]
    column_searchable_list = [Email.subject, Email.sender]
    column_sortable_list = [Email.id, Email.status, Email.created_at]
    can_create = False
    can_edit = True
    can_delete = True
    name = "Email"
    name_plural = "Emails"
    icon = "fa-solid fa-envelope"


class AttachmentAdmin(ModelView, model=Attachment):
    column_list = [Attachment.id, Attachment.email_id, Attachment.filename, Attachment.content_type, Attachment.file_size, Attachment.created_at]
    column_searchable_list = [Attachment.filename]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Attachment"
    name_plural = "Attachments"
    icon = "fa-solid fa-paperclip"


class RawDataAdmin(ModelView, model=RawData):
    column_list = [RawData.id, RawData.attachment_id, RawData.source_type, RawData.created_at]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Raw Data"
    name_plural = "Raw Data"
    icon = "fa-solid fa-database"


class MainiPartAdmin(ModelView, model=MainiPart):
    column_list = [MainiPart.id, MainiPart.customer_part_no, MainiPart.maini_part_no, MainiPart.description, MainiPart.country, MainiPart.unit_price, MainiPart.currency]
    column_searchable_list = [MainiPart.customer_part_no, MainiPart.maini_part_no, MainiPart.description]
    column_sortable_list = [MainiPart.id, MainiPart.customer_part_no, MainiPart.maini_part_no, MainiPart.country]
    can_create = True
    can_edit = True
    can_delete = True
    name = "Maini Part"
    name_plural = "Maini Parts"
    icon = "fa-solid fa-gear"


class ZSOReportAdmin(ModelView, model=ZSOReport):
    column_list = [ZSOReport.id, ZSOReport.email_id, ZSOReport.kas_name, ZSOReport.total_inr, ZSOReport.status, ZSOReport.created_at]
    column_searchable_list = [ZSOReport.kas_name, ZSOReport.status]
    column_sortable_list = [ZSOReport.id, ZSOReport.total_inr, ZSOReport.status, ZSOReport.created_at]
    can_create = False
    can_edit = True
    can_delete = True
    name = "ZSO Report"
    name_plural = "ZSO Reports"
    icon = "fa-solid fa-file-excel"


class DemandUploadAdmin(ModelView, model=DemandUpload):
    column_list = [DemandUpload.id, DemandUpload.uploaded_by, DemandUpload.upload_type, DemandUpload.filename, DemandUpload.row_count, DemandUpload.created_at]
    column_searchable_list = [DemandUpload.filename, DemandUpload.upload_type]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Demand Upload"
    name_plural = "Demand Uploads"
    icon = "fa-solid fa-clipboard-list"


class InventoryStockAdmin(ModelView, model=InventoryStock):
    column_list = [InventoryStock.id, InventoryStock.uploaded_by, InventoryStock.stock_type, InventoryStock.filename, InventoryStock.row_count, InventoryStock.created_at]
    column_searchable_list = [InventoryStock.filename, InventoryStock.stock_type]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Inventory Stock"
    name_plural = "Inventory Stocks"
    icon = "fa-solid fa-boxes-stacked"


class AllocationResultAdmin(ModelView, model=AllocationResult):
    column_list = [AllocationResult.id, AllocationResult.created_by, AllocationResult.allocation_type, AllocationResult.zso_report_id, AllocationResult.created_at]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Allocation Result"
    name_plural = "Allocation Results"
    icon = "fa-solid fa-chart-pie"


class CoverageReportAdmin(ModelView, model=CoverageReport):
    column_list = [CoverageReport.id, CoverageReport.created_by, CoverageReport.allocation_id, CoverageReport.status, CoverageReport.created_at]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Coverage Report"
    name_plural = "Coverage Reports"
    icon = "fa-solid fa-shield"


class SalesDataAdmin(ModelView, model=SalesData):
    column_list = [SalesData.id, SalesData.uploaded_by, SalesData.fiscal_year, SalesData.filename, SalesData.created_at]
    column_searchable_list = [SalesData.fiscal_year, SalesData.filename]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Sales Data"
    name_plural = "Sales Data"
    icon = "fa-solid fa-chart-line"


class BudgetDataAdmin(ModelView, model=BudgetData):
    column_list = [BudgetData.id, BudgetData.uploaded_by, BudgetData.fiscal_year, BudgetData.filename, BudgetData.created_at]
    column_searchable_list = [BudgetData.fiscal_year, BudgetData.filename]
    can_create = False
    can_edit = False
    can_delete = True
    name = "Budget Data"
    name_plural = "Budget Data"
    icon = "fa-solid fa-bullseye"


admin.add_view(UserAdmin)
admin.add_view(EmailAdmin)
admin.add_view(AttachmentAdmin)
admin.add_view(RawDataAdmin)
admin.add_view(MainiPartAdmin)
admin.add_view(ZSOReportAdmin)
admin.add_view(DemandUploadAdmin)
admin.add_view(InventoryStockAdmin)
admin.add_view(AllocationResultAdmin)
admin.add_view(CoverageReportAdmin)
admin.add_view(SalesDataAdmin)
admin.add_view(BudgetDataAdmin)


@app.get("/", tags=["Health"])
async def health_check():
    return {"status": "healthy", "app": settings.APP_NAME, "version": "1.0.0"}
