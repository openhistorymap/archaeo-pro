from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routers import documents, wms_proxy

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


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
