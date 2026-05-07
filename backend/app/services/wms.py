"""Per-source WMS upstream registry.

The browser cannot hit Vincoli/ISPRA/PCN directly (CORS, referrer, sometimes
auth). The proxy router uses this registry to resolve a logical source id to
its upstream URL and to attach the headers each provider expects.

If an endpoint moves, override via env var (see app.config). Do not embed
secrets here.
"""
from dataclasses import dataclass

from app.config import settings


@dataclass(frozen=True)
class WmsSource:
    id: str
    label: str
    url: str
    headers: dict[str, str]
    # Suggested default layer(s) for the PWA to enable on first paint.
    default_layers: tuple[str, ...] = ()


SOURCES: dict[str, WmsSource] = {
    "vincoli": WmsSource(
        id="vincoli",
        label="Vincoli in Rete (MiC)",
        url=settings.wms_vincoli_url,
        headers={"Referer": "https://vincoliinrete.beniculturali.it/"},
        default_layers=(settings.wms_vincoli_layer,),
    ),
    "ispra": WmsSource(
        id="ispra",
        label="ISPRA — Carta Geologica d'Italia",
        url=settings.wms_ispra_url,
        headers={},
        default_layers=(settings.wms_ispra_layer,),
    ),
    "pcn": WmsSource(
        id="pcn",
        label="Geoportale Nazionale (PCN) — ortofoto",
        url=settings.wms_pcn_url,
        headers={},
        default_layers=(settings.wms_pcn_layer,),
    ),
}


def get_source(source_id: str) -> WmsSource | None:
    return SOURCES.get(source_id)
