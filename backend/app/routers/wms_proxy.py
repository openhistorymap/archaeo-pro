"""Thin WMS proxy.

Forwards GetCapabilities / GetMap / GetFeatureInfo to the configured upstream,
strips/replaces headers as required, and lets the PWA cache tiles via service
worker against a stable URL on our own origin.

This is *not* a full WMS facade — it's a transparent passthrough with allowlisted
sources. Query string is forwarded verbatim (after re-encoding).
"""
from urllib.parse import urlencode

import httpx
from fastapi import APIRouter, HTTPException, Request, Response

from app.services.wms import SOURCES, get_source

router = APIRouter(prefix="/wms", tags=["wms"])

_TIMEOUT = httpx.Timeout(connect=5.0, read=30.0, write=10.0, pool=5.0)


@router.get("/sources")
def list_sources() -> list[dict]:
    """Catalog used by the PWA layer panel."""
    return [
        {"id": s.id, "label": s.label, "default_layers": list(s.default_layers)}
        for s in SOURCES.values()
    ]


@router.get("/{source_id}")
async def proxy(source_id: str, request: Request) -> Response:
    source = get_source(source_id)
    if source is None:
        raise HTTPException(status_code=404, detail=f"Unknown WMS source '{source_id}'")

    # Forward query params as-is; clients pass the standard WMS params.
    params = dict(request.query_params)
    upstream_url = f"{source.url}?{urlencode(params, doseq=True)}"

    async with httpx.AsyncClient(timeout=_TIMEOUT, follow_redirects=True) as client:
        try:
            r = await client.get(upstream_url, headers=source.headers)
        except httpx.HTTPError as exc:
            raise HTTPException(status_code=502, detail=f"Upstream WMS error: {exc}") from exc

    # Pass through content + content-type; let the browser cache via SW.
    headers = {"Cache-Control": "public, max-age=86400"}
    if "content-type" in r.headers:
        headers["Content-Type"] = r.headers["content-type"]
    return Response(content=r.content, status_code=r.status_code, headers=headers)
