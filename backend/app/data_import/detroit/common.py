"""Small helpers shared by the Detroit importers — geometry shaping and cached ArcGIS pulls.

PURPOSE
    Every Detroit source is an ArcGIS layer and every Detroit table wants the same few
    shapes (MultiPolygon for areas, Point for markers, text ids for numbers). Keeping those
    conversions here means each importer's transform() is only its field mapping.

ARCHITECTURE
    cached_arcgis_download()  — I/O: page an ArcGIS layer once, cache the GeoJSON on disk
    split_arcgis_rings()      — pure: ArcGIS multi-ring "Polygon" → real polygons
    as_multipolygon_json()    — pure: any areal geometry → MultiPolygon GeoJSON text
    int_text()                — pure: 4.0 / "09" / 4 → "4"
    stable_id()               — pure: deterministic row id (same building → same id
                                every rebuild, so saved contact-list entries survive)

WHAT THIS DOES NOT DO: no database access. load() lives on each importer.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely import MultiPolygon, Polygon, STRtree  # STRtree: R-tree, O(log n + k) box queries
from shapely.geometry import LinearRing, mapping, shape

from app.data_import.arcgis_helper import ArcGISFeatureServerClient
from app.data_import.base_importer import BaseImporter


def cached_arcgis_download(
    importer: BaseImporter,
    *,
    url: str,
    source_srid: int = 4326,
    page_size: int = 1000,
    where: str = "1=1",
    out_fields: str = "*",
    output_format: str = "geojson",
    suffix: str = ".geojson",
) -> Path:
    """O(n) time, O(n) space — n = features matching `where`.

    Page the layer into one FeatureCollection and cache it as <city>_<layer><suffix>.
    The cache check is a file-exists test, NOT BaseImporter._load_json_cache(): that
    parses the whole file just to see whether it exists, which for SEMCOG buildings
    (~240K polygons, ~150 MB) costs seconds and gigabytes for nothing.
    TRAP: delete the cache file after changing `where`/`out_fields`, or the old pull is
    reused silently. Cache dir: $TMPDIR/citymap_import_cache.
    """
    path = importer._cache_path(suffix)  # noqa: SLF001 — BaseImporter helper for subclasses
    if path.exists():
        return path
    if not url:
        raise ValueError(f"No URL configured for {importer.layer_name}")
    client = ArcGISFeatureServerClient(
        url, source_srid=source_srid, page_size=page_size, where=where,
        out_fields=out_fields, output_format=output_format,
    )
    path.write_text(json.dumps(client.download_all()))
    return path


def read_features(raw_path: Path) -> list[dict]:
    """O(n) time, O(n) space — n = features in the cached collection."""
    raw = json.loads(raw_path.read_text())
    return raw.get("features", []) if isinstance(raw, dict) else []


def split_arcgis_rings(geometry: dict | None) -> list[Polygon]:
    """O(v + r log o + K) time, O(v) space — v = vertices; r = hole rings; o = outer rings; K = containment work on bounding-box hits.

    arcgis_helper turns an ArcGIS `rings` list into ONE GeoJSON Polygon whatever the ring
    count, so a 2-part building became one polygon whose second part is a false "hole"
    (audit 2026-10-02). ArcGIS's own rule decides instead: outer rings run CLOCKWISE,
    holes counter-clockwise. Each clockwise ring starts a polygon; each hole joins the
    outer ring that contains it. Real GeoJSON Multi/Polygons pass through split by part.

    Hole → shell lookup goes through an R-tree of the shells (2026-10-06): the old
    every-hole-against-every-shell scan was O(r·o) and relied on "almost always ≤ 3
    rings", which a campus or complex multi-part footprint can exceed. Candidates are
    still tried in shell order, so "first containing shell wins" is unchanged.
    """
    if not geometry:
        return []
    gtype = geometry.get("type")
    if gtype == "MultiPolygon":
        # O(v) time, O(v) space — v = vertices across parts
        return [p for p in shape(geometry).geoms if not p.is_empty]
    if gtype != "Polygon":
        return []
    rings = geometry.get("coordinates") or []
    if len(rings) <= 1:
        poly = Polygon(rings[0]) if rings and len(rings[0]) >= 4 else None
        return [poly] if poly is not None and not poly.is_empty else []
    outers: list[list] = []
    holes: list[list] = []
    # O(v) time, O(v) space — v = vertices across rings
    for ring in rings:
        if len(ring) < 4:
            continue
        (holes if LinearRing(ring).is_ccw else outers).append(ring)
    if not outers:  # counter-clockwise outer (non-ArcGIS writer): treat rings as parts
        outers, holes = holes, []
    # O(o) time, O(v) space — o = outer rings; v = their vertices
    shells = [Polygon(o) for o in outers]
    # O(o) time, O(o) space — o = outer rings
    hole_lists: list[list] = [[] for _ in outers]
    tree = STRtree(shells) if holes else None
    # O(r log o + K) time, O(1) space — r = hole rings; o = outer rings; K = containment work on bbox hits
    for hole in holes:
        probe = Polygon(hole).representative_point()
        # O(k) time, O(1) space — k = containment work for this hole's bbox hits (sums to K)
        # bigo-lint: disable=BIGO006 — amortised: per-hole candidate work sums to K across the outer loop
        for idx in sorted(tree.query(probe)):
            if shells[idx].contains(probe):
                hole_lists[idx].append(hole)
                break
    # O(o) time, O(v) space — o = outer rings; v = vertices
    polys = [Polygon(o, h) for o, h in zip(outers, hole_lists)]
    # O(o) time, O(o) space — o = polygons
    return [p for p in polys if not p.is_empty]


def as_multipolygon_json(geometry: dict | None) -> str | None:
    """O(v) time, O(v) space — v = vertices. Areal geometry → MultiPolygon GeoJSON text."""
    parts = split_arcgis_rings(geometry)
    if not parts:
        return None
    return json.dumps(mapping(MultiPolygon(parts)))


def int_text(value) -> str | None:
    """O(1) time, O(1) space — d = 1 value. 4.0 / "09" / 4 → "4"; non-numbers pass through."""
    if value is None:
        return None
    text = str(value).strip()
    if not text:
        return None
    try:
        return str(int(float(text)))
    except ValueError:
        return text


def stable_id(prefix: str, source_id, part: int | None = None) -> str:
    """O(1) time, O(1) space — d = 1 id. e.g. ('det-bldg', 1001568, 1) → 'det-bldg-1001568-1'.

    Static tiles have no database, so the id the popup uses for "Add to contact list"
    must not change between rebuilds — a uuid4 would orphan every saved entry.
    """
    base = f"{prefix}-{source_id}"
    return base if part is None else f"{base}-{part}"
