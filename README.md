# archaeo-pro

Tool for Italian archaeologists to compile **sorveglianze archeologiche** end-to-end:
record on-site (offline, on a phone), pull authoritative context from
**Vincoli in Rete**, **ISPRA / CARG**, and the **Geoportale Nazionale**, attach
photos, and emit a Sovrintendenza-ready **DOCX + PDF** — while structuring the
data so it can also be exported to **OpenHistoryMap**.

## Storage model

There is no central database. Each archaeologist signs in with GitHub; their
data lives in **their own** GitHub repos:

- `archaeo-pro-index` — one private repo per user, holds the index of all
  surveillances (one JSON file per surveillance entry, merge-friendly).
- `archaeo-pro-{uuid}` — one private repo per surveillance, holds the full
  structured data (`surveillance.json`, `findings/`, `units/`, `photos/`).
  Photo binaries are uploaded as assets of a `data` Release on the same repo,
  keeping the git history light.

The backend keeps **no state**: it only proxies WMS upstreams (CORS) and
renders DOCX/PDF from a posted snapshot.

## Stack

| Layer       | Tech                                                            |
| ----------- | --------------------------------------------------------------- |
| Frontend    | Angular 21 PWA · MapLibre GL JS · Dexie (offline scratch)       |
| Auth        | GitHub OAuth · PKCE flow entirely in the PWA                    |
| Storage     | GitHub Repos + Releases (per-user index + per-surveillance)     |
| Backend     | FastAPI · python-docx · LibreOffice headless (stateless)        |
| Maps        | Backend WMS proxy → Vincoli in Rete, ISPRA, PCN                 |
| Export      | OHM-ready GeoJSON staged in the surveillance repo               |

## Quick start

```bash
cp .env.example .env   # set GITHUB_CLIENT_ID after registering an OAuth App
docker compose up --build
```

Then:

- API:        http://localhost:8000  (Swagger: /docs)
- Frontend:   http://localhost:4200

The first frontend run installs npm deps inside the container and runs
`ng serve`.

## GitHub OAuth setup (one-time)

1. https://github.com/settings/developers → New OAuth App
2. Application name: `archaeo-pro (dev)`
3. Homepage URL: `http://localhost:4200`
4. Authorization callback URL: `http://localhost:4200/auth/callback`
5. Copy the Client ID into `.env` as `GITHUB_CLIENT_ID`. (No client secret —
   the PWA uses PKCE.)

## Project layout

```
backend/        FastAPI app — stateless, /wms/* proxy + /documents/{docx,pdf}
frontend/       Angular 21 PWA (storage layer talks directly to GitHub)
docs/           Architecture notes
```

## Status

v1 is field-first, single-archaeologist, GitHub-as-storage. OHM index publish
and GCX public-repo export are deferred (the local `exports/ohm.geojson` is
generated either way). See `docs/architecture.md`.
