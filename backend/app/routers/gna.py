"""Template GNA export (Geoportale Nazionale per l'Archeologia).

  GET  /gna/vocab/{name}  a GNA controlled vocabulary, proxied (the Ministry's
                          server sends no CORS headers) and cached
  POST /gna/check         what the template and the GNA plugin would reject
  POST /gna/package       the official template, filled, as a ZIP

Both POSTs take the same JSON SurveillancePayload the PWA already builds for
the DOCX, with its `gna`, `gna_dsc`, `area` and per-finding `gna` blocks.
"""
from fastapi import APIRouter, HTTPException
from fastapi.responses import FileResponse, JSONResponse

from app.payloads import SurveillancePayload
from app.services import gna_export, gna_sources

router = APIRouter(prefix="/gna", tags=["gna"])

# Vocabularies the PWA's GNA form uses. Anything else is refused, so the
# proxy can't be pointed at arbitrary paths on the Ministry's server.
VOCABULARIES = {
    "AMA", "CTG", "OGT_MOPR", "ENTE", "FUR", "Regioni_tb", "Province_tb", "Comuni_tb",
    "GPT", "GPM", "GPBB", "DSCM", "DSCEX", "OGD", "OGT", "OGB", "DTR", "FNTP", "OGM",
}


@router.get("/vocab/{name}")
async def vocab(name: str) -> JSONResponse:
    if name not in VOCABULARIES:
        raise HTTPException(status_code=404, detail="Vocabolario non disponibile")
    try:
        data = await gna_sources.vocabulary(name)
    except gna_sources.GnaSourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return JSONResponse(data, headers={"Cache-Control": "public, max-age=86400"})


@router.post("/check")
async def check(payload: SurveillancePayload) -> dict:
    try:
        issues = await gna_export.check(payload)
    except gna_sources.GnaSourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return {
        "ok": not any(i.level == "errore" for i in issues),
        "issues": [i.as_dict() for i in issues],
    }


@router.post("/package")
async def package(payload: SurveillancePayload):
    try:
        path, _warnings = await gna_export.build_package(payload)
    except gna_export.GnaValidationError as exc:
        return JSONResponse(
            status_code=422,
            content={"ok": False, "issues": [i.as_dict() for i in exc.issues]},
        )
    except gna_sources.GnaSourceError as exc:
        raise HTTPException(status_code=502, detail=str(exc)) from exc
    return FileResponse(path, media_type="application/zip", filename=path.name)
