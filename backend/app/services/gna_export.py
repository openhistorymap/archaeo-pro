"""Export a sorveglianza archeologica to the Template GNA (Geoportale Nazionale
per l'Archeologia, ICA – MiC), version 1.6.

Under DG ABAP circulars 9/2024 and 22/2024 the minimum data of every
investigation authorised by the MiC go to GNA, including *assistenza
archeologica in corso d'opera* (AMA = 2), which is what a surveillance is.
For that case the template needs:

  MOPR   one project area (the surveillance area), with AMA = 2
  DSC    every investigated area, positive or negative
  MOSI   one record per archaeological evidence (polygons for new excavation data)

The official template ZIP (GeoPackage + QGIS project) is filled and returned
whole. Delivery stays with the archaeologist: they open the .qgz in QGIS with
the GNA plugin, download the existing GNA records ("Avvia importazione"),
check the forms and press "Invia". The plugin cannot be bypassed: it is the
only way data enter GNA.

Field rules follow the template's own constraints (QGIS project of 1.6.0);
the codes are the GNA field names.
"""
import re
import shutil
import sqlite3
import tempfile
import uuid
import zipfile
from dataclasses import dataclass
from datetime import date
from pathlib import Path

from app.config import settings
from app.payloads import FindingPayload, GnaDscPayload, GnaProjectPayload, SurveillancePayload
from app.services import gna_sources
from app.services.gna_gpkg import coords_of, gpkg_blob, point_in_polygon, register_st_functions

AMA_ASSISTENZA = "2"  # assistenza archeologica in corso d'opera
DTR_UNDATED = {"21", "24"}  # non determinabile; non rilevabile per assenza di tracce

CPR_RE = re.compile(r"^[A-Z-]+_(19[0-9]{2}|20[0-9]{2})_[0-9]{5}-[A-Z]{2,4}_[0-9]{6,9}(_[0-9]{2})?$")
NAME_RE = re.compile(r"([A-Z][a-zòàèìòùáéíóú]+),\s*[A-Z][a-zòàèìòùáéíóú]+")
QUOTA_RE = re.compile(r"^-?[0-9]+([.,][0-9]{1,2})?$")

GPKG_NAME = "Template_GNA.gpkg"

LEGGIMI = """Pacchetto GNA preparato da archaeo-pro
=====================================

Contiene il Template GNA ufficiale (ICA – MiC) con i dati della sorveglianza
già inseriti: MOPR (area di progetto, AMA = 2), DSC (aree indagate) e MOSI
(evidenze archeologiche).

Come inviarlo a GNA:

1. Estrai la cartella. Non rinominare Template_GNA.gpkg: il progetto QGIS
   lo cerca con questo nome, nella stessa cartella.
2. Apri Template_GNA_1.6.qgz con QGIS LTR e il plugin GNA
   (repository https://gna.cultura.gov.it/qgis/plugins/plugins.xml).
3. Premi «Avvia importazione»: scarica le MOSI già presenti su GNA nell'area
   del progetto. È obbligatorio, altrimenti l'invio viene bloccato.
4. Apri e controlla le schede MOPR, DSC e MOSI: i campi obbligatori sono già
   compilati, ma la responsabilità dei contenuti resta tua.
5. Premi «Invia».

L'invio a GNA non sostituisce la consegna della documentazione completa alla
Soprintendenza. Guida ufficiale: https://gna.cultura.gov.it/wiki/
"""


@dataclass
class Issue:
    level: str  # "errore" blocks the package; "avviso" does not
    where: str  # "Progetto", "Area indagata «…»", "Evidenza «…»"
    field: str | None
    message: str

    def as_dict(self) -> dict:
        return {"level": self.level, "where": self.where, "field": self.field, "message": self.message}


class GnaValidationError(ValueError):
    def __init__(self, issues: list[Issue]):
        super().__init__("Dati GNA incompleti")
        self.issues = issues


def _blank(v) -> bool:
    return v is None or (isinstance(v, str) and not v.strip())


def _uid() -> str:
    return uuid.uuid4().hex  # QGIS uuid('Id128'): 32 hex digits


def _set(keys: list[str]) -> str | None:
    """QGIS multi-value literal: {k1,k2}."""
    return "{" + ",".join(keys) + "}" if keys else None


