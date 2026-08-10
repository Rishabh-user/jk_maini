import base64
import hashlib
import os
import re
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from google.oauth2.credentials import Credentials
from google.auth.transport.requests import Request
from googleapiclient.discovery import build
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import Email, EmailStatus, Attachment
from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()


class GmailService:
    def __init__(self):
        self.service = None
        self.scopes = [settings.GMAIL_SCOPES]
        self.creds: Credentials | None = None

    def authenticate(self, stored_creds: Credentials | None) -> bool:
        """Build the Gmail API client from already-loaded credentials
        (see app.services.gmail_oauth.load_credentials — that's the DB
        lookup; this method has no DB access of its own, so it stays sync).

        Returns True if the access token was refreshed just now, meaning
        the caller should persist the updated credentials back to storage.
        Raises RuntimeError if there's nothing usable — the caller should
        then point the user at the "Re-authorize Gmail" flow.
        """
        creds = stored_creds
        refreshed = False

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                logger.info("Gmail access token expired, refreshing...")
                creds.refresh(Request())
                refreshed = True
            else:
                raise RuntimeError(
                    "No valid Gmail credentials. Use the 'Re-authorize Gmail' "
                    "button to connect a Gmail account."
                )

        self.creds = creds
        self.service = build("gmail", "v1", credentials=creds)
        logger.info("Gmail API authenticated successfully")
        return refreshed

    def fetch_unread_emails(self, max_results: int = 20, after_date: str | None = None) -> list[dict]:
        """Fetch unread emails. after_date format: 'YYYY/MM/DD'"""
        if not self.service:
            raise RuntimeError("authenticate() must be called before fetch_unread_emails()")

        query = "is:unread"
        if after_date:
            query += f" after:{after_date}"

        results = self.service.users().messages().list(
            userId="me",
            q=query,
            maxResults=max_results,
        ).execute()

        messages = results.get("messages", [])
        emails = []

        for msg_ref in messages:
            msg = self.service.users().messages().get(
                userId="me", id=msg_ref["id"], format="full"
            ).execute()
            emails.append(self._parse_message(msg))

        logger.info(f"Fetched {len(emails)} unread emails")
        return emails

    def _parse_message(self, message: dict) -> dict:
        headers = message.get("payload", {}).get("headers", [])
        header_map = {h["name"].lower(): h["value"] for h in headers}

        body = self._get_body(message.get("payload", {}))
        body_html = self._get_html_body(message.get("payload", {}))
        attachments = self._get_attachments(message)

        received_at = None
        if "date" in header_map:
            try:
                received_at = parsedate_to_datetime(header_map["date"])
            except Exception:
                received_at = datetime.now(timezone.utc)

        return {
            "gmail_message_id": message["id"],
            "subject": header_map.get("subject"),
            "sender": header_map.get("from"),
            "body": body,
            "body_html": body_html,
            "received_at": received_at,
            "attachments": attachments,
        }

    def _get_body(self, payload: dict) -> str:
        if payload.get("mimeType") == "text/plain" and payload.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")

        parts = payload.get("parts", [])
        for part in parts:
            if part.get("mimeType") == "text/plain" and part.get("body", {}).get("data"):
                return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
            if part.get("parts"):
                result = self._get_body(part)
                if result:
                    return result
        return ""

    def _get_html_body(self, payload: dict) -> str:
        """Extract the text/html alternative of the body (preserves tables)."""
        if payload.get("mimeType") == "text/html" and payload.get("body", {}).get("data"):
            return base64.urlsafe_b64decode(payload["body"]["data"]).decode("utf-8", errors="replace")
        for part in payload.get("parts", []):
            if part.get("mimeType") == "text/html" and part.get("body", {}).get("data"):
                return base64.urlsafe_b64decode(part["body"]["data"]).decode("utf-8", errors="replace")
            if part.get("parts"):
                result = self._get_html_body(part)
                if result:
                    return result
        return ""

    def _iter_parts(self, payload: dict):
        """Recursively yield every MIME part (handles nested multipart/* trees)."""
        yield payload
        for part in payload.get("parts", []):
            yield from self._iter_parts(part)

    def _get_attachments(self, message: dict) -> list[dict]:
        """Collect file attachments AND inline images (screenshots) — recursively.

        Inline images live in nested multipart/related parts and may carry their
        bytes inline (body.data) rather than via attachmentId; both are handled.
        """
        attachments = []
        payload = message.get("payload", {})

        for idx, part in enumerate(self._iter_parts(payload)):
            mime = part.get("mimeType", "") or ""
            filename = part.get("filename") or ""
            body = part.get("body", {}) or {}
            attachment_id = body.get("attachmentId")
            inline_data = body.get("data")

            is_image = mime.startswith("image/")
            # Keep: real file attachments (have a filename) OR inline images
            if not filename and not is_image:
                continue
            if not attachment_id and not inline_data:
                continue

            if attachment_id:
                att = self.service.users().messages().attachments().get(
                    userId="me", messageId=message["id"], id=attachment_id
                ).execute()
                file_data = base64.urlsafe_b64decode(att["data"])
            else:
                file_data = base64.urlsafe_b64decode(inline_data)

            # Synthesize a filename for inline images that lack one
            if not filename and is_image:
                ext = mime.split("/")[-1].split("+")[0] or "png"
                filename = f"inline_image_{idx}.{ext}"

            attachments.append({
                "filename": filename,
                "content_type": mime,
                "data": file_data,
                "size": len(file_data),
            })

        return attachments

    def mark_as_read(self, message_id: str) -> None:
        if not self.service:
            raise RuntimeError("authenticate() must be called before mark_as_read()")

        self.service.users().messages().modify(
            userId="me",
            id=message_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()
        logger.info(f"Marked email {message_id} as read")


def _safe_filename(name: str) -> str:
    """Strip path separators and unsafe characters so the name is a single file."""
    name = (name or "attachment").strip()
    # Drop any directory components, then replace remaining unsafe chars
    name = os.path.basename(name.replace("\\", "/").rstrip("/"))
    name = re.sub(r'[<>:"/\\|?*\x00-\x1f]', "_", name).strip(" .")
    return name or "attachment"


async def save_email_to_db(
    db: AsyncSession,
    email_data: dict,
    upload_dir: str,
) -> Email:
    existing = await db.execute(
        select(Email).where(Email.gmail_message_id == email_data["gmail_message_id"])
    )
    if existing.scalar_one_or_none():
        logger.info(f"Email {email_data['gmail_message_id']} already exists, skipping")
        return None

    email = Email(
        gmail_message_id=email_data["gmail_message_id"],
        subject=email_data["subject"],
        sender=email_data["sender"],
        body=email_data["body"],
        received_at=email_data["received_at"],
        status=EmailStatus.UNPROCESSED,
    )
    db.add(email)
    await db.flush()

    os.makedirs(upload_dir, exist_ok=True)
    email_dir = os.path.join(upload_dir, str(email.id))
    os.makedirs(email_dir, exist_ok=True)

    for att_data in email_data.get("attachments", []):
        # Sanitize: attachment filenames can contain '/', '\' or other path
        # separators (e.g. "Maini // A462884.eml") which would break os.path.join.
        safe_name = _safe_filename(att_data["filename"])
        file_path = os.path.join(email_dir, safe_name)
        with open(file_path, "wb") as f:
            f.write(att_data["data"])

        attachment = Attachment(
            email_id=email.id,
            filename=att_data["filename"],   # keep original for display
            content_type=att_data["content_type"],
            file_path=file_path,
            file_size=att_data["size"],
            file_hash=hashlib.sha256(att_data["data"]).hexdigest(),
        )
        db.add(attachment)

    # Persist the HTML body (preserves tables the plain-text part flattens) so the
    # processor can extract embedded tables. Saved as a normal attachment file.
    body_html = (email_data.get("body_html") or "").strip()
    if body_html:
        html_path = os.path.join(email_dir, "email_body.html")
        with open(html_path, "w", encoding="utf-8") as f:
            f.write(body_html)
        db.add(Attachment(
            email_id=email.id,
            filename="email_body.html",
            content_type="text/html",
            file_path=html_path,
            file_size=os.path.getsize(html_path),
        ))

    await db.flush()
    logger.info(f"Saved email {email.gmail_message_id} with {len(email_data.get('attachments', []))} attachments")
    return email
