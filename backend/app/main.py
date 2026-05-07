import httpx
from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import documents, github_auth, wms_proxy

app = FastAPI(
    title="archaeo-pro API",
    version="0.2.0",
    description=(
        "Stateless backend for archaeo-pro. The PWA stores everything in the user's "
        "GitHub repos; this service only proxies WMS upstreams and renders DOCX/PDF "
        "from a posted surveillance payload."
    ),
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=False,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(wms_proxy.router)
app.include_router(documents.router)
app.include_router(github_auth.router)


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}


@app.get("/health/pdf")
async def pdf_health() -> dict:
    """Liveness check for the Gotenberg PDF microservice.

    The PWA hits this before requesting a PDF render so we surface a
    useful error up front instead of letting the user wait through a
    DOCX render that ends in a 503 from /documents/pdf.
    """
    if not settings.gotenberg_url:
        return {"available": False, "reason": "GOTENBERG_URL not configured"}

    auth = None
    if settings.gotenberg_user and settings.gotenberg_password:
        auth = (settings.gotenberg_user, settings.gotenberg_password)

    url = settings.gotenberg_url.rstrip("/") + "/health"
    timeout = httpx.Timeout(connect=3.0, read=5.0, write=3.0, pool=3.0)
    try:
        async with httpx.AsyncClient(timeout=timeout, auth=auth) as client:
            r = await client.get(url)
    except httpx.HTTPError as exc:
        return {"available": False, "reason": f"unreachable: {exc.__class__.__name__}"}

    if r.status_code != 200:
        return {"available": False, "reason": f"gotenberg returned {r.status_code}"}
    return {"available": True}