def _year(iso: str | None) -> int | None:
    m = re.match(r"^(\d{4})", iso or "")
    return int(m.group(1)) if m else None


@dataclass
class _Vocab:
    dtr: dict[str, dict]
    fur: dict[str, dict]


async def _load_vocab() -> _Vocab:
    dtr = {str(r["DTR_key"]): r for r in gna_sources.rows(await gna_sources.vocabulary("DTR"))}
    fur = {str(r["FUR_key"]): r for r in gna_sources.rows(await gna_sources.vocabulary("FUR"))}
    return _Vocab(dtr=dtr, fur=fur)


# ---- validation -------------------------------------------------------------


async def check(s: SurveillancePayload) -> list[Issue]:
    """Everything the template's forms and the GNA plugin would reject, in Italian."""
    vocab = await _load_vocab()
    return _check(s, vocab)


def _check(s: SurveillancePayload, vocab: _Vocab) -> list[Issue]:
    issues: list[Issue] = []

    def err(where, field, msg):
        issues.append(Issue("errore", where, field, msg))

    def warn(where, field, msg):
        issues.append(Issue("avviso", where, field, msg))

    p = s.gna or GnaProjectPayload()
    w = "Progetto"
    if s.area is None:
        err(w, None, "Disegna l'area della sorveglianza: diventa l'area di progetto (MOPR).")
    if _blank(p.CPR):
        err(w, "CPR", "Manca il codice progetto (CPR). Contiene il codice personale rilasciato da ICA.")
    elif not CPR_RE.match(p.CPR):
        err(w, "CPR", "Il codice progetto non ha il formato GNA, es. SABAP-FI_2022_00020-MS_000043.")
    if _blank(p.EMC):
        err(w, "EMC", "Indica gli enti MiC coinvolti (es. SABAP-BO).")
    elif len(p.EMC) > 25:
        err(w, "EMC", "Gli enti MiC coinvolti non possono superare 25 caratteri.")
    if _blank(p.OGN) and _blank(s.title):
        err(w, "OGN", "Manca la denominazione del progetto.")
    if _blank(p.DES) and _blank(s.premessa):
        err(w, "DES", "Descrivi le opere in progetto (o compila la premessa).")
    for field, label in (("CTG", "la categoria dell'opera"), ("OGT", "il tipo di opera")):
        if _blank(getattr(p, field)):
            err(w, field, f"Scegli {label}.")
    if p.ENTE is None:
        err(w, "ENTE", "Scegli la Soprintendenza di riferimento.")
    if not p.FUR:
        err(w, "FUR", "Scegli almeno un funzionario responsabile.")
    for key in p.FUR:
        officer = vocab.fur.get(str(key))
        if officer is None:
            err(w, "FUR", f"Il funzionario {key} non è nell'elenco GNA.")
        elif p.ENTE is not None and officer.get("ENTE_key") != p.ENTE:
            warn(w, "FUR", f"{officer.get('FUR_value')} non risulta della Soprintendenza scelta.")
    for field, label in (("CMC", "Responsabile della compilazione"), ("CMR", "Responsabile dei contenuti")):
        value = getattr(p, field)
        if _blank(value) or not NAME_RE.search(value):
            err(w, field, f"{label}: scrivi «Cognome, Nome».")
    for field, label in (("LCR", "la regione"), ("LCP", "la provincia"), ("LCC", "il comune")):
        if getattr(p, field) is None:
            err(w, field, f"Scegli {label}.")
    for field, label in (("GPT", "il metodo di posizionamento"), ("GPM", "il grado di precisione"),
                         ("GPBB", "la base cartografica")):
        if _blank(getattr(p, field)):
            err(w, field, f"Scegli {label}.")
    if not p.presa_visione:
        err(w, "presa_visione", "Conferma di aver letto le istruzioni GNA su geometrie, download e invio.")

    if not s.gna_dsc:
        err(w, None, "Aggiungi almeno un'area indagata (DSC), anche se l'esito è negativo.")
    for d in s.gna_dsc:
        _check_dsc(s, d, err, warn)
    for n, f in enumerate(s.findings, start=1):
        _check_mosi(s, f, n, vocab, err, warn)
    return issues


