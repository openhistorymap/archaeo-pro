from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException
from sqlalchemy.orm import Session

from app.db import get_db
from app.services.ohm import export_geojson

router = APIRouter(prefix="/ohm", tags=["ohm"])


@router.get("/{surveillance_id}.geojson")
def export(surveillance_id: UUID, db: Session = Depends(get_db)) -> dict:
    try:
        return export_geojson(db, surveillance_id)
    except ValueError as exc:
        raise HTTPException(status_code=404, detail=str(exc)) from exc
