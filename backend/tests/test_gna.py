"""Template GNA export.

The validation and geometry tests run offline against small vocabulary
fixtures. The package test fills the real Template GNA: point
GNA_TEMPLATE_ZIP at a downloaded Template_GNA_1.6.0.zip to run it
(https://gna.cultura.gov.it/download/Template_GNA_1.6.0.zip); it is skipped
otherwise, because the template is not redistributed with this repo.
"""
import os
import sqlite3
import struct
import zipfile
from pathlib import Path

import pytest
from fastapi.testclient import TestClient

from app.config import settings
from app.main import app
from app.payloads import (
    FindingPayload,
    GnaDscPayload,
    GnaMosiPayload,
    GnaProjectPayload,
    SurveillancePayload,
)
from app.services import gna_export
from app.services.gna_gpkg import gpkg_blob, point_in_polygon, register_st_functions

FIXTURES = Path(__file__).parent / "fixtures" / "gna"
TEMPLATE = os.environ.get("GNA_TEMPLATE_ZIP")

AREA = {
    "type": "Polygon",
    "coordinates": [[[11.30, 44.49], [11.32, 44.49], [11.32, 44.51], [11.30, 44.51], [11.30, 44.49]]],
}
TRENCH = {
    "type": "Polygon",
    "coordinates": [[[11.305, 44.495], [11.306, 44.495], [11.306, 44.496], [11.305, 44.496], [11.305, 44.495]]],
}
WALL = {
    "type": "Polygon",
    "coordinates": [[[11.3052, 44.4952], [11.3055, 44.4952], [11.3055, 44.4954], [11.3052, 44.4952]]],
}


@pytest.fixture(autouse=True)
def offline_vocab(monkeypatch, tmp_path):
    monkeypatch.setattr(settings, "gna_vocab_dir", FIXTURES)
    monkeypatch.setattr(settings, "work_dir", tmp_path)
    if TEMPLATE:
        monkeypatch.setattr(settings, "gna_template_zip", Path(TEMPLATE))


def surveillance(**overrides) -> SurveillancePayload:
    base = SurveillancePayload(
        id="s1",
        title="Sorveglianza via Irnerio",
        premessa="Posa di sottoservizi in via Irnerio.",
        metodologia="Assistenza continua allo scavo meccanico.",
        start_date="2026-03-02",
        area=AREA,
        gna=GnaProjectPayload(
            CPR="SABAP-BO_2026_00123-MM_000001",
            EMC="SABAP-BO",
            CTG="2",
            OGT="40",
            ENTE=20,
            FUR=["9001"],
            CMC="Verdi, Anna",
            CMR="Verdi, Anna",
            LCR=8,
            LCP=37,
            LCC=37006,
            GPT="3",
            GPM="1",
            GPBB="2",
            presa_visione=True,
        ),
        gna_dsc=[
            GnaDscPayload(id="d1", DSCV="Trincea 1", geometry=TRENCH, DSCM="2", DSCY=2026,
                          MTAR="-1,80", MTA0="54,20")
        ],
        findings=[
            FindingPayload(
                id="f1",
                name="Muro in laterizi",
                description="Muro in laterizi legati da malta, orientato N-S.",
                geometry=WALL,
                gna=GnaMosiPayload(OGD="25", OGB="1", DTR="13", DTSI=1, DTSF=200, MTAR="-1,20"),
            )
        ],
    )
    return base.model_copy(update=overrides)


def errors(issues):
    return [(i.where, i.field) for i in issues if i.level == "errore"]


# ---- geometry ---------------------------------------------------------------


def test_gpkg_blob_header_envelope_and_wkb():
    blob = gpkg_blob(TRENCH)
    assert blob[:2] == b"GP" and blob[3] & 1  # little-endian
    srs = struct.unpack("<i", blob[4:8])[0]
    minx, maxx, miny, maxy = struct.unpack("<dddd", blob[8:40])
    assert srs == 4326
    assert (minx, maxx, miny, maxy) == (11.305, 11.306, 44.495, 44.496)
    order, kind, parts = struct.unpack("<BII", blob[40:49])
    assert (order, kind, parts) == (1, 6, 1)  # MultiPolygon with one polygon


def test_st_functions_read_the_envelope():
    conn = sqlite3.connect(":memory:")
    register_st_functions(conn)
    blob = gpkg_blob({"type": "Point", "coordinates": [11.3, 44.5]})
    row = conn.execute("SELECT ST_IsEmpty(?), ST_MinX(?), ST_MaxY(?)", (blob, blob, blob)).fetchone()
    assert row == (0, 11.3, 44.5)


def test_point_in_polygon():
    assert point_in_polygon((11.31, 44.50), AREA)
    assert point_in_polygon((11.30, 44.50), AREA)  # on the boundary
    assert not point_in_polygon((11.40, 44.50), AREA)


# ---- validation -------------------------------------------------------------


