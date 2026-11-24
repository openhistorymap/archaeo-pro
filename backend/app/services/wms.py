"""Per-source WMS upstream registry.

The PWA cannot hit Italian government WMS endpoints directly (CORS,
Referer, occasional IP-based blocking of non-IT data centres). The proxy
router uses this registry to resolve a logical source id to its upstream
URL and to attach any required headers.

Sources:

- PCN-Geoportale (gn.mase.gov.it): each product is a *separate* mapfile
  under wms.pcn.minambiente.it/ogc. The unified `catalogo.map` advertises
  every layer in GetCapabilities but its mapfile has no top-level
  projection, so GetMap fails with "Cannot set new SRS on a map that
  doesn't have any projection set." The per-product mapfiles work with
  EPSG:3857. To add one, find its mapfile in the catalogo's <Attribution>
  element (https://gn.mase.gov.it/portale/servizio-di-consultazione-wms).
- Vincoli in Rete (MiC): the public GeoServer behind the VIR webgis,
  workspace `wms_public`: the protected cultural assets (beni culturali
  vincolati: points, lines, polygons) and the archaeological constraint
  areas. Advertises EPSG:3857.
- ISPRA, Carta Geologica d'Italia 1:50.000 (progetto CARG), raster
  ImageServer. GetCapabilities lists only EPSG:4326, but GetMap renders
  EPSG:3857 correctly (checked 2026-11-24).

Each entry is one WMS endpoint plus the layer(s) the PWA turns on.
"""
from dataclasses import dataclass, field


@dataclass(frozen=True)
class WmsSource:
    id: str
    label: str
    url: str
    headers: dict[str, str] = field(default_factory=dict)
    # Suggested default layer(s) for the PWA to enable on first paint.
    default_layers: tuple[str, ...] = ()


_PCN = "http://wms.pcn.minambiente.it/ogc"
_VIR = "https://vincoliinrete.beniculturali.it/geoserver/ows"
_ISPRA_CARG = "http://sgi2.isprambiente.it/arcgis/services/raster/geo_50k_italia/ImageServer/WMSServer"


SOURCES: dict[str, WmsSource] = {
    "ortofoto-2012": WmsSource(
        id="ortofoto-2012",
        label="Ortofoto AGEA 2012",
        url=f"{_PCN}?map=/ms_ogc/WMS_v1.3/raster/ortofoto_colore_12.map",
        default_layers=("OI.ORTOIMMAGINICOLORE.2012",),
    ),
    "ortofoto-bn-1988": WmsSource(
        id="ortofoto-bn-1988",
        label="Ortofoto storica B/N 1988",
        url=f"{_PCN}?map=/ms_ogc/WMS_v1.3/raster/ortofoto_bn_88.map",
        default_layers=("OI.ORTOIMMAGINIBN.1988",),
    ),
    "igm-25000": WmsSource(
        id="igm-25000",
        label="IGM 1:25.000 (cartografia di base)",
        url=f"{_PCN}?map=/ms_ogc/WMS_v1.3/raster/IGM_25000.map",
        default_layers=("CB.IGM25000",),
    ),
    "geologica": WmsSource(
        id="geologica",
        label="Carta Geologica d'Italia",
        url=f"{_PCN}?map=/ms_ogc/WMS_v1.3/Vettoriali/Carta_geologica.map",
        default_layers=("GE.CARTA_GEOLOGICA",),
    ),
    "corine-2012": WmsSource(
        id="corine-2012",
        label="Corine Land Cover 2012",
        url=f"{_PCN}?map=/ms_ogc/WMS_v1.3/Vettoriali/Corine_Land_Cover2012.map",
        default_layers=("CS.CLC2012",),
    ),
    "carg-50k": WmsSource(
        id="carg-50k",
        label="Carta Geologica 1:50.000 (ISPRA, CARG)",
        url=_ISPRA_CARG,
        default_layers=("0",),
    ),
    "vir-beni": WmsSource(
        id="vir-beni",
        label="Vincoli in Rete · beni culturali vincolati",
        url=_VIR,
        default_layers=(
            "wms_public:v_geo_anagrafica_beni_poligonali",
            "wms_public:v_geo_anagrafica_beni_lineari",
            "wms_public:v_geo_anagrafica_beni_puntuali",
        ),
    ),
    "vir-aree-archeologiche": WmsSource(
        id="vir-aree-archeologiche",
        label="Vincoli in Rete · aree archeologiche vincolate",
        url=_VIR,
        default_layers=("wms_public:geo_aree_archeol_vincolate",),
    ),
}


def get_source(source_id: str) -> WmsSource | None:
    return SOURCES.get(source_id)
