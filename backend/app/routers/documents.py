from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from fastapi.responses import FileResponse
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.docgen import render_docx
from app.services.pdf import PdfConversionError, docx_to_pdf

router = APIRouter(prefix="/documents", tags=["documents"])


@router.get("/{surveillance_id}/docx")
def get_docx(surveillance_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    try:
        path = render_docx(db, surveillance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    return FileResponse(
        path,
        media_type="application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        filename="sorveglianza.docx",
    )


@router.get("/{surveillance_id}/pdf")
def get_pdf(surveillance_id: UUID, db: Session = Depends(get_db)) -> FileResponse:
    try:
        docx_path = render_docx(db, surveillance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
    try:
        pdf_path = docx_to_pdf(docx_path)
    except PdfConversionError as exc:
        raise HTTPException(status_code=503, detail=str(exc)) from exc
    return FileResponse(pdf_path, media_type="application/pdf", filename="sorveglianza.pdf")
