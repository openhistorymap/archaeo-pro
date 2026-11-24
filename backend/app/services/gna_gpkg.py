"""Just enough GeoPackage to fill the official Template GNA without GDAL.

A GeoPackage is a SQLite file whose geometry columns hold a small header plus
standard WKB. The template's spatial-index triggers call ST_IsEmpty and
ST_MinX/MaxX/MinY/MaxY (normally supplied by GDAL/SpatiaLite); we register
pure-Python versions that read the envelope we write in the header, so plain
`sqlite3` can insert rows and the R-tree indexes stay correct.
"""
import sqlite3
import struct
from collections.abc import Iterable

SRS_WGS84 = 4326

# WKB geometry type codes (2D)
_MULTIPOINT, _MULTILINESTRING, _MULTIPOLYGON = 4, 5, 6
_POINT, _LINESTRING, _POLYGON = 1, 2, 3

Coord = tuple[float, float]


def to_multi(geometry: dict) -> dict:
    """Point → MultiPoint, LineString → MultiLineString, Polygon → MultiPolygon.
    The Template GNA only has multi-geometry layers."""
    kind = geometry["type"]
    if kind == "Point":
        return {"type": "MultiPoint", "coordinates": [geometry["coordinates"]]}
    if kind == "LineString":
        return {"type": "MultiLineString", "coordinates": [geometry["coordinates"]]}
    if kind == "Polygon":
        return {"type": "MultiPolygon", "coordinates": [geometry["coordinates"]]}
    if kind in ("MultiPoint", "MultiLineString", "MultiPolygon"):
        return geometry
    raise ValueError(f"Unsupported geometry type for GNA: {kind}")


def coords_of(geometry: dict) -> list[Coord]:
    """Every vertex of a GeoJSON geometry (single or multi)."""
    g = to_multi(geometry)
    if g["type"] == "MultiPoint":
        return [(p[0], p[1]) for p in g["coordinates"]]
    if g["type"] == "MultiLineString":
        return [(p[0], p[1]) for line in g["coordinates"] for p in line]
    return [(p[0], p[1]) for poly in g["coordinates"] for ring in poly for p in ring]


def _point(c: Iterable[float]) -> bytes:
    x, y = list(c)[:2]
    return struct.pack("<BIdd", 1, _POINT, float(x), float(y))


def _ring(coords: list) -> bytes:
    return struct.pack("<I", len(coords)) + b"".join(
        struct.pack("<dd", float(c[0]), float(c[1])) for c in coords
    )


def _linestring(coords: list) -> bytes:
    return struct.pack("<BI", 1, _LINESTRING) + _ring(coords)


def _polygon(rings: list) -> bytes:
    return struct.pack("<BII", 1, _POLYGON, len(rings)) + b"".join(_ring(r) for r in rings)


def wkb(geometry: dict) -> bytes:
    """Little-endian 2D WKB of a GeoJSON geometry, promoted to its multi type."""
    g = to_multi(geometry)
    parts = g["coordinates"]
    if g["type"] == "MultiPoint":
        code, body = _MULTIPOINT, b"".join(_point(p) for p in parts)
    elif g["type"] == "MultiLineString":
        code, body = _MULTILINESTRING, b"".join(_linestring(line) for line in parts)
    else:
        code, body = _MULTIPOLYGON, b"".join(_polygon(poly) for poly in parts)
    return struct.pack("<BII", 1, code, len(parts)) + body


def gpkg_blob(geometry: dict, srs_id: int = SRS_WGS84) -> bytes:
    """GeoPackage binary: 'GP', version 0, flags (little-endian, xy envelope), srs, envelope, WKB."""
    xs, ys = zip(*coords_of(geometry), strict=True)
    flags = 0b0000_0011  # bit 0: little-endian; bits 1-3 = 1: envelope [minx, maxx, miny, maxy]
    header = b"GP" + struct.pack("<BBi", 0, flags, srs_id)
    envelope = struct.pack("<dddd", min(xs), max(xs), min(ys), max(ys))
    return header + envelope + wkb(geometry)


def _envelope(blob: bytes | None) -> tuple[float, float, float, float] | None:
    if not blob or blob[:2] != b"GP":
        return None
    flags = blob[3]
    if (flags >> 1) & 0b111 == 0:
        return None
    order = "<" if flags & 1 else ">"
    return struct.unpack(order + "dddd", blob[8:40])


def register_st_functions(conn: sqlite3.Connection) -> None:
    """The functions the template's R-tree triggers need."""

    def is_empty(blob):
        if not blob or blob[:2] != b"GP":
            return 1
        return 1 if blob[3] & 0b1_0000 else 0

    def bound(i):
        def f(blob):
            env = _envelope(blob)
            return None if env is None else env[i]

        return f

    conn.create_function("ST_IsEmpty", 1, is_empty, deterministic=True)
    conn.create_function("ST_MinX", 1, bound(0), deterministic=True)
    conn.create_function("ST_MaxX", 1, bound(1), deterministic=True)
    conn.create_function("ST_MinY", 1, bound(2), deterministic=True)
    conn.create_function("ST_MaxY", 1, bound(3), deterministic=True)


def point_in_polygon(pt: Coord, polygon: dict) -> bool:
    """Even-odd test of a point against a GeoJSON Polygon/MultiPolygon (holes respected).
    Points on the boundary count as inside."""
    x, y = pt
    g = to_multi(polygon)
    if g["type"] != "MultiPolygon":
        raise ValueError("container must be a polygon")
    for poly in g["coordinates"]:
        inside = False
        for ring in poly:
            n = len(ring)
            for i in range(n):
                x1, y1 = ring[i][0], ring[i][1]
                x2, y2 = ring[(i + 1) % n][0], ring[(i + 1) % n][1]
                if _on_segment(x, y, x1, y1, x2, y2):
                    return True
                if (y1 > y) != (y2 > y) and x < (x2 - x1) * (y - y1) / (y2 - y1) + x1:
                    inside = not inside
        if inside:
            return True
    return False


def _on_segment(x, y, x1, y1, x2, y2, eps=1e-12) -> bool:
    cross = (x - x1) * (y2 - y1) - (y - y1) * (x2 - x1)
    if abs(cross) > eps:
        return False
    return min(x1, x2) - eps <= x <= max(x1, x2) + eps and min(y1, y2) - eps <= y <= max(y1, y2) + eps
