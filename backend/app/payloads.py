"""Pydantic payloads accepted by the stateless rendering endpoints.

The PWA holds the source of truth for a surveillance (in the user's GitHub
repo). When the archaeologist asks for a DOCX/PDF, the PWA POSTs the
materialized JSON to this backend along with the photo bytes.
"""
from pydantic import BaseModel, ConfigDict, Field


class StratigraphicUnitPayload(BaseModel):
    number: int
    type: str | None = None
    definition: str | None = None
    description: str | None = None
    interpretation: str | None = None
    materials: str | None = None


class FindingPayload(BaseModel):
    id: str
    name: str
    description: str | None = None
    interpretation: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    tags: dict[str, str] = Field(default_factory=dict)
    units: list[StratigraphicUnitPayload] = Field(default_factory=list)


class PhotoPayload(BaseModel):
    """Photo metadata. The bytes arrive separately as a multipart upload whose
    filename matches the photo id."""

    id: str
    filename: str
    caption: str | None = None
    bearing: float | None = None
    taken_at: str | None = None


class SurveillancePayload(BaseModel):
    """Render-ready snapshot of a surveillance. Mirrors the JSON files stored
    in the per-surveillance GitHub repo, flattened into one document."""

    model_config = ConfigDict(extra="ignore")

    id: str
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
    start_date: str | None = None
    end_date: str | None = None
    premessa: str | None = None
    metodologia: str | None = None
    risultati: str | None = None
    conclusioni: str | None = None
    findings: list[FindingPayload] = Field(default_factory=list)
    photos: list[PhotoPayload] = Field(default_factory=list)
