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


class GnaMosiPayload(BaseModel):
    """The GNA MOSI (modulo sito) fields of one finding that archaeo-pro does
    not otherwise record. Keys are GNA vocabulary keys, as strings."""

    OGD: str | None = None  # definizione
    OGT: list[str] = Field(default_factory=list)  # tipologia (multi, filtered by OGD)
    OGB: str | None = None  # situazione attuale
    FNTP: str = "1"  # fonte: osservazione diretta
    OGM: str = "12"  # modalità di individuazione: scavo archeologico
    DTR: str | None = None  # cronologia generica (DTR_key)
    DTSI: int | None = None  # anno iniziale, a.C. negativo
    DTSF: int | None = None
    DTT: str | None = None  # note alla cronologia
    MTAM: str | None = None  # quota minima s.l.m.
    MTAX: str | None = None  # quota massima s.l.m.
    MTAR: str | None = None  # quota relativa
    MTAS: str | None = None
    GPT: str | None = None  # overrides the project's positioning method
    GPM: str | None = None
    GPBB: str | None = None
    PVL: str | None = None  # località


class FindingPayload(BaseModel):
    id: str
    name: str
    description: str | None = None
    interpretation: str | None = None
    start_date: str | None = None
    end_date: str | None = None
    tags: dict[str, str] = Field(default_factory=dict)
    units: list[StratigraphicUnitPayload] = Field(default_factory=list)
    recorded_on: str | None = None
    geometry: dict | None = None  # GeoJSON geometry, EPSG:4326
    gna: GnaMosiPayload | None = None


class PhotoPayload(BaseModel):
    """Photo metadata. The bytes arrive separately as a multipart upload whose
    filename matches the photo id."""

    id: str
    filename: str
    caption: str | None = None
    bearing: float | None = None
    taken_at: str | None = None
    recorded_on: str | None = None
    shot_type: str | None = None  # "intervento" | "dettaglio"
    finding_id: str | None = None


class PresencePayload(BaseModel):
    name: str
    role: str | None = None
    hours_start: str | None = None
    hours_end: str | None = None
    hours_total: float | None = None


class DayLogPayload(BaseModel):
    """One entry of the giornale di scavo / assistenza. Mirrors the file
    daily/<YYYY-MM-DD>.json in the surveillance repo."""

    date: str  # ISO YYYY-MM-DD
    presenze: list[PresencePayload] = Field(default_factory=list)
    operazioni: str | None = None
    localizzazione: str | None = None
    weather: str | None = None
    notes: str | None = None


class TavolaPayload(BaseModel):
    """A rendered map snapshot (tavola grafica). The bytes arrive as a
    multipart upload whose filename matches the tavola id."""

    id: str
    filename: str
    caption: str | None = None
    captured_on: str | None = None
    kind: str  # "insieme" | "dettaglio" | "storica"
    finding_id: str | None = None


class GnaProjectPayload(BaseModel):
    """The GNA MOPR (modulo di progetto) of a surveillance: what the Template
    GNA needs beyond what archaeo-pro already records. Coded fields hold GNA
    vocabulary keys as strings; LCR/LCP/LCC are ISTAT codes."""

    CPR: str | None = None  # codice progetto, includes the personal code issued by ICA
    EMC: str | None = None  # enti MiC coinvolti, e.g. "SABAP-BO"
    OGN: str | None = None  # denominazione; defaults to the surveillance title
    CTG: str | None = None  # categoria opera
    OGT: str | None = None  # tipo opera (OGT_MOPR, filtered by CTG)
    DES: str | None = None  # descrizione delle opere; defaults to the premessa
    ENTE: int | None = None  # SABAP di riferimento
    FUR: list[str] = Field(default_factory=list)  # funzionari responsabili
    CMC: str | None = None  # "Cognome, Nome"
    CMR: str | None = None  # "Cognome, Nome"
    LCR: int | None = None
    LCP: int | None = None
    LCC: int | None = None
    GPT: str | None = None  # metodo di posizionamento (default for DSC and MOSI)
    GPM: str | None = None
    GPBB: str | None = None
    presa_visione: bool = False


class GnaDscPayload(BaseModel):
    """One investigated area (DSC): a trench or a monitored excavation,
    recorded whether or not it produced archaeological evidence."""

    id: str
    DSCV: str  # denominazione dello scavo
    geometry: dict | None = None  # GeoJSON; defaults to the surveillance area
    DSCEX: str | None = None  # esito: 1 negativo, 2 positivo; derived from findings if empty
    MATS: bool = False  # materiali in giacitura secondaria
    DSCM: str | None = None  # metodo di scavo
    DSCY: int | None = None  # anno dello scavo
    MTAM: str | None = None  # profondità massima assoluta
    MTAR: str | None = None  # profondità massima relativa
    MTA0: str | None = None  # quota 0 di riferimento, required with MTAR
    MTAS: str | None = None
    NSC: str | None = None  # attività e stratigrafia (not the finds)
    DSCA: str | None = None  # responsabile scientifico, "Cognome, Nome"


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
    days: list[DayLogPayload] = Field(default_factory=list)
    tavole: list[TavolaPayload] = Field(default_factory=list)
    area: dict | None = None  # GeoJSON Polygon of the watched area
    gna: GnaProjectPayload | None = None
    gna_dsc: list[GnaDscPayload] = Field(default_factory=list)
