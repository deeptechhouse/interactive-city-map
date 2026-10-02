"""Dayton parks → parks table / parks tile layer, never the parcels table.

WHY: the fork's dayton.yaml declared an Overpass `parks` source that run.py never read.
    Its ParkLayer then painted the unfiltered `parcels` source-layer green. Parks need
    their own layer (frontend sourceLayers.parks = 'parks').

SOURCE: OSM Overpass, leisure=park|nature_reserve|garden ways and relations inside the
    profile bbox. Five Rivers MetroParks has no public GIS layer we could find on
    2026-10-02 (the fork's note says the same), so OSM is the source; MetroParks show up
    with operator="Five Rivers MetroParks" and get park_type "metropark".

FLOW
    download() → one Overpass query (`out geom` = coordinates inline, no node lookup)
    transform() → closed ways → Polygon; multipolygon relations → polygonize(outer) − inner
                → drop unnamed pieces under MIN_UNNAMED_AREA_M2

TRAP: overpass-api.de answers HTTP 406 to generic user agents (seen 2026-10-02). The
    shared base_importer now sends a descriptive User-Agent; don't bypass _http_post_json.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import LineString, MultiPolygon, Polygon, mapping
from shapely.ops import polygonize, unary_union  # ops.polygonize accepts one noded geometry

from app.data_import.base_importer import BaseImporter
from app.data_import.dayton._sources import replace_rows

# Tried in order. overpass-api.de answered 504 (busy) on 2026-10-02 while the
# private.coffee mirror answered 200. ADJUSTABLE: add/remove public mirrors here.
OVERPASS_URLS: tuple[str, ...] = (
    "https://overpass-api.de/api/interpreter",
    "https://overpass.private.coffee/api/interpreter",
)
DEFAULT_BBOX = "39.65,-84.35,39.85,-84.05"  # south,west,north,east (Overpass order)

# ADJUSTABLE: unnamed green areas smaller than this are dropped (traffic islands, lawn
# strips). Raise to declutter; lower to keep pocket parks.
MIN_UNNAMED_AREA_M2 = 500.0
_M2_PER_DEG2 = 111_000.0 * 85_400.0  # at 39.75°N; ±1 % across the bbox

LEISURE_TYPES = ("park", "nature_reserve", "garden")


def build_query(bbox: str) -> str:
    """O(1) time, O(1) space — t = 3 fixed leisure types."""
    # O(1) time, O(1) space — t = 3 fixed leisure types
    clauses = "".join(
        f'way["leisure"="{t}"]({bbox});relation["leisure"="{t}"]({bbox});' for t in LEISURE_TYPES
    )
    return f"[out:json][timeout:120];({clauses});out geom;"


def _ring(points: list[dict]) -> list[tuple[float, float]]:
    """O(p) time, O(p) space — p = points in the way."""
    # O(p) time, O(p) space — p = points
    return [(pt["lon"], pt["lat"]) for pt in points if "lon" in pt and "lat" in pt]


def way_polygon(element: dict):
    """O(p) time, O(p) space — p = points. Closed way → Polygon; open way → None."""
    coords = _ring(element.get("geometry") or [])
    if len(coords) < 4 or coords[0] != coords[-1]:
        return None
    poly = Polygon(coords)
    # Self-touching OSM rings are common; buffer(0) repairs them (may yield a MultiPolygon).
    return poly if poly.is_valid else poly.buffer(0)


def relation_polygon(element: dict):
    """O(p log p) time, O(p) space — p = member points (polygonize sorts edges).

    Outer member ways are stitched with polygonize (they are often split into many ways);
    inner ways become holes.
    """
    outer: list[LineString] = []
    inner: list[LineString] = []
    # O(p) time, O(p) space — p = member points
    for member in element.get("members") or []:
        coords = _ring(member.get("geometry") or [])
        if member.get("type") != "way" or len(coords) < 2:
            continue
        (inner if member.get("role") == "inner" else outer).append(LineString(coords))
    if not outer:
        return None
    shell = unary_union(list(polygonize(unary_union(outer))))
    if inner:
        holes = unary_union(list(polygonize(unary_union(inner))))
        shell = shell.difference(holes)
    return None if shell.is_empty else shell


def to_multipolygon(geom) -> MultiPolygon | None:
    """O(g) time, O(g) space — g = parts. Keeps only polygon parts (overlays can emit lines)."""
    if isinstance(geom, MultiPolygon):
        return geom
    if isinstance(geom, Polygon):
        return MultiPolygon([geom])
    # O(g) time, O(g) space — g = parts of a GeometryCollection
    parts = [g for g in getattr(geom, "geoms", []) if isinstance(g, Polygon) and not g.is_empty]
    return MultiPolygon(parts) if parts else None


def park_type(tags: dict) -> str:
    """O(1) time, O(1) space — n = one tag lookup."""
    operator = (tags.get("operator") or "").lower()
    if "metropark" in operator:
        return "metropark"
    return tags.get("leisure") or "park"


class DaytonParksImporter(BaseImporter):
    layer_name = "parks"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = park features in the bbox (low hundreds)."""
        cached = self._cache_path(".json")
        if cached.exists():
            return cached
        bbox = self._config.get("osm_overpass_bbox", DEFAULT_BBOX)
        query = f"data={build_query(bbox)}"
        last_error: Exception | None = None
        # O(u) time, O(1) space — u = mirrors tried (2)
        for url in OVERPASS_URLS:
            try:
                data = self._http_post_json(url, data=query, timeout=180.0)
            except Exception as exc:  # noqa: BLE001 — try the next mirror, re-raise at the end
                self._log.warning("overpass_failed", url=url, error=str(exc)[:120])
                last_error = exc
                continue
            return self._save_json_cache(data, suffix=".json")
        raise RuntimeError("every Overpass mirror failed") from last_error

    def transform(self, raw_path: Path) -> list[dict]:
        """O(P log P) time, O(P) space — P = points across all park geometries."""
        raw = json.loads(Path(raw_path).read_text())
        records: list[dict] = []
        # O(P log P) time, O(P) space — P = points over all elements (relations polygonize)
        for element in raw.get("elements", []):
            tags = element.get("tags") or {}
            if element.get("type") == "way":
                geom = way_polygon(element)
            elif element.get("type") == "relation":
                geom = relation_polygon(element)
            else:
                continue
            if geom is None or geom.is_empty:
                continue
            name = (tags.get("name") or "").strip() or None
            if name is None and geom.area * _M2_PER_DEG2 < MIN_UNNAMED_AREA_M2:
                continue
            multi = to_multipolygon(geom)
            if multi is None:
                continue
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "city_id": self._city_id,
                    "name": name,
                    "park_type": park_type(tags),
                    "osm_id": f"{element['type']}/{element.get('id')}",
                    "geom_json": json.dumps(mapping(multi)),
                }
            )
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records. Delete this city's parks, then insert."""
        return replace_rows(self, "parks", ("name", "park_type"), records)
