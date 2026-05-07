"""Stateless DOCX/PDF rendering.

The PWA already has the surveillance JSON in hand (it stores it in the user's
GitHub repo). It posts the snapshot here as multipart:

  - field "surveillance": JSON-encoded SurveillancePayload
  - field "photos": one or more files; each filename MUST be the photo id
    referenced inside surveillance.photos[].id

The backend renders, returns the file inline, and forgets.
"""
from fastapi import APIRouter, File, Form, HTTPException, UploadFile
from fastapi.responses import FileResponse

from app.payloads import SurveillancePayload
from app.services.docgen import render_docx
from app.services.pdf import PdfConversionError, docx_to_pdf

router = APIRouter(prefix="/documents", tags=["documents"])

MAX_PHOTO_BYTES = 25 * 1024 * 1024


async def _collect_photos(uploads: list[UploadFile]) -> dict[str, bytes]:
    out: dict[str, bytes] = {}
    for up in uploads:
        if not up.filename:
            continue
        raw = await up.read()
        if len(raw) > MAX_PHOTO_BYTES:
            raise HTTPException(status_code=413, detail=f"Photo '{up.filename}' too large")
        out[up.filename] = raw
    return out


def _parse_payload(surveillance: str) -> SurveillancePayload:
    try:
        return SurveillancePayload.model_validate_json(surveillance)
    except Exception as exc:
        raise HTTPException(status_code=422, detail=f"Invalid surveillance payload: {exc}") from exc


@router.post("/docx")
async def render_docx_endpoint(
    surveillance: str = Form(...),
    photos: list[UploadFile] = File(default_factory=list),
) -> FileResponse:
    payload = _parse_payload(surveillance)
    photo_bytes = await _collect_photos(photos)
    path = render_docx(payload, photo_bytes)
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename=f"sorveglianza-{payload.id}.docx",
    )


@router.post("/pdf")
async def render_pdf_endpoint(
    surveillance: str = Form(...),
    photos: list[UploadFile] = File(default_factory=list),
) -> FileResponse:
    payload = _parse_payload(surveillance)
    photo_bytes = await _collect_photos(photos)
    docx_path = render_docx(payload, photo_bytes)
    try:
        pdf_path = docx_to_pdf(docx_path)
    except PdfConversionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return FileResponse(
        pdf_path,
        media_type="application/pdf",
        filename=f"sorveglianza-{payload.id}.pdf",
    )
