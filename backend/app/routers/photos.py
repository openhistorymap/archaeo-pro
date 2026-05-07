from datetime import datetime
from io import BytesIO
from uuid import UUID, uuid4

from exif import Image as ExifImage
from fastapi import APIRouter, Depends, File, Form, HTTPException, Request, UploadFile, status
from geoalchemy2.elements import WKTElement
from PIL import Image
from sqlalchemy.orm import Session

from app.config import settings
from app.db import get_db
from app.models import Photo, Surveillance
from app.schemas.surveillance import PhotoOut

router = APIRouter(prefix="/surveillances/{surveillance_id}/photos", tags=["photos"])

ALLOWED_CONTENT_TYPES = {"image/jpeg", "image/png", "image/webp", "image/heic"}
MAX_PHOTO_BYTES = 25 * 1024 * 1024


def _exif_gps(raw: bytes) -> tuple[float | None, float | None, datetime | None, float | None]:
    try:
        ex = ExifImage(raw)
    except Exception:
        return None, None, None, None
    if not ex.has_exif:
        return None, None, None, None

    def _dms_to_deg(dms, ref):
        d, m, s = dms
        deg = d + m / 60 + s / 3600
        if ref in ("S", "W"):
            deg = -deg
        return deg

    lat = lon = None
    try:
        if ex.get("gps_latitude") and ex.get("gps_longitude"):
            lat = _dms_to_deg(ex.gps_latitude, ex.gps_latitude_ref)
            lon = _dms_to_deg(ex.gps_longitude, ex.gps_longitude_ref)
    except Exception:
        pass

    taken = None
    try:
        if ex.get("datetime_original"):
            taken = datetime.strptime(ex.datetime_original, "%Y:%m:%d %H:%M:%S")
    except Exception:
        pass

    bearing = None
    try:
        if ex.get("gps_img_direction") is not None:
            bearing = float(ex.gps_img_direction)
    except Exception:
        pass

    return lat, lon, taken, bearing


@router.post("", response_model=PhotoOut, status_code=status.HTTP_201_CREATED)
async def upload_photo(
    surveillance_id: UUID,
    request: Request,
    file: UploadFile = File(...),
    caption: str | None = Form(None),
    finding_id: UUID | None = Form(None),
    db: Session = Depends(get_db),
) -> PhotoOut:
    if file.content_type not in ALLOWED_CONTENT_TYPES:
        raise HTTPException(status_code=415, detail=f"Unsupported content-type {file.content_type}")

    s = db.get(Surveillance, surveillance_id)
    if s is None:
        raise HTTPException(status_code=404, detail="Surveillance not found")

    raw = await file.read()
    if len(raw) > MAX_PHOTO_BYTES:
        raise HTTPException(status_code=413, detail="Photo too large")

    # Normalize to JPEG for the report; keep original filename for traceability.
    img = Image.open(BytesIO(raw))
    img = img.convert("RGB") if img.mode != "RGB" else img

    photo_id = uuid4()
    sub = settings.uploads_dir / str(surveillance_id)
    sub.mkdir(parents=True, exist_ok=True)
    relpath = f"{surveillance_id}/{photo_id}.jpg"
    abs_path = settings.uploads_dir / relpath
    img.save(abs_path, "JPEG", quality=88)

    lat, lon, taken_at, bearing = _exif_gps(raw)

    photo = Photo(
        id=photo_id,
        surveillance_id=surveillance_id,
        finding_id=finding_id,
        filename=file.filename or f"{photo_id}.jpg",
        storage_path=relpath,
        caption=caption,
        taken_at=taken_at,
        bearing=bearing,
    )
    if lat is not None and lon is not None:
        photo.location = WKTElement(f"POINT({lon} {lat})", srid=4326)

    db.add(photo)
    db.commit()
    db.refresh(photo)

    base = str(request.base_url).rstrip("/")
    return PhotoOut(
        id=photo.id,
        filename=photo.filename,
        caption=photo.caption,
        taken_at=photo.taken_at,
        bearing=photo.bearing,
        location=None,
        url=f"{base}/uploads/{photo.storage_path}",
    )
