from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.data import MainiPart
from app.utils.logging import logger


async def match_with_maini_parts(
    db: AsyncSession,
    mapped_rows: list[dict],
) -> list[dict]:
    """Match extracted data rows with maini_parts master table.

    For each row, find the matching maini_part by customer_part_no
    and enrich the row with maini_part_no, description, and country.
    """
    enriched_rows = []

    for row in mapped_rows:
        customer_part = row.get("Customer Part #", "").strip()
        if not customer_part:
            row["_match_status"] = "no_customer_part"
            enriched_rows.append(row)
            continue

        result = await db.execute(
            select(MainiPart).where(MainiPart.customer_part_no == customer_part)
        )
        part = result.scalar_one_or_none()

        if part:
            row["Maini Part #"] = part.maini_part_no
            row["Description"] = part.description or row.get("Description", "")
            row["Country"] = part.country or row.get("Country", "")
            row["Customer Name"] = part.customer_name or row.get("Customer Name", "")
            row["Customer Location"] = part.customer_location or row.get("Customer Location", "")
            row["Unit Price"] = part.unit_price if part.unit_price else row.get("Unit Price", "")
            row["Currency"] = part.currency or row.get("Currency", "INR")
            row["HSN Code"] = part.hsn_code or row.get("HSN Code", "")
            row["_match_status"] = "matched"
            logger.info(f"Matched customer part '{customer_part}' -> maini part '{part.maini_part_no}'")
        else:
            row["_match_status"] = "unmatched"
            logger.warning(f"No match found for customer part: '{customer_part}'")

        enriched_rows.append(row)

    matched = sum(1 for r in enriched_rows if r.get("_match_status") == "matched")
    logger.info(f"Matching complete: {matched}/{len(enriched_rows)} rows matched")
    return enriched_rows
