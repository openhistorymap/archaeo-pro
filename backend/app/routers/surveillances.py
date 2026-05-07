from uuid import UUID

from fastapi import APIRouter, Depends, HTTPException, Request, status
from geoalchemy2.elements import WKTElement
from sqlalchemy import select
from sqlalchemy.orm import Session, selectinload

from app.config import settings
from app.db import get_db
from app.models import Finding, Photo, StratigraphicUnit, Surveillance
from app.schemas import (
    FindingCreate,
    FindingOut,
    SurveillanceCreate,
    SurveillanceOut,
    SurveillanceUpdate,
)
from app.schemas.surveillance import PhotoOut, geojson_to_wkt, geom_to_geojson

router = APIRouter(prefix="/surveillances", tags=["surveillances"])


def _to_out(s: Surveillance, request: Request) -> SurveillanceOut:
    base = str(request.base_url).rstrip("/")
    photos = []
    for p in s.photos:
        photos.append(
            PhotoOut(
                id=p.id,
                filename=p.filename,
                caption=p.caption,
                taken_at=p.taken_at,
                bearing=p.bearing,
                location=geom_to_geojson(p.location),
                url=f"{base}/uploads/{p.storage_path}",
            )
        )
    return SurveillanceOut(
        id=s.id,
        title=s.title,
        protocollo=s.protocollo,
        committente=s.committente,
        direttore_tecnico=s.direttore_tecnico,
        sabap=s.sabap,
        comune=s.comune,
        provincia=s.provincia,
        foglio_catastale=s.foglio_catastale,
        particelle=s.particelle,
        normativa=s.normativa,
        start_date=s.start_date,
        end_date=s.end_date,
        premessa=s.premessa,
        metodologia=s.metodologia,
        risultati=s.risultati,
        conclusioni=s.conclusioni,
        area=geom_to_geojson(s.area),
        findings=[FindingOut.from_orm_row(f) for f in s.findings],
        photos=photos,
        created_at=s.created_at,
        updated_at=s.updated_at,
    )


def _load(db: Session, surveillance_id: UUID) -> Surveillance:
    stmt = (
        select(Surveillance)
        .where(Surveillance.id == surveillance_id)
        .options(
            selectinload(Surveillance.findings).selectinload(Finding.units),
            selectinload(Surveillance.photos),
        )
    )
    s = db.execute(stmt).scalar_one_or_none()
    if s is None:
        raise HTTPException(status_code=404, detail="Surveillance not found")
    return s


@router.post("", response_model=SurveillanceOut, status_code=status.HTTP_201_CREATED)
def create_surveillance(
    payload: SurveillanceCreate, request: Request, db: Session = Depends(get_db)
) -> SurveillanceOut:
    s = Surveillance(
        title=payload.title,
        protocollo=payload.protocollo,
        committente=payload.committente,
        direttore_tecnico=payload.direttore_tecnico,
        sabap=payload.sabap,
        comune=payload.comune,
        provincia=payload.provincia,
        foglio_catastale=payload.foglio_catastale,
        particelle=payload.particelle,
        normativa=payload.normativa,
        start_date=payload.start_date,
        end_date=payload.end_date,
        premessa=payload.premessa,
        metodologia=payload.metodologia,
        risultati=payload.risultati,
        conclusioni=payload.conclusioni,
    )
    wkt = geojson_to_wkt(payload.area)
    if wkt:
        s.area = WKTElement(wkt, srid=4326)
    db.add(s)
    db.commit()
    db.refresh(s)
    return _to_out(_load(db, s.id), request)


@router.get("", response_model=list[SurveillanceOut])
def list_surveillances(request: Request, db: Session = Depends(get_db)) -> list[SurveillanceOut]:
    stmt = select(Surveillance).options(
        selectinload(Surveillance.findings).selectinload(Finding.units),
        selectinload(Surveillance.photos),
    ).order_by(Surveillance.created_at.desc())
    rows = db.execute(stmt).scalars().all()
    return [_to_out(s, request) for s in rows]


@router.get("/{surveillance_id}", response_model=SurveillanceOut)
def get_surveillance(
    surveillance_id: UUID, request: Request, db: Session = Depends(get_db)
) -> SurveillanceOut:
    return _to_out(_load(db, surveillance_id), request)


@router.patch("/{surveillance_id}", response_model=SurveillanceOut)
def update_surveillance(
    surveillance_id: UUID,
    payload: SurveillanceUpdate,
    request: Request,
    db: Session = Depends(get_db),
) -> SurveillanceOut:
    s = _load(db, surveillance_id)
    data = payload.model_dump(exclude_unset=True)
    area = data.pop("area", None)
    for key, value in data.items():
        setattr(s, key, value)
    if area is not None:
        wkt = geojson_to_wkt(area)
        s.area = WKTElement(wkt, srid=4326) if wkt else None
    db.commit()
    db.refresh(s)
    return _to_out(_load(db, s.id), request)


@router.delete("/{surveillance_id}", status_code=status.HTTP_204_NO_CONTENT)
def delete_surveillance(surveillance_id: UUID, db: Session = Depends(get_db)) -> None:
    s = _load(db, surveillance_id)
    db.delete(s)
    db.commit()


# ---- nested findings -------------------------------------------------------

@router.post(
    "/{surveillance_id}/findings",
    response_model=FindingOut,
    status_code=status.HTTP_201_CREATED,
)
def add_finding(
    surveillance_id: UUID,
    payload: FindingCreate,
    db: Session = Depends(get_db),
) -> FindingOut:
    s = _load(db, surveillance_id)
    f = Finding(
        surveillance_id=s.id,
        name=payload.name,
        description=payload.description,
        interpretation=payload.interpretation,
        start_date=payload.start_date,
        end_date=payload.end_date,
        tags=payload.tags,
    )
    wkt = geojson_to_wkt(payload.geom)
    if wkt:
        f.geom = WKTElement(wkt, srid=4326)
    for u in payload.units:
        f.units.append(StratigraphicUnit(**u.model_dump()))
    db.add(f)
    db.commit()
    db.refresh(f)
    return FindingOut.from_orm_row(f)
