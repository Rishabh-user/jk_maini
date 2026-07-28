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
from app.models.data import ForexRate
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

    # Combine all mapped rows + collect any sender instructions detected during extraction
    all_mapped_rows = []
    instructions: list = []
    for entry in raw_data_entries:
        mapped = entry.mapped_data if isinstance(entry.mapped_data, list) else []
        ed = entry.extracted_data if isinstance(entry.extracted_data, dict) else {}
        raw_rows = ed.get("rows") if isinstance(ed.get("rows"), list) else []
        # Back-fill the delivery-schedule "Type" (PO vs Fcst) onto mapped rows that
        # were processed before Type-capture existed — so old uploads label correctly
        # on regenerate without needing a re-process.
        for i, mrow in enumerate(mapped):
            if isinstance(mrow, dict) and not mrow.get("_demand_type") and i < len(raw_rows):
                rr = raw_rows[i]
                if isinstance(rr, dict):
                    tval = next((v for k, v in rr.items() if str(k).strip().lower() == "type" and str(v).strip()), None)
                    if tval:
                        mrow["_demand_type"] = str(tval).strip()
        all_mapped_rows.extend(mapped)
        if isinstance(ed.get("instructions"), list):
            instructions.extend(ed["instructions"])

    if not all_mapped_rows:
        raise HTTPException(status_code=400, detail="No structured data rows found in attachments")

    # Match with maini_parts
    matched_rows = await match_with_maini_parts(db, all_mapped_rows)

    # Fetch the ACTIVE forex rate per currency — explicit is_active flag,
    # not "most recent effective_date wins". The old date-recency logic
    # had no tie-breaker for two rows sharing the same effective_date, so
    # which rate got used could silently flip between generations. Users
    # now control which rate is active directly (Master Data > Forex
    # Rates), so this reads exactly what they set.
    forex_result = await db.execute(
        select(ForexRate).where(ForexRate.is_active.is_(True))
    )
    all_forex = forex_result.scalars().all()
    forex_rates: dict[str, dict] = {}
    for fx in all_forex:
        forex_rates[fx.currency_from] = {
            "rate": fx.rate,
            "currency_to": fx.currency_to,
            "effective_date": fx.effective_date.isoformat(),
            "notes": fx.notes,
        }
    # INR→INR is always 1
    forex_rates.setdefault("INR", {"rate": 1.0, "currency_to": "INR", "effective_date": "", "notes": "Base currency"})

    # ── Enrich with internal forecast data ──────────────────────────────
    # Primary match: by customer part number (always present, customer name often missing).
    # Fallback: by customer name (catches parts not in the demand file at all).
    from app.services.forecast_service import get_forecast_rows_by_parts, get_forecast_rows_for_zso

    # 1. Match forecast by customer part numbers present in demand rows
    # str(...) coercion: part numbers can be numeric in some files (e.g. 9933200600
    # as an int) → .strip() on a bare int raises AttributeError.
    demand_part_numbers = list({
        str(r.get("Customer Part #", "") or "").strip()
        for r in matched_rows
        if str(r.get("Customer Part #", "") or "").strip()
    })
    forecast_rows = await get_forecast_rows_by_parts(db, demand_part_numbers)

    # 2. Fallback: for any customer name in demand, pick up forecast parts NOT already matched
    #    (e.g. forecast parts for this customer that weren't in this specific demand file)
    already_matched_parts = {str(r.get("Customer Part #", "") or "").strip().lower() for r in forecast_rows}
    customer_names_in_demand = list({
        str(r.get("Customer Name", "") or "").strip()
        for r in matched_rows
        if str(r.get("Customer Name", "") or "").strip()
    })
    for cname in customer_names_in_demand:
        extra_rows = await get_forecast_rows_for_zso(db, cname)
        new_rows = [r for r in extra_rows if str(r.get("Customer Part #", "") or "").strip().lower() not in already_matched_parts]
        if new_rows:
            forecast_rows.extend(new_rows)
            already_matched_parts.update(str(r.get("Customer Part #", "") or "").strip().lower() for r in new_rows)

    if forecast_rows:
        matched_rows = list(matched_rows) + forecast_rows
        logger.info(f"ZSO enriched with {len(forecast_rows)} internal forecast rows")

    # ── Apply sender instructions (e.g. "discard PO 200981234") ──────────────
    applied_instructions: list = []
    if instructions:
        from app.services.zso_service import apply_instructions
        matched_rows, applied_instructions = apply_instructions(matched_rows, instructions)
        logger.info(f"Applied {len(applied_instructions)} sender instruction(s) to ZSO")

    # ── Duplicate handling ───────────────────────────────────────────────────
    # (1) Drop exact-duplicate lines within this report (e.g. same PO as PDF+Excel).
    # (2) Register every line in the demand-line ledger for cross-source duplicate
    #     detection + version history (revisions auto-supersede, retained for audit).
    # Wrapped defensively — dedup must never break ZSO generation.
    dedup_summary: dict = {}
    try:
        from app.services.dedup_service import dedupe_within_report, register_demand_lines
        matched_rows, dropped = dedupe_within_report(matched_rows)
        ledger = await register_demand_lines(db, matched_rows, source_email_id=email.id)
        dedup_summary = {"duplicates_dropped_in_report": dropped, **ledger}
    except Exception as e:
        logger.warning(f"Dedup step skipped (ZSO still generated): {e}")

    # Build ZSO report
    zso_data = build_zso_data(matched_rows, kas_name=current_user.full_name, forex_rates=forex_rates)
    if applied_instructions:
        zso_data["applied_instructions"] = applied_instructions
    if dedup_summary:
        zso_data["dedup_summary"] = dedup_summary

    # ── Version history (additive, snapshot-preserving) ──────────────────────
    # Attach this upload to its demand chain (matched by part overlap). If nothing
    # changed vs the latest version → duplicate: don't save a new report/version.
    # Wrapped defensively — versioning must never break report generation.
    try:
        from app.services import versioning_service as vs
        items = zso_data.get("items", [])
        doc_class = vs.document_class(items)
        parts = vs.part_set(items)
        customer = vs.primary_customer(items)
        source = "manual" if str(email.gmail_message_id or "").startswith("manual-upload-") else "email"
        latest = await vs.find_latest_chain_version(db, parts, doc_class, customer)

        if latest is not None:
            snap = (await db.execute(
                select(ZSOReport).where(ZSOReport.id == latest.zso_report_id)
            )).scalar_one_or_none()
            old_items = (snap.report_data or {}).get("items", []) if snap else []
            diff = vs.diff_items(old_items, items)

            # A forex-rate switch (Master Data > Forex Rates > Activate) changes
            # every row's unit_price_inr/total_inr but touches none of
            # diff_items' TRACKED_FIELDS — those are demand/PO fields, not
            # currency conversion. Check separately so regenerating after
            # switching the active rate doesn't silently return the stale
            # pre-switch report just because the underlying PO data matches.
            old_forex_used = (snap.report_data or {}).get("forex_rates_used", {}) if snap else {}
            new_forex_used = zso_data.get("forex_rates_used", {})
            forex_changes = vs.forex_rate_diff(old_forex_used, new_forex_used)

            if not diff["has_changes"] and not forex_changes and snap is not None:
                logger.info(f"ZSO generate: no changes vs v{latest.version_number} — duplicate, no new version")
                return snap  # return the existing current version; nothing new saved

            if forex_changes:
                # Surface the forex switch as a visible change (reuses the
                # existing ReportChange mechanism) instead of creating a new
                # version whose demand-level diff misleadingly shows "0
                # changed" despite every row's INR total being different now.
                diff = dict(diff)
                diff["modified"] = list(diff["modified"]) + [{
                    "row_key": "__forex_rate_change__",
                    "cust_part_no": "",
                    "po_number": "",
                    "changes": forex_changes,
                }]
                diff["has_changes"] = True
                diff["counts"] = {**diff["counts"], "modified": diff["counts"]["modified"] + 1}
                logger.info(f"ZSO generate: forex rate change detected vs v{latest.version_number}: {forex_changes}")

            report = await save_zso_report(db, email.id, current_user, zso_data)
            await vs.record_version(
                db, demand_doc_key=latest.demand_doc_key,
                version_number=latest.version_number + 1, zso_report_id=report.id,
                is_base=False, source=source, source_email_id=email.id,
                doc_class=doc_class, customer=customer, created_by=current_user.id, diff=diff,
            )
            return report

        # No matching chain → this is a new base document (V1)
        report = await save_zso_report(db, email.id, current_user, zso_data)
        base_diff = {"added": [], "removed": [], "modified": [], "unchanged": 0,
                     "has_changes": False,
                     "counts": {"total": len(items), "added": 0, "removed": 0, "modified": 0, "unchanged": 0}}
        await vs.record_version(
            db, demand_doc_key=f"doc_{report.id}", version_number=1, zso_report_id=report.id,
            is_base=True, source=source, source_email_id=email.id,
            doc_class=doc_class, customer=customer, created_by=current_user.id, diff=base_diff,
        )
        return report
    except Exception as e:
        logger.warning(f"Version tracking skipped (report still generated): {e}")

    # Fallback: plain save (versioning unavailable/failed)
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


