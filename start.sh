#!/usr/bin/env bash
# Render provides DATABASE_URL as postgresql://...
# FastAPI needs postgresql+asyncpg:// for async and postgresql+psycopg2:// for sync

if [ -n "$DATABASE_URL" ]; then
  # Strip any existing driver prefix and rebuild
  DB_BASE=$(echo "$DATABASE_URL" | sed 's|^postgresql+[a-z]*://|postgresql://|' | sed 's|^postgres://|postgresql://|')

  export DATABASE_URL=$(echo "$DB_BASE" | sed 's|^postgresql://|postgresql+asyncpg://|')
  export DATABASE_URL_SYNC=$(echo "$DB_BASE" | sed 's|^postgresql://|postgresql+psycopg2://|')
fi

# Create uploads dir
mkdir -p ./uploads

# Write Gmail credential files from base64 env vars
if [ -n "$GMAIL_CREDENTIALS_B64" ]; then
  echo "$GMAIL_CREDENTIALS_B64" | base64 -d > credentials.json
  echo "Wrote credentials.json from GMAIL_CREDENTIALS_B64"
fi

if [ -n "$GMAIL_TOKEN_B64" ]; then
  echo "$GMAIL_TOKEN_B64" | base64 -d > token.json
  echo "Wrote token.json from GMAIL_TOKEN_B64"
fi

echo "Starting JK Maini Backend..."
echo "DATABASE_URL: ${DATABASE_URL:0:40}..."
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}"
