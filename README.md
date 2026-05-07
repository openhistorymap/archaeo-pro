# archaeo-pro

Tool for Italian archaeologists to compile **sorveglianze archeologiche** end-to-end:
record on-site (offline, on a phone), pull authoritative context from
**Vincoli in Rete**, **ISPRA / CARG**, and the **Geoportale Nazionale**, attach
photos, and emit a Sovrintendenza-ready **DOCX + PDF** — while structuring the
data so it can also be exported to **OpenHistoryMap**.

## Stack

| Layer       | Tech                                                    |
| ----------- | ------------------------------------------------------- |
| Frontend    | Angular 21 PWA, MapLibre GL JS, Dexie (IndexedDB)       |
| Backend     | FastAPI + SQLAlchemy 2 + GeoAlchemy2                    |
| Database    | PostgreSQL 16 + PostGIS 3.4                             |
| DocGen      | python-docx + LibreOffice headless (DOCX → PDF)         |
| Maps        | WMS proxy → Vincoli in Rete, ISPRA, PCN                 |
| Export      | OHM-ready GeoJSON                                       |

## Quick start (Docker)

```bash
cp .env.example .env
docker compose up --build
```

Then:

- API:        http://localhost:8000  (Swagger: /docs)
- Frontend:   http://localhost:4200

The first frontend run installs npm deps inside the container and
runs `ng serve`. See [`frontend/INIT.md`](frontend/INIT.md) for the
one-time `ng new` bootstrap.

## Project layout

```
backend/        FastAPI app (functional skeleton — surveillance CRUD,
                WMS proxy, docgen, OHM export)
frontend/      Angular 21 PWA (bootstrap instructions in INIT.md)
docs/           Architecture notes
```

## Development on the host (without Docker)

Backend:
```bash
cd backend
uv sync
uv run alembic upgrade head
uv run uvicorn app.main:app --reload
```

Frontend (needs Node 20+):
```bash
cd frontend
npm install
npx ng serve
```

## Status

v1 is field-first, single-archaeologist. Multi-user, regional WMS sources, and
PEC/firma digitale submission are deferred. See `docs/architecture.md`.
