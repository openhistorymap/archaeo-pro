"""WMS source registry: every source the PWA can turn on."""
from fastapi.testclient import TestClient

from app.main import app
from app.services.wms import SOURCES


def test_catalog_lists_vincoli_in_rete_and_ispra_carg():
    ids = {s["id"] for s in TestClient(app).get("/wms/sources").json()}
    assert {"vir-beni", "vir-aree-archeologiche", "carg-50k"} <= ids


def test_every_source_has_layers_and_an_upstream():
    for source in SOURCES.values():
        assert source.default_layers, source.id
        assert source.url.startswith(("http://", "https://")), source.id


def test_unknown_source_is_refused():
    assert TestClient(app).get("/wms/nope?REQUEST=GetMap").status_code == 404
