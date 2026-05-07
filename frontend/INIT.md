# Frontend bootstrap (one-time)

Angular 21 needs to be initialized inside this directory before `ng serve`
will work. The Docker compose `frontend` service runs `npm install` automatically
once a `package.json` exists, so the steps below only need to be done once.

## Option A — bootstrap inside Docker (recommended; no host Node needed)

From the repo root:

```bash
docker run --rm -it -v "$PWD/frontend":/app -w /app node:20-alpine sh -c \
  'npm i -g @angular/cli@21 && ng new archaeo-pro \
      --directory=. \
      --routing \
      --style=scss \
      --ssr=false \
      --skip-git \
      --package-manager=npm \
      --strict'
```

Then enable PWA / service worker support:

```bash
docker run --rm -it -v "$PWD/frontend":/app -w /app node:20-alpine sh -c \
  'npx ng add @angular/pwa --project archaeo-pro --skip-confirmation'
```

Add the runtime libraries we need:

```bash
docker run --rm -it -v "$PWD/frontend":/app -w /app node:20-alpine sh -c \
  'npm i maplibre-gl dexie'
```

## Option B — bootstrap on the host (needs Node 20+)

```bash
cd frontend
npm i -g @angular/cli@21
ng new archaeo-pro --directory=. --routing --style=scss --ssr=false --skip-git
ng add @angular/pwa --project archaeo-pro --skip-confirmation
npm i maplibre-gl dexie
```

## After bootstrap

The shapes we want to land:

```
frontend/
  src/
    app/
      app.routes.ts                  list, new, detail
      core/
        api/api.service.ts           HTTP client → backend (/surveillances, /photos, /wms/*)
        db/offline-db.ts             Dexie schema (queued surveillances + photos)
        sync/sync.service.ts         Push queued changes when online
      features/
        surveillances/
          list/                      ng-component
          new/                       form, GPS auto-fill
          detail/                    edit + photos + map + "Genera DOCX/PDF"
        map/
          map.component.ts           MapLibre GL, layer panel for /wms/sources
    manifest.webmanifest             archaeo-pro identity for PWA install
    ngsw-config.json                 cache map tiles + app shell
```

Once `ng new` has run, ask Claude to drop in those modules — the backend
is already wired to receive them.
