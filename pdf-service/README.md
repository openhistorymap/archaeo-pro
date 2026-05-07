# pdf-service — Gotenberg for archaeo-pro

Why it exists: Vercel cannot run LibreOffice (no apt-install, function size
cap), so DOCX→PDF conversion is delegated to a small dedicated service.
[Gotenberg](https://gotenberg.dev/) wraps LibreOffice + a stable HTTP API,
which is exactly what we need.

## Deploying

Run on the host that fronts `archaeo.pro` (or any public-internet box
reachable from Vercel).

```bash
cd pdf-service
cp .env.example .env
# Edit GOTENBERG_USER / GOTENBERG_PASSWORD — pick a long random password.
docker compose up -d
```

The container binds **only to 127.0.0.1**. Front it with a TLS-terminating
reverse proxy (Caddy is recommended for its automatic Let's Encrypt) on
e.g. `https://pdf.archaeo.pro`:

```caddy
pdf.archaeo.pro {
  reverse_proxy 127.0.0.1:3000
}
```

## Wiring the API

In Vercel's environment variables for the archaeo-pro API project, set:

| name                 | value                                |
| -------------------- | ------------------------------------ |
| `GOTENBERG_URL`      | `https://pdf.archaeo.pro`            |
| `GOTENBERG_USER`     | matching `.env` GOTENBERG_USER       |
| `GOTENBERG_PASSWORD` | matching `.env` GOTENBERG_PASSWORD   |

Redeploy. `POST /documents/pdf` will now render and return PDFs.

## Local dev

You don't need this folder to be running for local dev — the project's
top-level `docker-compose.yml` already brings up a Gotenberg sidecar on the
same docker network as the API.

## Notes

- Gotenberg 8 requires no DB or external state.
- `API_TIMEOUT=120s` allows large reports to render without timing out;
  bump if you have giant photo dumps.
- Memory ceiling is 1 GB; LibreOffice + Chromium can spike. Tune via
  `mem_limit` in `docker-compose.yml` if you have headroom.
