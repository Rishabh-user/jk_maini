"""Gmail OAuth "web app" flow — browser-based (re-)authorization that works
identically on localhost and on a headless server (Render), unlike
InstalledAppFlow.run_local_server() in gmail_service.py, which needs a
browser running on the same machine as the backend (impossible on Render).

Credentials are persisted to the `gmail_credentials` table, not token.json —
Render's disk doesn't survive redeploys, so a file-based token silently
disappears on every deploy. This is what the "Re-authorize Gmail" button
in the UI drives.
"""
import json
import secrets
import time

from google.oauth2.credentials import Credentials
from google_auth_oauthlib.flow import Flow
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.email import GmailCredential
from app.utils.config import get_settings
from app.utils.logging import logger

settings = get_settings()

# CSRF-protection nonces for the OAuth redirect — generated in
# get_authorization_url(), consumed once in verify_state(). In-memory is
# fine here: single mailbox, single admin/KAS user re-authorizing
# occasionally, and a nonce is only ever alive for the few seconds between
# the user clicking "authorize" and Google redirecting back. Entries older
# than 10 minutes are swept out lazily so an abandoned attempt (closed tab,
# denied consent) doesn't linger forever.
_pending_states: dict[str, float] = {}
_STATE_TTL_SECONDS = 600


def _sweep_expired_states() -> None:
    cutoff = time.time() - _STATE_TTL_SECONDS
    for state, created_at in list(_pending_states.items()):
        if created_at < cutoff:
            _pending_states.pop(state, None)


def _build_flow(redirect_uri: str) -> Flow:
    return Flow.from_client_secrets_file(
        settings.GMAIL_CREDENTIALS_FILE,
        scopes=[settings.GMAIL_SCOPES],
        redirect_uri=redirect_uri,
    )


def get_authorization_url(redirect_uri: str) -> str:
    _sweep_expired_states()
    flow = _build_flow(redirect_uri)
    state = secrets.token_urlsafe(24)
    auth_url, _ = flow.authorization_url(
        access_type="offline",   # request a refresh_token, not just an access_token
        prompt="consent",        # force Google to issue a NEW refresh_token every time
        state=state,
        include_granted_scopes="true",
    )
    _pending_states[state] = time.time()
    return auth_url


def verify_state(state: str) -> bool:
    """One-time use — pops the state so the same callback URL can't be replayed."""
    return _pending_states.pop(state, None) is not None


async def exchange_code(db: AsyncSession, redirect_uri: str, code: str) -> Credentials:
    flow = _build_flow(redirect_uri)
    flow.fetch_token(code=code)
    creds = flow.credentials
    await save_credentials(db, creds)
    return creds


async def save_credentials(db: AsyncSession, creds: Credentials) -> None:
    token_data = json.loads(creds.to_json())
    row = (await db.execute(select(GmailCredential).order_by(GmailCredential.id).limit(1))).scalar_one_or_none()
    if row:
        row.token_data = token_data
    else:
        row = GmailCredential(token_data=token_data)
        db.add(row)
    await db.flush()
    logger.info("Gmail credentials saved to database")


async def load_credentials(db: AsyncSession) -> Credentials | None:
    """DB is authoritative. Falls back to a one-time seed from whatever
    legacy source is available (local token.json, or GMAIL_TOKEN_B64) so
    existing setups keep working without re-clicking "authorize" — once
    seeded, the DB row takes over and the legacy source is never read again."""
    row = (await db.execute(select(GmailCredential).order_by(GmailCredential.id).limit(1))).scalar_one_or_none()
    if row:
        return Credentials.from_authorized_user_info(row.token_data, scopes=[settings.GMAIL_SCOPES])

    seeded = _load_legacy_credentials()
    if seeded:
        await save_credentials(db, seeded)
        logger.info("Seeded gmail_credentials from legacy token.json/GMAIL_TOKEN_B64")
        return seeded
    return None


def _load_legacy_credentials() -> Credentials | None:
    import os

    if os.path.exists(settings.GMAIL_TOKEN_FILE):
        try:
            return Credentials.from_authorized_user_file(settings.GMAIL_TOKEN_FILE, [settings.GMAIL_SCOPES])
        except Exception as e:
            logger.warning(f"Could not read legacy {settings.GMAIL_TOKEN_FILE}: {e}")

    token_b64 = settings.GMAIL_TOKEN_B64.strip()
    if token_b64:
        try:
            import base64
            token_json = base64.b64decode(token_b64).decode("utf-8")
            return Credentials.from_authorized_user_info(json.loads(token_json), scopes=[settings.GMAIL_SCOPES])
        except Exception as e:
            logger.warning(f"Could not decode legacy GMAIL_TOKEN_B64: {e}")

    return None