def _inside_area(s: SurveillancePayload, geometry: dict) -> bool:
    if s.area is None:
        return True  # reported once at project level
    return all(point_in_polygon(c, s.area) for c in coords_of(geometry))


def _check_quota(value: str | None, where, field, err) -> None:
    if not _blank(value) and not QUOTA_RE.match(value.strip().replace("–", "-")):
        err(where, field, "Quota in metri, con al massimo due decimali (es. 12,40 o -1.5).")


def _check_dsc(s, d: GnaDscPayload, err, warn) -> None:
    w = f"Area indagata «{d.DSCV or d.id}»"
    geometry = d.geometry or s.area
    if _blank(d.DSCV):
        err(w, "DSCV", "Dai un nome all'area indagata.")
    if geometry is None:
        err(w, None, "Disegna l'area indagata.")
    elif geometry["type"] not in ("Polygon", "MultiPolygon"):
        err(w, None, "L'area indagata deve essere un poligono.")
    elif not _inside_area(s, geometry):
        err(w, None, "L'area indagata esce dall'area di progetto: GNA la rifiuta.")
    if _blank(d.DSCM):
        err(w, "DSCM", "Scegli il metodo di scavo.")
    year = d.DSCY or _year(s.start_date)
    if year is None:
        err(w, "DSCY", "Indica l'anno dello scavo.")
    elif year >= 2024 and _blank(d.MTAM) and _blank(d.MTAR):
        err(w, "MTAM", "Dal 2024 è obbligatoria la profondità massima raggiunta, assoluta o relativa.")
    _check_quota(d.MTAM, w, "MTAM", err)
    _check_quota(d.MTAR, w, "MTAR", err)
    if not _blank(d.MTAR):
        if _blank(d.MTA0):
            err(w, "MTA0", "Con la profondità relativa serve la quota 0 di riferimento.")
        _check_quota(d.MTA0, w, "MTA0", err)
    if _blank(d.NSC) and _blank(s.metodologia):
        err(w, "NSC", "Descrivi attività e stratigrafia dell'area (non i reperti).")
    if not _blank(d.DSCA) and not NAME_RE.search(d.DSCA):
        err(w, "DSCA", "Responsabile scientifico: scrivi «Cognome, Nome».")


def _check_mosi(s, f: FindingPayload, n: int, vocab: _Vocab, err, warn) -> None:
    w = f"Evidenza «{f.name or n}»"
    g = f.gna
    if f.geometry is None:
        err(w, None, "L'evidenza non ha una geometria sulla mappa.")
    else:
        if f.geometry["type"] in ("Point", "MultiPoint"):
            warn(w, None, "Per i dati di nuovi scavi GNA chiede il poligono dell'evidenza, non un punto.")
        if not _inside_area(s, f.geometry):
            err(w, None, "L'evidenza esce dall'area di progetto: GNA la rifiuta.")
    if g is None:
        err(w, None, "Compila i dati GNA dell'evidenza (definizione, situazione, cronologia, quote).")
        return
    if _blank(g.OGD):
        err(w, "OGD", "Scegli la definizione (OGD).")
    elif g.OGD == "6":
        err(w, "OGD", "I giacimenti paleontologici richiedono l'interpretazione: compilali in QGIS.")
    if _blank(g.OGB):
        err(w, "OGB", "Scegli la situazione attuale (OGB).")
    if _blank(f.name):
        err(w, "OGN", "Dai un nome all'evidenza.")
    if _blank(f.description) and _blank(f.interpretation):
        err(w, "DES", "Descrivi l'evidenza.")
    if _blank(g.DTR):
        err(w, "DTR", "Scegli la cronologia generica.")
    elif g.DTR not in DTR_UNDATED:
        period = vocab.dtr.get(g.DTR)
        if period is None:
            err(w, "DTR", f"Cronologia {g.DTR} non presente nel vocabolario GNA.")
        elif g.DTSI is None or g.DTSF is None:
            err(w, "DTSI", "Indica anno iniziale e finale (a.C. con il segno meno).")
        elif not (period["DTSI"] <= g.DTSI <= g.DTSF <= period["DTSF"]):
            err(w, "DTSI", f"Gli anni devono stare dentro «{period['DTR_value']}» "
                           f"({period['DTSI']} – {period['DTSF']}) e l'inizio precedere la fine.")
    if _blank(g.MTAM) and _blank(g.MTAX) and _blank(g.MTAR):
        err(w, "MTAM", "Per l'assistenza in corso d'opera serve almeno una quota (minima, massima o relativa).")
    for field in ("MTAM", "MTAX", "MTAR"):
        _check_quota(getattr(g, field), w, field, err)
    project = s.gna or GnaProjectPayload()
    for field in ("GPT", "GPM", "GPBB"):
        if _blank(getattr(g, field)) and _blank(getattr(project, field)):
            err(w, field, "Manca il posizionamento (metodo, precisione, base cartografica).")


