"""DOCX → PDF via Gotenberg.

Gotenberg is a small headless service that wraps LibreOffice; we run a copy
on a server outside Vercel (which can't host LibreOffice). The API calls
Gotenberg over HTTP with basic auth.

In local dev, docker-compose brings up Gotenberg alongside the API. In prod,
GOTENBERG_URL points to the public Gotenberg deployment (see pdf-service/).
"""
from __future__ import annotations

from pathlib import Path

import httpx

from app.config import settings


class PdfConversionError(RuntimeError):
    pass


_GOTENBERG_PATH = "/forms/libreoffice/convert"
_TIMEOUT = httpx.Timeout(connect=10.0, read=120.0, write=30.0, pool=10.0)


async def docx_to_pdf(docx_path: Path) -> Path:
    if not docx_path.is_file():
        raise FileNotFoundError(docx_path)
    if not settings.gotenberg_url:
        raise PdfConversionError(
            "GOTENBERG_URL is not configured. Point it at a Gotenberg deployment."
        )

    auth: tuple[str, str] | None = None
    if settings.gotenberg_user and settings.gotenberg_password:
        auth = (settings.gotenberg_user, settings.gotenberg_password)

    pdf_path = docx_path.with_suffix(".pdf")
    url = settings.gotenberg_url.rstrip("/") + _GOTENBERG_PATH

    with docx_path.open("rb") as f:
        files = {"files": (docx_path.name, f, "application/vnd.openxmlformats-officedocument.wordprocessingml.document")}
        try:
            async with httpx.AsyncClient(timeout=_TIMEOUT, auth=auth) as client:
                r = await client.post(url, files=files)
        except httpx.HTTPError as exc:
            raise PdfConversionError(f"Gotenberg unreachable: {exc}") from exc

    if r.status_code >= 400:
        raise PdfConversionError(
            f"Gotenberg returned {r.status_code}: {r.text[:300]}"
        )

    pdf_path.write_bytes(r.content)
    return pdf_path
