"""DOCX → PDF via LibreOffice headless.

LibreOffice is the only realistic open path that preserves the docx layout.
We invoke it as a subprocess; it writes the .pdf alongside the .docx.
"""
from __future__ import annotations

import shutil
import subprocess
from pathlib import Path

from app.config import settings


class PdfConversionError(RuntimeError):
    pass


def docx_to_pdf(docx_path: Path) -> Path:
    if not docx_path.is_file():
        raise FileNotFoundError(docx_path)

    bin_path = shutil.which(settings.libreoffice_bin) or settings.libreoffice_bin

    cmd = [
        bin_path,
        "--headless",
        "--norestore",
        "--nologo",
        "--convert-to",
        "pdf",
        "--outdir",
        str(docx_path.parent),
        str(docx_path),
    ]
    try:
        proc = subprocess.run(cmd, capture_output=True, timeout=120, check=False)
    except FileNotFoundError as exc:
        raise PdfConversionError(
            f"LibreOffice not found at '{bin_path}'. Install it or set LIBREOFFICE_BIN."
        ) from exc
    except subprocess.TimeoutExpired as exc:
        raise PdfConversionError("LibreOffice conversion timed out") from exc

    if proc.returncode != 0:
        raise PdfConversionError(
            f"LibreOffice exited with {proc.returncode}: {proc.stderr.decode(errors='replace')}"
        )

    pdf_path = docx_path.with_suffix(".pdf")
    if not pdf_path.is_file():
        raise PdfConversionError("LibreOffice did not produce a PDF")
    return pdf_path
