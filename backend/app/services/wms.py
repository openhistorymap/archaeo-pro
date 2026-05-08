"""Per-source WMS upstream registry.

The PWA cannot hit Italian government WMS endpoints directly (CORS,
Referer, occasional IP-based blocking of non-IT data centres). The proxy
router uses this registry to resolve a logical source id to its upstream
URL and to attach any required headers.

All current sources point at PCN-Geoportale (gn.mase.gov.it) mapfiles:
each product is a *separate* mapfile under wms.pcn.minambiente.it/ogc.
The unified `catalogo.map` advertises every layer in GetCapabilities but
its mapfile has no top-level projection, so GetMap fails with
"Cannot set new SRS on a map that doesn't have any projection set." The
per-product mapfiles work correctly with EPSG:3857.

To add a new layer:
  1. Find its mapfile in the catalogo's <Attribution> element
     (https://gn.mase.gov.it/portale/servizio-di-consultazione-wms).
  2. Add an entry below with the corresponding layer Name.
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
}


def get_source(source_id: str) -> WmsSource | None:
    return SOURCES.get(source_id)
