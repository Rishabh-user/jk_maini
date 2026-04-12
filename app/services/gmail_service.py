import base64
import os
from datetime import datetime, timezone
from email.utils import parsedate_to_datetime

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import InstalledAppFlow
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

    def authenticate(self) -> None:
        creds = None
        if os.path.exists(settings.GMAIL_TOKEN_FILE):
            creds = Credentials.from_authorized_user_file(settings.GMAIL_TOKEN_FILE, self.scopes)

        if not creds or not creds.valid:
            if creds and creds.expired and creds.refresh_token:
                creds.refresh(Request())
            else:
                flow = InstalledAppFlow.from_client_secrets_file(
                    settings.GMAIL_CREDENTIALS_FILE, self.scopes
                )
                creds = flow.run_local_server(port=0)
            with open(settings.GMAIL_TOKEN_FILE, "w") as token:
                token.write(creds.to_json())

        self.service = build("gmail", "v1", credentials=creds)
        logger.info("Gmail API authenticated successfully")

    def fetch_unread_emails(self, max_results: int = 20, after_date: str | None = None) -> list[dict]:
        """Fetch unread emails. after_date format: 'YYYY/MM/DD'"""
        if not self.service:
            self.authenticate()

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

    def _get_attachments(self, message: dict) -> list[dict]:
        attachments = []
        parts = message.get("payload", {}).get("parts", [])

        for part in parts:
            filename = part.get("filename")
            if not filename:
                continue

            attachment_id = part.get("body", {}).get("attachmentId")
            if not attachment_id:
                continue

            att_data = self.service.users().messages().attachments().get(
                userId="me", messageId=message["id"], id=attachment_id
            ).execute()

            file_data = base64.urlsafe_b64decode(att_data["data"])

            attachments.append({
                "filename": filename,
                "content_type": part.get("mimeType"),
                "data": file_data,
                "size": len(file_data),
            })

        return attachments

    def mark_as_read(self, message_id: str) -> None:
        if not self.service:
            self.authenticate()

        self.service.users().messages().modify(
            userId="me",
            id=message_id,
            body={"removeLabelIds": ["UNREAD"]},
        ).execute()
        logger.info(f"Marked email {message_id} as read")


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
        file_path = os.path.join(email_dir, att_data["filename"])
        with open(file_path, "wb") as f:
            f.write(att_data["data"])

        attachment = Attachment(
            email_id=email.id,
            filename=att_data["filename"],
            content_type=att_data["content_type"],
            file_path=file_path,
            file_size=att_data["size"],
        )
        db.add(attachment)

    await db.flush()
    logger.info(f"Saved email {email.gmail_message_id} with {len(email_data.get('attachments', []))} attachments")
    return email