async def test_complete_surveillance_has_no_errors():
    assert errors(await gna_export.check(surveillance())) == []


async def test_missing_project_data_is_reported_in_italian():
    issues = await gna_export.check(surveillance(gna=None))
    fields = {f for _, f in errors(issues)}
    assert {"CPR", "EMC", "ENTE", "FUR", "CMC", "LCC", "presa_visione"} <= fields
    assert all(i.message for i in issues)


async def test_cpr_must_follow_the_gna_pattern():
    s = surveillance()
    s.gna.CPR = "SORV-2026-1"
    assert ("Progetto", "CPR") in errors(await gna_export.check(s))


async def test_findings_outside_the_project_area_are_rejected():
    s = surveillance()
    s.findings[0].geometry = {"type": "Point", "coordinates": [12.0, 45.0]}
    issues = await gna_export.check(s)
    assert ("Evidenza «Muro in laterizi»", None) in errors(issues)
    assert any(i.level == "avviso" and "poligono" in i.message for i in issues)


async def test_depth_is_mandatory_for_investigations_from_2024():
    s = surveillance()
    s.gna_dsc[0].MTAR = None
    s.gna_dsc[0].MTA0 = None
    assert ("Area indagata «Trincea 1»", "MTAM") in errors(await gna_export.check(s))


async def test_dating_must_fall_inside_the_chosen_period():
    s = surveillance()
    s.findings[0].gna.DTSI = -500  # before "Età Romano imperiale"
    assert ("Evidenza «Muro in laterizi»", "DTSI") in errors(await gna_export.check(s))


async def test_undated_evidence_needs_no_years():
    s = surveillance()
    s.findings[0].gna.DTR = "21"
    s.findings[0].gna.DTSI = s.findings[0].gna.DTSF = None
    assert errors(await gna_export.check(s)) == []


async def test_a_negative_surveillance_still_needs_an_investigated_area():
    s = surveillance(gna_dsc=[], findings=[])
    assert ("Progetto", None) in errors(await gna_export.check(s))


def test_vocab_proxy_only_serves_known_vocabularies():
    client = TestClient(app)
    assert client.get("/gna/vocab/DTR").status_code == 200
    assert client.get("/gna/vocab/secret").status_code == 404


def test_package_refuses_incomplete_data_with_the_issue_list():
    client = TestClient(app)
    res = client.post("/gna/package", json=surveillance(gna=None).model_dump())
    assert res.status_code == 422
    assert res.json()["issues"]


# ---- package (needs the real template) --------------------------------------


@pytest.mark.skipif(not TEMPLATE, reason="set GNA_TEMPLATE_ZIP to the official Template_GNA_1.6.0.zip")
async def test_package_fills_the_official_template(tmp_path):
    path, warnings = await gna_export.build_package(surveillance())
    assert warnings == []
    with zipfile.ZipFile(path) as z:
        names = set(z.namelist())
        assert {"Template_GNA/Template_GNA.gpkg", "Template_GNA/Template_GNA_1.6.qgz",
                "Template_GNA/LEGGIMI.txt"} <= names
        z.extract("Template_GNA/Template_GNA.gpkg", tmp_path)

    conn = sqlite3.connect(tmp_path / "Template_GNA" / "Template_GNA.gpkg")
    mopr = conn.execute("SELECT CPR, AMA, FUR, presa_visione, MOPR_ID FROM MOPR").fetchall()
    assert len(mopr) == 1
    cpr, ama, fur, seen, mopr_id = mopr[0]
    assert (cpr, ama, fur, seen) == ("SABAP-BO_2026_00123-MM_000001", "2", "{9001}", 1)

    dsc = conn.execute("SELECT DSCV, DSCT, DSCEX, DSCY, MTAR, CPR_MOPR, FUR FROM DSC_multipolygon").fetchall()
    assert dsc == [("Trincea 1", "2", 2, 2026, "-1,80", cpr, "9001")]

    mosi = conn.execute(
        "SELECT id_viarch, ACCC, OGD, DTR, DTR_new, OGM, OGM_new, MOPR_id, GET FROM MOSI_multipolygon"
    ).fetchall()
    assert mosi == [("1", f"{cpr}_1", "25", "Età Romano imperiale", 13, "12", 12, mopr_id, "3")]

    # spatial indexes were maintained by the template's own triggers
    assert conn.execute("SELECT minx, maxy FROM rtree_DSC_multipolygon_geometry").fetchone() == (
        pytest.approx(11.305), pytest.approx(44.496))
    assert conn.execute("SELECT count(*) FROM rtree_MOSI_multipolygon_geom").fetchone() == (1,)
    counts = dict(conn.execute("SELECT table_name, feature_count FROM gpkg_ogr_contents"))
    assert counts["MOPR"] == 1 and counts["MOSI_multipolygon"] == 1
    assert conn.execute("PRAGMA integrity_check").fetchone() == ("ok",)
