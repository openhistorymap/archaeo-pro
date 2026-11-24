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

## Team work

A surveillance is shared through GitHub's own collaborators on its repo; no
server keeps any of it.

- **Roles** are GitHub permissions: *amministratore* (admin: invites people,
  owns visibility), *collaboratore* (push), *lettura* (pull). The surveillance
  page's "Collaboratori" block, for administrators, invites by GitHub username
  and removes people or pending invitations.
- **Invitations** are listed and answered on the register page.
- **"Condivise con me"**: repos with the `archaeo-pro-` prefix where the user
  is a collaborator, mixed into the register and cached in the `shared`
  table for offline use. A collaborator's saves never touch the owner's
  index (they have no access to it); the owner's index catches up when the
  owner saves.
- **Read-only** users get the role recorded per repo in the mirror, and
  `RepoFs` refuses writes on the device, so nothing queues that GitHub would
  reject later.
- **Attribution** is the commit history: every edit is a commit by whoever
  made it.

**Merging.** Every mirrored text file keeps `base`, the last version GitHub
and this device agreed on. When a push finds the file changed on GitHub,
`sync.service` merges the two JSON versions against that base, field by field
(`offline/merge.ts`): lists of records with an identity (`presenze` by name,
findings by id…) merge record by record; `updated_at` takes the later value.
Clean merges are pushed silently. A field changed on both sides keeps this
device's value and becomes a conflict, listed on `/conflitti` (the top-bar
badge links there) with both values, to keep or swap. Files that can't be
merged (photos, non-JSON, or files mirrored before `base` existed and not yet
refreshed) keep the local version and save the remote one whole, as before.

## Template GNA export

Under DG ABAP circulars 9/2024 and 22/2024 the minimum data of every
investigation authorised by the MiC go to the Geoportale Nazionale per
l'Archeologia, *assistenza archeologica in corso d'opera* included. For GNA a
sorveglianza is AMA = 2, and the Template GNA 1.6 needs:

- **MOPR** — the project: the surveillance area, with CPR (which includes the
  personal code ICA issues on request), Soprintendenza, officers, category and
  type of works, ISTAT codes, positioning method;
- **DSC** — every investigated area, positive or negative, with the maximum
  depth reached (mandatory from 2024);
- **MOSI** — one record per finding (polygons for new excavation data).

The page `surveillances/:id/gna` collects only what the template needs beyond
the rest of the surveillance. It is saved with it: `gna` and `gna_dsc` in
`surveillance.json`, each finding's `gna` block in its GeoJSON properties.

The backend (`app/routers/gna.py`, `app/services/gna_*.py`):

- proxies the GNA vocabularies (`/gna/vocab/{name}`; the Ministry's server
  sends no CORS headers), cached for a day and by the service worker;
- checks the data against the template's own constraints (`/gna/check`) and
  answers in Italian;
- downloads the official template ZIP once (`GNA_TEMPLATE_URL`), fills its
  GeoPackage with plain `sqlite3` (geometry encoding and the ST_* functions
  the R-tree triggers need are in `gna_gpkg.py`, no GDAL) and returns the
  whole folder (`/gna/package`) with a LEGGIMI.txt.

Delivery stays manual on purpose: data only enter GNA through the QGIS GNA
plugin, which also requires downloading the existing GNA records first
(«Avvia importazione»). The archaeologist opens the `.qgz`, checks the
forms and presses «Invia».

Not covered yet: DSC geometries other than the surveillance area (no drawing
tool for separate trenches), point and line DSC, images in MOSI, the VPIA
layers (VRP/VRD, RCG), which a surveillance does not use.

## GeoContext map

The "GeoContext" button on a surveillance writes, through the offline queue:

```
geocontext.json               the descriptor (title, centre, layers, detail panel)
geocontext/findings.geojson   one feature per drawn finding, with its first detail photo
geocontext/area.geojson       the watched area
```

GeoContext (`openhistorymap.org/geocontext-front/<owner>/<repo>/map`) reads
these through jsDelivr, which serves **public** repositories only. The
surveillance repos are private by default, so the map only works once the
archaeologist makes the repo public on GitHub, which publishes everything in
it (locations, giornale, photos, names). The app checks the visibility and
says so; it never changes it. Press the button again to refresh the files.

## OHM export

Deferred: **Export to OHM** — register the surveillance's findings (OSM-style
tags + temporal extents) in OHM's data index. Manual and opt-in.