# ---- package ----------------------------------------------------------------


async def build_package(s: SurveillancePayload) -> tuple[Path, list[Issue]]:
    """The filled template as a ZIP, plus the warnings. Raises GnaValidationError on errors."""
    vocab = await _load_vocab()
    issues = _check(s, vocab)
    if any(i.level == "errore" for i in issues):
        raise GnaValidationError(issues)
    template = await gna_sources.template_zip()

    work = Path(tempfile.mkdtemp(prefix="gna-", dir=settings.work_dir))
    folder = work / "Template_GNA"
    with zipfile.ZipFile(template) as z:
        z.extractall(folder)
    gpkg = next(folder.rglob(GPKG_NAME))
    _fill(gpkg, s, vocab)

    p = s.gna
    out = work / f"GNA_{p.CPR}.zip"
    root = gpkg.parent
    with zipfile.ZipFile(out, "w", zipfile.ZIP_DEFLATED) as z:
        for path in sorted(root.rglob("*")):
            if path.is_file():
                z.write(path, Path("Template_GNA") / path.relative_to(root))
            elif path.is_dir() and not any(path.iterdir()):
                z.writestr(str(Path("Template_GNA") / path.relative_to(root)) + "/", "")
        z.writestr("Template_GNA/LEGGIMI.txt", LEGGIMI)
        if issues:
            lines = [f"- [{i.level}] {i.where}{' · ' + i.field if i.field else ''}: {i.message}" for i in issues]
            z.writestr("Template_GNA/CONTROLLI.txt", "Avvisi da verificare in QGIS:\n\n" + "\n".join(lines) + "\n")
    shutil.rmtree(folder, ignore_errors=True)
    return out, issues


def _insert(conn: sqlite3.Connection, table: str, row: dict) -> None:
    columns = {r[1] for r in conn.execute(f'PRAGMA table_info("{table}")')}
    row = {k: v for k, v in row.items() if k in columns and v is not None}
    names = ", ".join(f'"{k}"' for k in row)
    marks = ", ".join("?" for _ in row)
    conn.execute(f'INSERT INTO "{table}" ({names}) VALUES ({marks})', list(row.values()))


def _mosi_table(geometry: dict) -> tuple[str, str]:
    kind = geometry["type"]
    if kind in ("Point", "MultiPoint"):
        return "MOSI_multipoint", "1"  # GET: georeferenziazione puntuale
    if kind in ("LineString", "MultiLineString"):
        return "MOSI_multilinea", "2"
    return "MOSI_multipolygon", "3"


