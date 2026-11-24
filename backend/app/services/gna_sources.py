"""The Ministry's Template GNA and its vocabularies, fetched and cached.

Neither is vendored: the template ZIP has no stated licence for
redistribution, and both change when ICA releases a new version. The ZIP is
cached on disk in work_dir; vocabularies in memory for a day.
"""
import hashlib
import json
import re
import time
from pathlib import Path

import httpx

from app.config import settings

VOCAB_TTL_S = 24 * 3600
_VOCAB_NAME = re.compile(r"^[A-Za-z][A-Za-z_]{1,30}$")
_vocab_cache: dict[str, tuple[float, dict]] = {}


class GnaSourceError(RuntimeError):
    """The Ministry's server could not be reached or returned something unexpected."""


async def template_zip() -> Path:
    """Path to the Template GNA ZIP, downloading it once per URL."""
    if settings.gna_template_zip:
        return settings.gna_template_zip
    url = settings.gna_template_url
    target = settings.work_dir / "gna" / (hashlib.sha256(url.encode()).hexdigest()[:16] + ".zip")
    if target.exists() and target.stat().st_size > 0:
        return target
    target.parent.mkdir(parents=True, exist_ok=True)
    try:
        async with httpx.AsyncClient(timeout=60, follow_redirects=True) as client:
            res = await client.get(url)
    except httpx.HTTPError as exc:
        raise GnaSourceError(f"Template GNA non scaricabile da {url}: {exc}") from exc
    if res.status_code != 200 or not res.content.startswith(b"PK"):
        raise GnaSourceError(f"Template GNA non scaricabile da {url}: HTTP {res.status_code}")
    tmp = target.with_suffix(".part")
    tmp.write_bytes(res.content)
    tmp.replace(target)
    return target


async def vocabulary(name: str) -> dict:
    """A GNA vocabulary (GeoJSON FeatureCollection of attribute-only features)."""
    if not _VOCAB_NAME.match(name):
        raise ValueError(f"invalid vocabulary name: {name!r}")
    if settings.gna_vocab_dir:
        return json.loads((settings.gna_vocab_dir / f"{name}.json").read_text(encoding="utf-8"))
    hit = _vocab_cache.get(name)
    if hit and time.time() - hit[0] < VOCAB_TTL_S:
        return hit[1]
    url = f"{settings.gna_vocab_base}/{name}.json"
    try:
        async with httpx.AsyncClient(timeout=20, follow_redirects=True) as client:
            res = await client.get(url)
        res.raise_for_status()
        data = res.json()
    except (httpx.HTTPError, ValueError) as exc:
        if hit:  # stale is better than nothing
            return hit[1]
        raise GnaSourceError(f"Vocabolario GNA {name} non disponibile: {exc}") from exc
    _vocab_cache[name] = (time.time(), data)
    return data


def rows(vocab: dict) -> list[dict]:
    return [f.get("properties", {}) for f in vocab.get("features", [])]
