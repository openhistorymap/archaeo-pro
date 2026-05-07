"""OpenHistoryMap-ready GeoJSON exporter.

OHM consumes OSM-style features tagged with temporal extents (start_date,
end_date). For each Finding in a Surveillance we emit a Feature whose:

  - geometry: the Finding's recorded geometry (point/polygon/etc.)
  - properties.start_date / end_date: temporal extents (partial ISO allowed)
  - properties.tags: dict of OSM-style key/value pairs
  - properties.source: "archaeo-pro:<surveillance protocollo or id>"
  - properties.name: Finding.name

Format may be swapped to OSM XML later — gated behind a config flag if/when
the OHM ingest preference is locked. Confirm with the user before changing.
"""
from __future__ import annotations

from uuid import UUID

from geoalchemy2.shape import to_shape
from shapely.geometry import mapping
from sqlalchemy.orm import Session

from app.models import Surveillance


def export_geojson(db: Session, surveillance_id: UUID) -> dict:
    s = db.get(Surveillance, surveillance_id)
    if s is None:
        raise ValueError(f"Surveillance {surveillance_id} not found")

    source_id = s.protocollo or str(s.id)
    features: list[dict] = []
    for f in s.findings:
        if f.geom is None:
            continue
        props: dict = {
            "name": f.name,
            "source": f"archaeo-pro:{source_id}",
            "tags": dict(f.tags or {}),
        }
        if f.start_date:
            props["start_date"] = f.start_date
        if f.end_date:
            props["end_date"] = f.end_date
        if f.description:
            props["description"] = f.description

        # Default tag if the user didn't tag explicitly.
        props["tags"].setdefault("historic", "archaeological_site")

        features.append(
            {
                "type": "Feature",
                "id": str(f.id),
                "geometry": mapping(to_shape(f.geom)),
                "properties": props,
            }
        )

    return {
        "type": "FeatureCollection",
        "metadata": {
            "surveillance_id": str(s.id),
            "protocollo": s.protocollo,
            "title": s.title,
            "comune": s.comune,
            "provincia": s.provincia,
            "exporter": "archaeo-pro/0.1",
        },
        "features": features,
    }
