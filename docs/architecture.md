# Architecture

## Data flow

```
   ┌──────────────────────────────────────────────────────────────────┐
   │             Angular 21 PWA (field, offline-aware)                │
   │  GitHub PKCE login  ─►  localStorage token  ─►  GitHub API       │
   │  GPS · camera · MapLibre GL JS · client-side photo resize        │
   └──┬───────────────────────┬──────────────────┬────────────────────┘
      │ direct (user token)   │ relative URLs    │ relative URLs
      ▼                       ▼                  ▼
  ┌─────────────────┐   ┌──────────────────────────────────────────┐
  │  GitHub         │   │  Netlify (PWA host + reverse proxy)      │
  │                 │   │  archaeo.pro / archeo.pro 301 fix        │
  │  archaeo-pro-   │   └──────────────┬───────────────────────────┘
  │   index (priv)  │                  │ /wms /documents /auth proxy
  │  archaeo-pro-   │                  ▼
  │   {uuid} (priv) │   ┌──────────────────────────────────────────┐
  │  + Release      │   │  Vercel  (FastAPI ASGI function)         │
  │   asset photos  │   │   /wms/{source}  → Vincoli / ISPRA / PCN │
  │                 │   │   /auth/github/exchange   (OAuth relay)  │
  │                 │   │   /documents/docx  (python-docx)         │
  └─────────────────┘   │   /documents/pdf   ──────────┐           │
                        └──────────────────────────────┼───────────┘
                                                       │ DOCX over HTTPS
                                                       │ + basic auth
                                                       ▼
                                ┌──────────────────────────────────┐
                                │  Self-hosted Gotenberg           │
                                │  pdf.archaeo.pro (Caddy → :3000) │
                                │  LibreOffice + Chromium          │
                                └──────────────────────────────────┘
```

Storage and auth are 100% client-side against GitHub. The Vercel API is
stateless: it sees a SurveillancePayload + photo bytes for rendering, and
forgets. PDF rendering is delegated to a self-hosted Gotenberg container —
LibreOffice can't live on Vercel, so it lives on a small VPS we run.

## Repo layout — per archaeologist

`archaeo-pro-index` (private, one per user, auto-created on first login):

```
surveillances/
  <id>.json             # one per surveillance: title, comune, bbox, repo_url, status, ohm_published
profile.json            # name, sabap office contact, signature image asset URL, etc.
README.md
.archaeo-pro/version
```

One file per entry so two devices editing different surveillances never
collide on the index.

## Repo layout — per surveillance

`archaeo-pro-{uuid}` (private by default, one per surveillance):

```
surveillance.json           # root: protocollo, committente, dates, free-form sections
area.geojson                # the watched polygon in EPSG:4326
findings/
  <finding-id>.geojson      # GeoJSON Feature with properties.tags (OSM-style) and dates
units/
  <finding-id>/
    us-001.json
    us-002.json
photos/
  <photo-id>.json           # caption + EXIF + GPS + asset_url (points to the Release asset)
exports/
  sorveglianza.docx         # last rendered Sovrintendenza document
  sorveglianza.pdf
  ohm.geojson               # OHM-staged form (publish to OHM index is a separate, manual step)
README.md                   # human-readable overview, browseable on github.com
.archaeo-pro/version
```

Photo binaries are uploaded as **Release assets** on a release tagged `data`
of this same repo. The repo's git history stays small; the assets are fetched
by URL with the user's token when needed.

## Why one-file-per-entity

The PWA is field-first and may be edited offline on multiple devices.
Single-blob JSON would conflict on every push; one-file-per-finding /
per-photo / per-unit collapses conflicts to "you both edited the same
finding", which is rare and trivially resolvable.

## Why no central DB

Archaeologists own their own data; the Sovrintendenza submission already lives
on disk; git history gives free audit trail; the application is essentially a
structured editor over a directory of JSON. A backend DB would be redundant
state and a hosting burden.

The cost is that cross-survey queries (search, map of all surveys) require
reading the index repo. That's fine for a single archaeologist's worth of
data; if a multi-user / studio model lands later, an index service can be
added without disturbing the per-survey repos.

## Offline-first

GitHub is the system of record, but the app never talks to it directly for
data. Every read and write goes through a device-local mirror in IndexedDB
(Dexie), in `frontend/src/app/core/offline/`:

- **`RepoFs`** — the file API the stores use (read, list, write, delete,
  binaries). Writes land in the mirror at once. Reads refresh a repo from
  GitHub when online and the copy is older than a minute (one
  `git/trees/HEAD?recursive=1` request plus one request per changed text
  file); offline they are served from the mirror. Photos and tavole are
  fetched on first view and then kept.
- **`SyncService`** — drains the outbox to GitHub in the order the edits were
  made: on reconnect, every 30 s, when the app returns to the foreground, and
  shortly after each edit. Repeated edits to one file become one commit. A
  surveillance created offline gets its repo created (empty) by the first
  sync, before its files are pushed.
- **Conflicts** — if a file changed on GitHub while a local edit was waiting,
  the remote version is saved in the `conflicts` table and the field edit
  wins. Nothing is discarded; the top-bar badge counts the saved versions.
  (No UI to compare them yet.)
- **App shell** — the Angular service worker (`ngsw-config.json`, production
  web builds only, not in Tauri) caches the app and the WMS tiles already
  viewed (30 days, 4,000 tiles), so the PWA opens and shows the last-seen
  map in the field. Areas never viewed online have no basemap offline.

What needs a connection: the first login, the first opening of the index and
of each surveillance on a device, DOCX/PDF rendering, and WMS areas not
already viewed.

## OHM export

`exports/ohm.geojson` is a FeatureCollection of the surveillance's findings
with OSM-style tags + temporal extents. Two follow-up actions (deferred):

- **Export to OHM** — registers the surveillance in OHM's data index.
- **Publish GeoContext** — pushes the GCX form to a public repository.

Both are manual, opt-in, and operate on the already-generated
`exports/ohm.geojson`.
