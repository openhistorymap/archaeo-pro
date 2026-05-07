# Architecture

## Data flow

```
              ┌─────────────────────────────────────────────────────────┐
              │                Angular 21 PWA (field)                   │
              │  GPS + Camera + offline IndexedDB (Dexie)               │
              │  MapLibre GL JS overlays via /wms/{source}              │
              └────────────────────┬────────────────────────────────────┘
                                   │ REST + multipart
                                   ▼
              ┌─────────────────────────────────────────────────────────┐
              │                FastAPI backend                          │
              │  /surveillances  CRUD                                   │
              │  /photos         upload + EXIF parse                    │
              │  /wms/{source}   proxy to upstream WMS                  │
              │  /documents/{id} render DOCX → LibreOffice → PDF        │
              │  /ohm/{id}       OHM-ready GeoJSON export               │
              └────────┬────────────────────┬───────────────────────────┘
                       │                    │
                       ▼                    ▼
                ┌──────────┐       ┌────────────────────────┐
                │ Postgres │       │  Upstream WMS:         │
                │ + PostGIS│       │  - Vincoli in Rete     │
                │          │       │  - ISPRA / CARG        │
                └──────────┘       │  - Geoportale Nazionale│
                                   └────────────────────────┘
```

## Domain model (v1)

A **Surveillance** (`sorveglianza`) is the root aggregate. It owns:

- a project geometry (polygon — the watched area)
- one or more **Findings** (`evidenze archeologiche`) — each a point/polygon with
  date range, materials, interpretation
- one or more **Stratigraphic Units** (`UU.SS.`) attached to findings
- an ordered list of **Photos** with EXIF + GPS + orientation
- a header (committente, direttore tecnico SABAP, normativa, comune, foglio
  catastale)

The Findings + their tags are what we serialize to OpenHistoryMap. The whole
aggregate plus the photos and WMS-rendered map clips are what we serialize to
the Sovrintendenza DOCX.

## Why a WMS proxy

The three official Italian sources block CORS and (for PCN) require referrer
headers. A thin server-side proxy fixes that, lets us cache GetCapabilities,
and lets the PWA pre-cache tiles for offline field use against a stable URL.

## OHM export

OpenHistoryMap consumes OSM-style tagging with temporal extents (`start_date`,
`end_date`). The exporter emits a GeoJSON FeatureCollection with:

- `properties.start_date` / `properties.end_date` (ISO 8601 partial OK)
- `properties.tags` — OSM-style key/value pairs (e.g. `historic=archaeological_site`,
  `site_type=settlement`, `period=roman`)
- `properties.source` set to the surveillance ID + protocollo

Format may evolve to OSM XML; gated behind a config flag.
