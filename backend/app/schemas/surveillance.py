from datetime import date, datetime
from typing import Any
from uuid import UUID

from geoalchemy2.shape import to_shape
from pydantic import BaseModel, ConfigDict, Field, field_validator
from shapely.geometry import mapping, shape


class _GeoJSON(BaseModel):
    """Loose GeoJSON geometry envelope. Validated by shapely."""

    model_config = ConfigDict(extra="allow")
    type: str
    coordinates: Any


def geom_to_geojson(g: Any) -> dict | None:
    if g is None:
        return None
    return mapping(to_shape(g))


def _geojson_to_wkt(g: dict | None) -> str | None:
    if g is None:
        return None
    return shape(g).wkt


class StratigraphicUnitBase(BaseModel):
    number: int
    type: str | None = None
    definition: str | None = None
    description: str | None = None
    interpretation: str | None = None
    materials: str | None = None


class StratigraphicUnitCreate(StratigraphicUnitBase):
    pass


class StratigraphicUnitOut(StratigraphicUnitBase):
    id: UUID

    model_config = ConfigDict(from_attributes=True)


class FindingBase(BaseModel):
    name: str
    description: str | None = None
    interpretation: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    tags: dict[str, str] = Field(default_factory=dict)


class FindingCreate(FindingBase):
    geom: _GeoJSON | None = None
    units: list[StratigraphicUnitCreate] = Field(default_factory=list)

    @field_validator("geom", mode="before")
    @classmethod
    def _accept_dict(cls, v):
        return v


class FindingOut(FindingBase):
    id: UUID
    geom: dict | None = None
    units: list[StratigraphicUnitOut] = Field(default_factory=list)

    model_config = ConfigDict(from_attributes=True)

    @classmethod
    def from_orm_row(cls, row) -> "FindingOut":
        return cls(
            id=row.id,
            name=row.name,
            description=row.description,
            interpretation=row.interpretation,
            start_date=row.start_date,
            end_date=row.end_date,
            tags=row.tags or {},
            geom=geom_to_geojson(row.geom),
            units=[StratigraphicUnitOut.model_validate(u) for u in row.units],
        )


class PhotoOut(BaseModel):
    id: UUID
    filename: str
    caption: str | None
    taken_at: datetime | None
    bearing: float | None
    location: dict | None = None
    url: str

    model_config = ConfigDict(from_attributes=True)


class SurveillanceBase(BaseModel):
    title: str
    protocollo: str | None = None
    committente: str | None = None
    direttore_tecnico: str | None = None
    sabap: str | None = None
    comune: str | None = None
    provincia: str | None = None
    foglio_catastale: str | None = None
    particelle: str | None = None
    normativa: str | None = None
    start_date: date | None = None
    end_date: date | None = None
    premessa: str | None = None
    metodologia: str | None = None
    risultati: str | None = None
    conclusioni: str | None = None


class SurveillanceCreate(SurveillanceBase):
    area: _GeoJSON | None = None


class SurveillanceUpdate(SurveillanceBase):
    title: str | None = None  # allow partial updates
    area: _GeoJSON | None = None


class SurveillanceOut(SurveillanceBase):
    id: UUID
    area: dict | None = None
    findings: list[FindingOut] = Field(default_factory=list)
    photos: list[PhotoOut] = Field(default_factory=list)
    created_at: datetime
    updated_at: datetime

    model_config = ConfigDict(from_attributes=True)


def geojson_to_wkt(g) -> str | None:
    """Re-export so routers can serialize without importing shapely directly."""
    if g is None:
        return None
    if hasattr(g, "model_dump"):
        g = g.model_dump()
    return _geojson_to_wkt(g)
