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

## OHM export

`exports/ohm.geojson` is a FeatureCollection of the surveillance's findings
with OSM-style tags + temporal extents. Two follow-up actions (deferred):

- **Export to OHM** — registers the surveillance in OHM's data index.
- **Publish GeoContext** — pushes the GCX form to a public repository.

Both are manual, opt-in, and operate on the already-generated
`exports/ohm.geojson`.