@router.get("/{report_id}/versions")
async def get_report_versions(
    report_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Version history for the demand chain this report belongs to."""
    from app.models.data import ReportVersion
    mine = (await db.execute(
        select(ReportVersion).where(ReportVersion.zso_report_id == report_id)
    )).scalar_one_or_none()
    if not mine:
        return {"demand_doc_key": None, "versions": []}
    chain = (await db.execute(
        select(ReportVersion).where(ReportVersion.demand_doc_key == mine.demand_doc_key)
        .order_by(ReportVersion.version_number.asc())
    )).scalars().all()
    return {
        "demand_doc_key": mine.demand_doc_key,
        "versions": [{
            "version_id": v.id,
            "version": (f"v{v.version_number}" if v.is_base else f"v{v.version_number}"),
            "version_number": v.version_number,
            "is_base": v.is_base,
            "zso_report_id": v.zso_report_id,
            "source": v.source,
            "doc_class": v.doc_class,
            "customer_name": v.customer_name,
            "total_rows": v.total_rows,
            "added_rows": v.added_rows,
            "removed_rows": v.removed_rows,
            "modified_rows": v.modified_rows,
            "unchanged_rows": v.unchanged_rows,
            "created_at": v.created_at.isoformat() if v.created_at else None,
        } for v in chain],
    }


@router.get("/versions/{version_id}/changes")
async def get_version_changes(
    version_id: int,
    db: AsyncSession = Depends(get_db),
    current_user: User = Depends(get_current_user),
):
    """Field-level changes recorded for a version (added / removed / modified)."""
    from app.models.data import ReportChange
    rows = (await db.execute(
        select(ReportChange).where(ReportChange.version_id == version_id)
        .order_by(ReportChange.change_type, ReportChange.cust_part_no)
    )).scalars().all()
    return [{
        "row_key": r.row_key, "cust_part_no": r.cust_part_no, "po_number": r.po_number,
        "change_type": r.change_type, "field_name": r.field_name,
        "old_value": r.old_value, "new_value": r.new_value,
    } for r in rows]


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
    visible_columns: list[str] | None = None,
):
    """Export ZSO report as Excel.

    Pass `visible_columns` (list of frontend camelCase field names) to restrict
    the export to only the columns currently shown in the UI.  When omitted all
    columns are exported.
    """
    result = await db.execute(select(ZSOReport).where(ZSOReport.id == report_id))
    report = result.scalar_one_or_none()
    if not report:
        raise HTTPException(status_code=404, detail="ZSO report not found")

    if not report.report_data:
        raise HTTPException(status_code=400, detail="No report data to export")

    filepath = export_zso_to_excel(report.report_data, visible_columns=visible_columns or None)
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
