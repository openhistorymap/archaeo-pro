"""Smoke test for the OHM exporter that doesn't require a live DB.

Builds a fake Surveillance + Finding in memory and verifies the GeoJSON shape.
"""
from types import SimpleNamespace
from uuid import uuid4

from shapely.geometry import Point

import geoalchemy2.shape


def _build_surveillance():
    finding = SimpleNamespace(
        id=uuid4(),
        name="Frammento ceramico romano",
        description="Frammento di terra sigillata.",
        interpretation=None,
        start_date="-0050",
        end_date="0200",
        tags={"site_type": "settlement", "period": "roman"},
        geom=geoalchemy2.shape.from_shape(Point(11.34, 44.49), srid=4326),
    )
    surveillance = SimpleNamespace(
        id=uuid4(),
        protocollo="2026/0001",
        title="Sorveglianza via Roma 12",
        comune="Bologna",
        provincia="BO",
        findings=[finding],
    )
    return surveillance


def test_export_geojson_shape(monkeypatch):
    """The exporter must produce a FeatureCollection with one feature."""
    from app.services import ohm

    surveillance = _build_surveillance()

    class _FakeSession:
        def get(self, model, id):
            return surveillance

    fc = ohm.export_geojson(_FakeSession(), surveillance.id)
    assert fc["type"] == "FeatureCollection"
    assert len(fc["features"]) == 1
    feat = fc["features"][0]
    assert feat["geometry"]["type"] == "Point"
    assert feat["properties"]["tags"]["historic"] == "archaeological_site"  # default
    assert feat["properties"]["tags"]["period"] == "roman"
    assert feat["properties"]["start_date"] == "-0050"
    assert feat["properties"]["source"].startswith("archaeo-pro:2026/0001")
