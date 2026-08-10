from pydantic_settings import BaseSettings
from functools import lru_cache
from typing import List


class Settings(BaseSettings):
    # Database
    DATABASE_URL: str = "postgresql+asyncpg://postgres:password@localhost:5432/jk_maini_db"
    DATABASE_URL_SYNC: str = "postgresql+psycopg2://postgres:password@localhost:5432/jk_maini_db"

    # JWT
    SECRET_KEY: str = "change-me-in-production"
    ALGORITHM: str = "HS256"
    ACCESS_TOKEN_EXPIRE_MINUTES: int = 60

    # Gmail
    GMAIL_CREDENTIALS_FILE: str = "credentials.json"
    GMAIL_TOKEN_FILE: str = "token.json"
    GMAIL_SCOPES: str = "https://www.googleapis.com/auth/gmail.modify"
    # Base64-encoded token.json — fallback auth path for headless servers
    # (no browser to complete the interactive OAuth consent screen). Same
    # value you'd set as GMAIL_TOKEN_B64 on Render; settable here too so
    # local runs can exercise the identical code path.
    GMAIL_TOKEN_B64: str = ""

    # Claude AI
    ANTHROPIC_API_KEY: str = ""
    # Model for column mapping (cheap, structured). Default = the one this app ships with.
    AI_MODEL: str = "claude-sonnet-4-20250514"
    # Model for AI-fallback extraction (email bodies, embedded tables, images, scanned PDFs).
    # Defaults to the same proven model; set to a stronger model (e.g. claude-opus-4-8)
    # in .env if your API key has access and you want maximum extraction accuracy.
    EXTRACTION_MODEL: str = "claude-sonnet-4-20250514"

    # Tesseract
    TESSERACT_CMD: str = "tesseract"

    # App
    APP_NAME: str = "JK Maini - AI Email to ZSO Automation"
    APP_ENV: str = "development"          # development | staging | production
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    UPLOAD_DIR: str = "./uploads"

    # CORS — comma-separated list of allowed origins (frontend URLs).
    # Default is safe for local dev (Vite on 5173). In production this MUST
    # be set to the deployed frontend URL(s); wildcard "*" + credentials is
    # a browser-rejected combo and silently breaks every authenticated
    # request from a real browser.
    CORS_ORIGINS: str = "http://localhost:5173,http://localhost:3000"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}

    @property
    def cors_origins(self) -> List[str]:
        return [o.strip() for o in self.CORS_ORIGINS.split(",") if o.strip()]


@lru_cache
def get_settings() -> Settings:
    return Settings()


# ---------------------------------------------------------------------------
# Fail-fast production safety guard
# ---------------------------------------------------------------------------
#
# The defaults above are convenient for local dev but dangerous in production.
# When APP_ENV is anything other than development, we refuse to boot with:
#   - SECRET_KEY still at "change-me-in-production" or <32 chars → JWT forgery
#   - CORS_ORIGINS containing "*"                               → browser rejects
#   - ANTHROPIC_API_KEY empty                                   → AI mapping
#                                                                 silently fails
#
# Local dev is unaffected — APP_ENV defaults to "development", guard skips.
def _assert_production_safety(s: Settings) -> None:
    env = (s.APP_ENV or "").strip().lower()
    if env in ("", "development", "dev", "local", "test"):
        return

    problems: list[str] = []
    if s.SECRET_KEY == "change-me-in-production" or len(s.SECRET_KEY) < 32:
        problems.append(
            "SECRET_KEY must be set to a strong random string (>=32 chars) "
            'in production. Generate one with: python -c "import secrets; '
            'print(secrets.token_urlsafe(48))"'
        )
    if "*" in s.cors_origins:
        problems.append(
            'CORS_ORIGINS contains "*" — browsers refuse credentialed '
            "requests against wildcard origins. Set CORS_ORIGINS to your "
            "deployed frontend URL(s), comma-separated."
        )
    if not s.ANTHROPIC_API_KEY:
        problems.append(
            "ANTHROPIC_API_KEY is empty — AI column mapping and AI-fallback "
            "extraction will silently fall back to keyword heuristics."
        )

    if problems:
        joined = "\n  * " + "\n  * ".join(problems)
        raise RuntimeError(
            f"Refusing to start with APP_ENV={s.APP_ENV!r}. "
            f"Production config problems:{joined}\n"
            f"Set the missing values in your .env and redeploy. "
            f"To bypass locally, set APP_ENV=development."
        )


_assert_production_safety(get_settings())
