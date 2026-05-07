"""Generates the Sovrintendenza DOCX for a Surveillance.

We build the document programmatically (python-docx) rather than from a fixed
.docx template so that the v1 default is reproducible and version-controllable.
When the user supplies a real Sovrintendenza template, swap this module for a
docxtpl-based renderer pointing at templates/sorveglianza.docx.

The structure follows the canonical sezioni di una sorveglianza archeologica:
  1. Premessa
  2. Inquadramento territoriale
  3. Inquadramento storico-archeologico
  4. Inquadramento geologico e geomorfologico
  5. Metodologia
  6. Risultati della sorveglianza
  7. Documentazione fotografica
  8. Conclusioni
"""
from __future__ import annotations

from pathlib import Path
from uuid import UUID

from docx import Document
from docx.enum.text import WD_ALIGN_PARAGRAPH
from docx.shared import Cm, Pt, RGBColor
from sqlalchemy.orm import Session

from app.config import settings
from app.models import Surveillance


def _heading(doc, text: str, level: int = 1) -> None:
    h = doc.add_heading(text, level=level)
    for run in h.runs:
        run.font.color.rgb = RGBColor(0x33, 0x33, 0x33)


def _para(doc, text: str | None, italic: bool = False) -> None:
    if not text:
        text = "—"
    p = doc.add_paragraph()
    run = p.add_run(text)
    run.italic = italic
    run.font.size = Pt(11)
    p.paragraph_format.space_after = Pt(6)


def _kv_table(doc, rows: list[tuple[str, str | None]]) -> None:
    table = doc.add_table(rows=len(rows), cols=2)
    table.autofit = False
    for i, (k, v) in enumerate(rows):
        c0, c1 = table.rows[i].cells
        c0.text = k
        c1.text = v or "—"
        for run in c0.paragraphs[0].runs:
            run.bold = True
        c0.width = Cm(5.5)
        c1.width = Cm(11.0)


def render_docx(db: Session, surveillance_id: UUID) -> Path:
    s = db.get(Surveillance, surveillance_id)
    if s is None:
        raise ValueError(f"Surveillance {surveillance_id} not found")

    doc = Document()

    # Title block
    title = doc.add_heading("RELAZIONE DI SORVEGLIANZA ARCHEOLOGICA", level=0)
    title.alignment = WD_ALIGN_PARAGRAPH.CENTER

    sub = doc.add_paragraph(s.title)
    sub.alignment = WD_ALIGN_PARAGRAPH.CENTER
    sub.runs[0].bold = True
    sub.runs[0].font.size = Pt(14)

    doc.add_paragraph()

    _kv_table(
        doc,
        [
            ("Protocollo", s.protocollo),
            ("Committente", s.committente),
            ("Direttore tecnico", s.direttore_tecnico),
            ("Soprintendenza competente", s.sabap),
            ("Comune", s.comune),
            ("Provincia", s.provincia),
            ("Foglio catastale", s.foglio_catastale),
            ("Particelle", s.particelle),
            (
                "Periodo di indagine",
                f"{s.start_date or '—'} – {s.end_date or '—'}",
            ),
        ],
    )

    doc.add_page_break()

    _heading(doc, "1. Premessa")
    _para(
        doc,
        s.premessa
        or (
            "La presente relazione documenta le attività di sorveglianza archeologica "
            "condotte ai sensi del D.Lgs. 42/2004 e del D.Lgs. 36/2023, su prescrizione "
            "della Soprintendenza Archeologia, Belle Arti e Paesaggio competente per "
            "territorio."
        ),
    )

    _heading(doc, "2. Inquadramento territoriale")
    _para(
        doc,
        f"L'area oggetto di intervento è ubicata nel comune di "
        f"{s.comune or '—'} (provincia di {s.provincia or '—'}), foglio catastale "
        f"{s.foglio_catastale or '—'}, particelle {s.particelle or '—'}.",
    )
    _para(
        doc,
        "[Estratti cartografici: CTR, ortofoto da Geoportale Nazionale (PCN). "
        "Inserire qui o in allegato.]",
        italic=True,
    )

    _heading(doc, "3. Inquadramento storico-archeologico")
    _para(
        doc,
        "[Sintesi del contesto archeologico noto, vincoli archeologici e "
        "monumentali, evidenze pregresse. Estratto dalla consultazione di "
        "Vincoli in Rete e dalla bibliografia di riferimento.]",
        italic=True,
    )

    _heading(doc, "4. Inquadramento geologico e geomorfologico")
    _para(
        doc,
        "[Estratto dalla Carta Geologica d'Italia (CARG) e dai dati ISPRA. "
        "Descrizione del substrato e delle dinamiche geomorfologiche rilevanti.]",
        italic=True,
    )

    _heading(doc, "5. Metodologia")
    _para(doc, s.metodologia)

    _heading(doc, "6. Risultati della sorveglianza")
    _para(doc, s.risultati)

    if s.findings:
        _heading(doc, "6.1 Evidenze archeologiche", level=2)
        for i, f in enumerate(s.findings, 1):
            _heading(doc, f"Evidenza {i}: {f.name}", level=3)
            _para(doc, f.description)
            if f.interpretation:
                _para(doc, f"Interpretazione: {f.interpretation}")
            if f.start_date or f.end_date:
                _para(doc, f"Datazione: {f.start_date or '—'} / {f.end_date or '—'}")
            if f.units:
                _heading(doc, "Unità Stratigrafiche", level=4)
                for u in f.units:
                    _para(
                        doc,
                        f"US {u.number} ({u.type or '—'}): "
                        f"{u.definition or '—'} — {u.description or ''}",
                    )

    _heading(doc, "7. Documentazione fotografica")
    if s.photos:
        for p in s.photos:
            abs_path = settings.uploads_dir / p.storage_path
            if abs_path.is_file():
                try:
                    doc.add_picture(str(abs_path), width=Cm(14))
                    cap = doc.add_paragraph(p.caption or p.filename)
                    cap.alignment = WD_ALIGN_PARAGRAPH.CENTER
                    cap.runs[0].italic = True
                except Exception:
                    _para(doc, f"[immagine non leggibile: {p.filename}]", italic=True)
    else:
        _para(doc, "[Nessuna documentazione fotografica acquisita.]", italic=True)

    _heading(doc, "8. Conclusioni")
    _para(doc, s.conclusioni)

    out_dir = settings.exports_dir / str(s.id)
    out_dir.mkdir(parents=True, exist_ok=True)
    out_path = out_dir / "sorveglianza.docx"
    doc.save(out_path)
    return out_path
