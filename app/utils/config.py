from pydantic_settings import BaseSettings
from functools import lru_cache


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

    # Claude AI
    ANTHROPIC_API_KEY: str = ""

    # Tesseract
    TESSERACT_CMD: str = "tesseract"

    # App
    APP_NAME: str = "JK Maini - AI Email to ZSO Automation"
    DEBUG: bool = False
    LOG_LEVEL: str = "INFO"
    UPLOAD_DIR: str = "./uploads"

    model_config = {"env_file": ".env", "env_file_encoding": "utf-8"}


@lru_cache
def get_settings() -> Settings:
    return Settings()
