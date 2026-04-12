# JK Maini – AI Email to ZSO Automation

Production-ready backend system that automates the conversion of customer emails and attachments into structured ZSO (Zonal Sales Order) reports using AI-powered data mapping.

---

## Table of Contents

- [Overview](#overview)
- [Architecture](#architecture)
- [Tech Stack](#tech-stack)
- [Project Structure](#project-structure)
- [Setup & Installation](#setup--installation)
- [Database Schema](#database-schema)
- [API Reference](#api-reference)
- [Processing Pipeline](#processing-pipeline)
- [AI Column Mapping](#ai-column-mapping)
- [Authentication & Roles](#authentication--roles)
- [Configuration](#configuration)

---

## Overview

This system:

1. **Reads emails** from Gmail automatically via the Gmail API
2. **Parses attachments** — PDF, Excel, CSV, and images (OCR)
3. **Maps extracted columns** to a standard schema using Claude AI
4. **Matches parts** against the `maini_parts` master table
5. **Generates ZSO reports** with calculated fields (Total INR, status)
6. **Exports** formatted Excel files with Summary and Detail sheets

---

## Architecture

```
Gmail Inbox
    │
    ▼
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ Gmail Service │────▶│  File Parser     │────▶│  AI Mapping      │
│ (fetch/save)  │     │  PDF/Excel/CSV/  │     │  (Claude API)    │
│               │     │  Image OCR       │     │                  │
└──────────────┘     └─────────────────┘     └────────┬─────────┘
                                                       │
                                                       ▼
┌──────────────┐     ┌─────────────────┐     ┌──────────────────┐
│ Excel Export  │◀────│  ZSO Generator  │◀────│ Matching Service  │
│ (.xlsx)       │     │  (build report)  │     │ (maini_parts DB) │
└──────────────┘     └─────────────────┘     └──────────────────┘
```

---

## Tech Stack

| Component        | Technology                          |
|------------------|-------------------------------------|
| Framework        | FastAPI (async)                     |
| Database         | PostgreSQL + SQLAlchemy 2.0 (async) |
| Authentication   | JWT (python-jose + bcrypt)          |
| Email            | Gmail API (google-api-python-client)|
| AI Mapping       | Anthropic Claude API                |
| PDF Parsing      | pdfplumber                          |
| Excel/CSV        | pandas + openpyxl                   |
| Image OCR        | pytesseract + Pillow                |
| Validation       | Pydantic v2                         |
| Server           | Uvicorn (ASGI)                      |

---

## Project Structure

```
app/
├── main.py                        # Application entry point, lifespan, CORS, routers
├── api/
│   ├── auth.py                    # POST /auth/login
│   ├── users.py                   # CRUD /users/
│   ├── emails.py                  # /emails/, /emails/fetch, /emails/process-email/{id}
│   ├── attachments.py             # /attachments/{id}, /download, /raw-data
│   └── zso.py                     # /zso/generate, /zso/export/{id}, /zso/map-columns
├── models/
│   ├── user.py                    # User model (roles: Admin, KAS, Viewer)
│   ├── email.py                   # Email + Attachment models
│   └── data.py                    # RawData, MainiPart, ZSOReport models
├── schemas/
│   ├── user.py                    # Auth & user request/response schemas
│   ├── email.py                   # Email & attachment schemas
│   └── data.py                    # Data, ZSO, column mapping schemas
├── services/
│   ├── gmail_service.py           # Gmail API integration
│   ├── file_parser.py             # Multi-format file parser
│   ├── ai_mapping.py              # Claude AI column mapping
│   ├── email_processor.py         # End-to-end email processing pipeline
│   ├── matching_service.py        # Part matching against master table
│   ├── zso_service.py             # ZSO report generation
│   └── excel_export.py            # Styled Excel export
├── db/
│   ├── session.py                 # Async engine, session factory, get_db dependency
│   └── seed.py                    # Database seeder (admin user + sample parts)
└── utils/
    ├── config.py                  # Pydantic Settings (.env loader)
    ├── security.py                # JWT, password hashing, role-based access
    └── logging.py                 # Structured logging
```

---

## Setup & Installation

### Prerequisites

- Python 3.11+
- PostgreSQL 14+
- Tesseract OCR ([install guide](https://github.com/tesseract-ocr/tesseract))
- Gmail API credentials (`credentials.json` from Google Cloud Console)

### Steps

```bash
# 1. Clone and navigate
cd jk_maini/website

# 2. Create virtual environment
python -m venv venv
source venv/bin/activate        # Linux/Mac
venv\Scripts\activate           # Windows

# 3. Install dependencies
pip install -r requirements.txt

# 4. Configure environment
cp .env.sample .env
# Edit .env with your database URL, API keys, etc.

# 5. Create PostgreSQL database
createdb jk_maini_db

# 6. Seed database (creates tables, admin user, sample parts)
python -m app.db.seed

# 7. Start the server
uvicorn app.main:app --reload --host 0.0.0.0 --port 8000
```

API documentation is available at: `http://localhost:8000/docs`

### Default Users (from seed)

| Email               | Password  | Role  |
|---------------------|-----------|-------|
| admin@jkmaini.com   | admin123  | Admin |
| kas@jkmaini.com     | kas123    | KAS   |

> Change these passwords immediately in production.

---

## Database Schema

### Entity Relationship

```
users ──────────────────┐
                        │ created_by
emails ──┐              ▼
         │        zso_reports
         │
         ▼
    attachments
         │
         ▼
      raw_data

    maini_parts (master lookup table)
```

### Tables

| Table          | Purpose                                            |
|----------------|----------------------------------------------------|
| `users`        | User accounts with role-based access               |
| `emails`       | Fetched Gmail messages (subject, sender, body)      |
| `attachments`  | Files attached to emails, stored on disk           |
| `raw_data`     | Extracted + AI-mapped structured data (JSON)       |
| `maini_parts`  | Master parts table for matching (customer/maini #) |
| `zso_reports`  | Generated ZSO reports with calculated totals       |

---

## API Reference

### Authentication

| Method | Endpoint       | Description           | Auth     |
|--------|----------------|-----------------------|----------|
| POST   | `/auth/login`  | Login, returns JWT    | Public   |

### Users

| Method | Endpoint         | Description        | Auth         |
|--------|------------------|--------------------|--------------|
| POST   | `/users/`        | Create user        | Admin        |
| GET    | `/users/`        | List all users     | Admin        |
| GET    | `/users/me`      | Get current user   | Any          |
| GET    | `/users/{id}`    | Get user by ID     | Admin        |
| PUT    | `/users/{id}`    | Update user        | Admin        |

### Emails

| Method | Endpoint                       | Description                   | Auth        |
|--------|--------------------------------|-------------------------------|-------------|
| GET    | `/emails/`                     | List emails (paginated)       | Any         |
| GET    | `/emails/{id}`                 | Get email details             | Any         |
| POST   | `/emails/fetch`                | Fetch from Gmail              | Admin, KAS  |
| POST   | `/emails/process-email/{id}`   | Process email pipeline        | Admin, KAS  |

### Attachments

| Method | Endpoint                          | Description              | Auth |
|--------|-----------------------------------|--------------------------|------|
| GET    | `/attachments/{id}`               | Get attachment metadata   | Any  |
| GET    | `/attachments/{id}/download`      | Download file             | Any  |
| GET    | `/attachments/{id}/raw-data`      | Get extracted data        | Any  |

### ZSO Reports

| Method | Endpoint                | Description                    | Auth        |
|--------|-------------------------|--------------------------------|-------------|
| POST   | `/zso/generate`         | Generate ZSO from email        | Admin, KAS  |
| GET    | `/zso/`                 | List ZSO reports               | Any         |
| GET    | `/zso/{id}`             | Get report details             | Any         |
| POST   | `/zso/export/{id}`      | Export report as Excel          | Admin, KAS  |
| POST   | `/zso/map-columns`      | AI column mapping (standalone)  | Admin, KAS  |

---

## Processing Pipeline

The full email-to-ZSO pipeline follows these steps:

```
1. POST /emails/fetch
   └─ Connects to Gmail API
   └─ Fetches unread emails
   └─ Saves email metadata + attachments to DB and disk
   └─ Marks emails as read in Gmail

2. POST /emails/process-email/{id}
   └─ Parses each attachment (PDF/Excel/CSV/Image)
   └─ Extracts tabular data (columns + rows)
   └─ Sends column names to Claude AI for mapping
   └─ Applies mapping to transform rows into standard schema
   └─ Stores extracted_data, column_mapping, mapped_data as JSON

3. POST /zso/generate
   └─ Loads all mapped data for the email
   └─ Matches each row's "Customer Part #" against maini_parts table
   └─ Fills in maini_part_no, description, country from master
   └─ Calculates Total Price per line and Total INR
   └─ Saves ZSO report to database

4. POST /zso/export/{id}
   └─ Generates styled Excel file with Summary + Detail sheets
   └─ Returns .xlsx file for download
```

---

## AI Column Mapping

The system uses Claude AI to fuzzy-match extracted column headers to a standard schema.

**Example:**

```
Input columns:  ["Cus Part", "Qty", "Desc", "UP"]
                          ↓ Claude AI ↓
Output mapping: {
    "Cus Part": "Customer Part #",
    "Qty":      "Quantity",
    "Desc":     "Description",
    "UP":       "Unit Price"
}
```

**Standard schema columns:**
Customer Part #, Maini Part #, Description, Quantity, Unit Price, Total Price, Currency, Country, HSN Code, Delivery Date, PO Number, PO Date, Customer Name, Remarks

If the `ANTHROPIC_API_KEY` is not configured, the system falls back to a keyword-based mapping automatically.

---

## Authentication & Roles

JWT-based authentication with three roles:

| Role     | Permissions                                                  |
|----------|--------------------------------------------------------------|
| **Admin**  | Full access — user management, email fetch, processing, ZSO |
| **KAS**    | Email fetch, processing, ZSO generation and export           |
| **Viewer** | Read-only access to emails, attachments, and reports         |

**Usage:**

```bash
# Login
curl -X POST http://localhost:8000/auth/login \
  -H "Content-Type: application/json" \
  -d '{"email": "admin@jkmaini.com", "password": "admin123"}'

# Use token in subsequent requests
curl http://localhost:8000/users/me \
  -H "Authorization: Bearer <your-token>"
```

---

## Configuration

All settings are loaded from `.env` (see `.env.sample`):

| Variable                      | Description                        | Required |
|-------------------------------|------------------------------------|----------|
| `DATABASE_URL`                | PostgreSQL async connection string | Yes      |
| `SECRET_KEY`                  | JWT signing key                    | Yes      |
| `ANTHROPIC_API_KEY`           | Claude API key for AI mapping      | No*      |
| `GMAIL_CREDENTIALS_FILE`      | Path to Gmail OAuth credentials    | Yes      |
| `TESSERACT_CMD`               | Path to Tesseract OCR binary       | No**     |
| `UPLOAD_DIR`                  | Directory for storing attachments  | No       |
| `ACCESS_TOKEN_EXPIRE_MINUTES` | JWT token expiry (default: 60)     | No       |

\* Falls back to keyword-based mapping if not set.
\** Required only for image/OCR processing.

---

## License

Proprietary — JK Maini Group. All rights reserved.
