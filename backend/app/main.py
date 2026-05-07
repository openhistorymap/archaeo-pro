from contextlib import asynccontextmanager

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routers import documents, ohm_export, photos, surveillances, wms_proxy


@asynccontextmanager
async def lifespan(_: FastAPI):
    # Hook point for startup tasks (warm WMS GetCapabilities cache, etc.)
    yield


app = FastAPI(
    title="archaeo-pro API",
    version="0.1.0",
    description=(
        "Backend for Italian archaeological-surveillance reports. "
        "Records sorveglianze, proxies authoritative WMS layers (Vincoli in Rete, "
        "ISPRA, PCN), generates Sovrintendenza DOCX/PDF, and exports to OpenHistoryMap."
    ),
    lifespan=lifespan,
)

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origin_list,
    allow_credentials=True,
    allow_methods=["*"],
    allow_headers=["*"],
)

app.include_router(surveillances.router)
app.include_router(photos.router)
app.include_router(wms_proxy.router)
app.include_router(documents.router)
app.include_router(ohm_export.router)

# Serve uploaded photos so the PWA can re-render them in the report preview.
app.mount("/uploads", StaticFiles(directory=str(settings.uploads_dir)), name="uploads")


@app.get("/health")
def health() -> dict[str, str]:
    return {"status": "ok"}
