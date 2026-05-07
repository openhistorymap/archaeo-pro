"""initial schema

Revision ID: 0001_initial
Revises:
Create Date: 2026-05-07
"""
from typing import Sequence, Union

from alembic import op
import sqlalchemy as sa
import geoalchemy2

revision: str = "0001_initial"
down_revision: Union[str, None] = None
branch_labels: Union[str, Sequence[str], None] = None
depends_on: Union[str, Sequence[str], None] = None


def upgrade() -> None:
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")

    op.create_table(
        "surveillances",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column("protocollo", sa.String(64)),
        sa.Column("title", sa.String(255), nullable=False),
        sa.Column("committente", sa.String(255)),
        sa.Column("direttore_tecnico", sa.String(255)),
        sa.Column("sabap", sa.String(255)),
        sa.Column("comune", sa.String(128)),
        sa.Column("provincia", sa.String(64)),
        sa.Column("foglio_catastale", sa.String(64)),
        sa.Column("particelle", sa.String(255)),
        sa.Column("normativa", sa.Text),
        sa.Column("start_date", sa.Date),
        sa.Column("end_date", sa.Date),
        sa.Column("area", geoalchemy2.types.Geometry("POLYGON", srid=4326)),
        sa.Column("premessa", sa.Text),
        sa.Column("metodologia", sa.Text),
        sa.Column("risultati", sa.Text),
        sa.Column("conclusioni", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )

    op.create_table(
        "findings",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "surveillance_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("surveillances.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("name", sa.String(255), nullable=False),
        sa.Column("description", sa.Text),
        sa.Column("interpretation", sa.Text),
        sa.Column("start_date", sa.String(32)),
        sa.Column("end_date", sa.String(32)),
        sa.Column("tags", sa.JSON, server_default="{}"),
        sa.Column("geom", geoalchemy2.types.Geometry("GEOMETRY", srid=4326)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_findings_surveillance_id", "findings", ["surveillance_id"])

    op.create_table(
        "stratigraphic_units",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "finding_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("findings.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column("number", sa.Integer, nullable=False),
        sa.Column("type", sa.String(64)),
        sa.Column("definition", sa.Text),
        sa.Column("description", sa.Text),
        sa.Column("interpretation", sa.Text),
        sa.Column("materials", sa.Text),
    )
    op.create_index("ix_stratigraphic_units_finding_id", "stratigraphic_units", ["finding_id"])

    op.create_table(
        "photos",
        sa.Column("id", sa.dialects.postgresql.UUID(as_uuid=True), primary_key=True),
        sa.Column(
            "surveillance_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("surveillances.id", ondelete="CASCADE"),
            nullable=False,
            index=True,
        ),
        sa.Column(
            "finding_id",
            sa.dialects.postgresql.UUID(as_uuid=True),
            sa.ForeignKey("findings.id", ondelete="SET NULL"),
            nullable=True,
        ),
        sa.Column("filename", sa.String(255), nullable=False),
        sa.Column("storage_path", sa.String(512), nullable=False),
        sa.Column("caption", sa.Text),
        sa.Column("taken_at", sa.DateTime(timezone=True)),
        sa.Column("bearing", sa.Float),
        sa.Column("location", geoalchemy2.types.Geometry("POINT", srid=4326)),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.func.now(), nullable=False),
    )
    op.create_index("ix_photos_surveillance_id", "photos", ["surveillance_id"])


def downgrade() -> None:
    op.drop_table("photos")
    op.drop_table("stratigraphic_units")
    op.drop_table("findings")
    op.drop_table("surveillances")
