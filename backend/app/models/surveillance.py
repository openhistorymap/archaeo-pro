from datetime import date, datetime
from uuid import UUID, uuid4

from geoalchemy2 import Geometry
from sqlalchemy import JSON, Date, DateTime, ForeignKey, Integer, String, Text, func
from sqlalchemy.dialects.postgresql import UUID as PgUUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.db import Base


class Surveillance(Base):
    """A *sorveglianza archeologica* — the root aggregate."""

    __tablename__ = "surveillances"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)

    # Header / metadata
    protocollo: Mapped[str | None] = mapped_column(String(64))
    title: Mapped[str] = mapped_column(String(255))
    committente: Mapped[str | None] = mapped_column(String(255))
    direttore_tecnico: Mapped[str | None] = mapped_column(String(255))
    sabap: Mapped[str | None] = mapped_column(String(255))  # competent SABAP office
    comune: Mapped[str | None] = mapped_column(String(128))
    provincia: Mapped[str | None] = mapped_column(String(64))
    foglio_catastale: Mapped[str | None] = mapped_column(String(64))
    particelle: Mapped[str | None] = mapped_column(String(255))
    normativa: Mapped[str | None] = mapped_column(Text)

    start_date: Mapped[date | None] = mapped_column(Date)
    end_date: Mapped[date | None] = mapped_column(Date)

    # The watched area — polygon in EPSG:4326.
    area: Mapped[object | None] = mapped_column(Geometry("POLYGON", srid=4326))

    # Free-form sections — the docgen renders them into the template.
    premessa: Mapped[str | None] = mapped_column(Text)
    metodologia: Mapped[str | None] = mapped_column(Text)
    risultati: Mapped[str | None] = mapped_column(Text)
    conclusioni: Mapped[str | None] = mapped_column(Text)

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())
    updated_at: Mapped[datetime] = mapped_column(
        DateTime(timezone=True), server_default=func.now(), onupdate=func.now()
    )

    findings: Mapped[list["Finding"]] = relationship(
        back_populates="surveillance", cascade="all, delete-orphan", order_by="Finding.created_at"
    )
    photos: Mapped[list["Photo"]] = relationship(
        back_populates="surveillance", cascade="all, delete-orphan", order_by="Photo.taken_at"
    )


class Finding(Base):
    """An archaeological finding — point/polygon with date range and OSM-ish tags.

    The OHM exporter consumes these directly.
    """

    __tablename__ = "findings"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    surveillance_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("surveillances.id", ondelete="CASCADE"),
        index=True,
    )

    name: Mapped[str] = mapped_column(String(255))
    description: Mapped[str | None] = mapped_column(Text)
    interpretation: Mapped[str | None] = mapped_column(Text)

    # Temporal extents — partial ISO dates allowed (e.g. "-0500" or "1450").
    # Stored as text because we want pre-1AD and partial dates.
    start_date: Mapped[str | None] = mapped_column(String(32))
    end_date: Mapped[str | None] = mapped_column(String(32))

    # OSM-style tags, e.g. {"historic": "archaeological_site", "site_type": "settlement"}.
    tags: Mapped[dict] = mapped_column(JSON, default=dict)

    geom: Mapped[object | None] = mapped_column(Geometry("GEOMETRY", srid=4326))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    surveillance: Mapped["Surveillance"] = relationship(back_populates="findings")
    units: Mapped[list["StratigraphicUnit"]] = relationship(
        back_populates="finding", cascade="all, delete-orphan", order_by="StratigraphicUnit.number"
    )


class StratigraphicUnit(Base):
    """A US (Unità Stratigrafica) — the atom of an archaeological record."""

    __tablename__ = "stratigraphic_units"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    finding_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("findings.id", ondelete="CASCADE"), index=True
    )

    number: Mapped[int] = mapped_column(Integer)
    type: Mapped[str | None] = mapped_column(String(64))  # positiva / negativa / struttura
    definition: Mapped[str | None] = mapped_column(Text)
    description: Mapped[str | None] = mapped_column(Text)
    interpretation: Mapped[str | None] = mapped_column(Text)
    materials: Mapped[str | None] = mapped_column(Text)

    finding: Mapped["Finding"] = relationship(back_populates="units")


class Photo(Base):
    __tablename__ = "photos"

    id: Mapped[UUID] = mapped_column(PgUUID(as_uuid=True), primary_key=True, default=uuid4)
    surveillance_id: Mapped[UUID] = mapped_column(
        PgUUID(as_uuid=True),
        ForeignKey("surveillances.id", ondelete="CASCADE"),
        index=True,
    )
    finding_id: Mapped[UUID | None] = mapped_column(
        PgUUID(as_uuid=True), ForeignKey("findings.id", ondelete="SET NULL"), nullable=True
    )

    filename: Mapped[str] = mapped_column(String(255))
    storage_path: Mapped[str] = mapped_column(String(512))
    caption: Mapped[str | None] = mapped_column(Text)

    taken_at: Mapped[datetime | None] = mapped_column(DateTime(timezone=True))
    bearing: Mapped[float | None] = mapped_column()
    location: Mapped[object | None] = mapped_column(Geometry("POINT", srid=4326))

    created_at: Mapped[datetime] = mapped_column(DateTime(timezone=True), server_default=func.now())

    surveillance: Mapped["Surveillance"] = relationship(back_populates="photos")
