# archaeo-pro

Tool for Italian archaeologists to compile **sorveglianze archeologiche** end-to-end:
record on-site (offline, on a phone), pull authoritative context from
**Vincoli in Rete**, **ISPRA / CARG**, and the **Geoportale Nazionale**, attach
photos, and emit a Sovrintendenza-ready **DOCX + PDF** — while structuring the
data so it can also be exported to **OpenHistoryMap**.

## Deployment topology

```
                                ┌─────────────────────┐
        archaeo.pro ─────────►  │  Netlify (PWA)      │
        archeo.pro  301 →       └──────────┬──────────┘
                                           │   reverse-proxy
                                           │   /wms /documents /auth /health
                                           ▼
                                ┌─────────────────────┐
                                │  Vercel (FastAPI)   │
                                │  WMS proxy          │
                                │  OAuth relay        │
                                │  DOCX render        │
                                │  PDF render ─┐      │
                                └──────────────┼──────┘
                                               │  HTTPS + basic auth
                                               ▼
                                ┌─────────────────────┐
                                │  Self-hosted server │
                                │  Gotenberg (DOCX→PDF)│
                                │  pdf.archaeo.pro    │
                                └─────────────────────┘

   Storage: each archaeologist's GitHub account — archaeo-pro-index +
            archaeo-pro-{uuid} per surveillance, photos on Releases.
            The backend never sees a token.
```

## Stack

| Layer       | Tech                                                            |
| ----------- | --------------------------------------------------------------- |
| Frontend    | Angular 21 PWA · MapLibre GL JS · Dexie (offline scratch)       |
| Auth        | GitHub OAuth · PKCE flow entirely in the PWA                    |
| Storage     | GitHub Repos + Releases (per-user index + per-surveillance)     |
| API         | FastAPI on Vercel · python-docx for DOCX                        |
| PDF         | Gotenberg container (self-hosted)                               |
| Frontend    | Netlify static site + reverse-proxy to API                      |

## Local development

```bash
cp .env.example .env
docker compose up --build
```

Brings up three containers on a shared docker network:

- `gotenberg` — DOCX → PDF rendering (no auth in dev)
- `api` — FastAPI (mirrors the Vercel deployment, includes a uvicorn dev server)
- `frontend` — Angular dev server with proxy.conf forwarding `/wms`,
  `/documents`, `/auth`, `/health` to `api:8000`

Then:

- PWA:        http://localhost:4200
- API:        http://localhost:8000  (Swagger: /docs)

### GitHub OAuth (one-time)

Create a **dev** OAuth App at https://github.com/settings/developers:

- Application name: `archaeo-pro (dev)`
- Homepage URL: `http://localhost:4200`
- Authorization callback URL: `http://localhost:4200/auth/callback`

Copy the Client ID into `frontend/src/environments/environment.ts` as
`githubClientId`.

For production, create a second OAuth App with callback
`https://archaeo.pro/auth/callback` and put its Client ID in Netlify's
`GITHUB_CLIENT_ID_PROD` env var.

## Production deployment

### 1. Self-hosted Gotenberg

```bash
cd pdf-service
cp .env.example .env  # set a real password
docker compose up -d
# Front with Caddy/nginx → https://pdf.archaeo.pro
```

See [`pdf-service/README.md`](pdf-service/README.md) for details.

### 2. Vercel (API)

- Create a Vercel project pointing at `backend/` as the root.
- Set env vars:
  - `CORS_ORIGINS` = `https://archaeo.pro,https://archeo.pro,https://www.archaeo.pro`
  - `GOTENBERG_URL` = `https://pdf.archaeo.pro`
  - `GOTENBERG_USER` / `GOTENBERG_PASSWORD` matching the Gotenberg deploy
- Vercel auto-detects the Python runtime from `backend/requirements.txt` and
  the `api/index.py` entrypoint via `backend/vercel.json`.

### 3. Netlify (frontend)

- Create a Netlify site pointing at this repo; Netlify reads
  `frontend/netlify.toml` for build + redirects.
- Set env vars:
  - `GITHUB_CLIENT_ID_PROD` = production OAuth App Client ID
  - `API_URL` = `https://<your-vercel-app>.vercel.app`
- Add the custom domains `archaeo.pro` (primary) and `archeo.pro`
  (Netlify will 301-redirect it via the netlify.toml rule).

## Project layout

```
backend/        FastAPI app — Vercel-ready (api/index.py + requirements.txt)
frontend/       Angular 21 PWA — Netlify-ready (netlify.toml)
pdf-service/    Gotenberg container — self-hosted PDF microservice
docs/           Architecture notes
```

## Status

v1 is field-first, single-archaeologist, GitHub-as-storage. OHM index publish
and GCX public-repo export are deferred (`exports/ohm.geojson` is generated
locally either way). See `docs/architecture.md`.