def _fill(gpkg: Path, s: SurveillancePayload, vocab: _Vocab) -> None:
    p = s.gna
    assert p is not None and s.area is not None
    year = str(date.today().year)
    mopr_id = _uid()
    fur = [str(k) for k in p.FUR]

    conn = sqlite3.connect(gpkg)
    register_st_functions(conn)
    try:
        _insert(conn, "MOPR", {
            "geometry": gpkg_blob(s.area),
            "CPR": p.CPR, "EMC": p.EMC, "AMB": "archeologico", "AMA": AMA_ASSISTENZA,
            "CTG": p.CTG, "OGT": p.OGT, "OGN": (p.OGN or s.title)[:500],
            "DES": (p.DES or s.premessa or "")[:10000], "OGM": "{12}",
            "LCS": "Italia", "LCR": p.LCR, "LCP": p.LCP, "LCC": p.LCC,
            "GEL": "1", "GET": "1", "GEP": "EPSG:4326",
            "GPT": p.GPT, "GPM": p.GPM, "GPBB": p.GPBB, "MISZ": "area", "MISU": "mq",
            "FUR": _set(fur), "CMA": year, "CMC": p.CMC, "CMR": p.CMR, "ADP": "1",
            "RCGJ": "GNA", "DCMN": _uid(), "MOPR_ID": mopr_id, "RCGH": _uid(), "DCMY": "3",
            "ENTE": p.ENTE, "presa_visione": 1,
        })

        any_finding = bool(s.findings)
        for d in s.gna_dsc:
            dsc_year = d.DSCY or _year(s.start_date)
            _insert(conn, "DSC_multipolygon", {
                "geometry": gpkg_blob(d.geometry or s.area),
                "TSK": "DSC", "LIR": "I", "ESC": "GNA",
                "DSCV": d.DSCV[:250], "DSCH": _uid(), "DSCN": _uid(),
                "DSCD": " - ".join(x for x in (s.start_date, s.end_date) if x) or None,
                "DSCM": d.DSCM, "DSCT": AMA_ASSISTENZA, "DSCA": d.DSCA,
                "NSC": (d.NSC or s.metodologia or "")[:5000],
                "PVCS": "Italia", "PVCR": p.LCR, "PVCP": p.LCP, "PVCC": p.LCC,
                "GEL": "localizzazione fisica", "GET": "georeferenziazione areale", "GEP": "WGS84",
                "GPT": p.GPT, "GPM": p.GPM, "GPBB": p.GPBB, "ADSP": "1",
                "CMPD": year, "CMPN": p.CMC, "FUR": fur[0], "CPR_MOPR": p.CPR,
                "MTAM": d.MTAM, "MTAR": d.MTAR, "MTAS": d.MTAS, "MTA0": d.MTA0,
                "DSCEX": int(d.DSCEX or ("2" if any_finding else "1")),
                "MATS": 1 if d.MATS else 0, "DSCY": dsc_year,
            })

        for n, f in enumerate(s.findings, start=1):
            g = f.gna
            assert g is not None and f.geometry is not None
            table, get_key = _mosi_table(f.geometry)
            period = vocab.dtr.get(g.DTR or "")
            id_viarch = str(n)
            description = "\n\n".join(x for x in (f.description, f.interpretation) if x)
            _insert(conn, table, {
                "geom": gpkg_blob(f.geometry),
                "id_viarch": id_viarch, "ACCC": f"{p.CPR}_{id_viarch}", "CPR_MOPR": p.CPR,
                "MOPR_id": mopr_id, "AMB": "archeologico", "AMA": AMA_ASSISTENZA,
                "OGD": g.OGD, "OGT": _set(g.OGT), "OGN": f.name[:250], "OGB": g.OGB,
                "LCS": "Italia", "LCR": p.LCR, "LCP": p.LCP, "LCC": p.LCC, "PVL": g.PVL,
                "DES": description[:10000],
                "DTR": period["DTR_value"] if period else None,
                "DTR_new": int(g.DTR) if g.DTR else None,
                "DTSI": g.DTSI, "DTSF": g.DTSF, "DTT": g.DTT,
                "FNTP": g.FNTP, "OGM": g.OGM, "OGM_new": int(g.OGM),
                "GEL": "1", "GET": get_key, "GEP": "WGS84",
                "GPT": g.GPT or p.GPT, "GPM": g.GPM or p.GPM, "GPBB": g.GPBB or p.GPBB,
                "MTAM": g.MTAM, "MTAX": g.MTAX, "MTAR": g.MTAR, "MTAS": g.MTAS,
                "FUR": fur[0], "CMA": year, "CMC": p.CMC, "CMR": p.CMR, "ADP": "1",
                "RCGJ": "GNA", "DSCJ": "GNA", "DCMP": "4", "DCMN": _uid(), "SSK": 2,
            })

        # OGR keeps a feature count per table; refresh it so QGIS shows the right numbers.
        for (table,) in conn.execute("SELECT table_name FROM gpkg_ogr_contents").fetchall():
            (count,) = conn.execute(f'SELECT count(*) FROM "{table}"').fetchone()
            conn.execute("UPDATE gpkg_ogr_contents SET feature_count = ? WHERE table_name = ?", (count, table))
        conn.commit()
    finally:
        conn.close()
