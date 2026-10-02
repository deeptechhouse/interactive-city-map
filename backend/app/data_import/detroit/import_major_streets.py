"""Detroit labelled arterials → major_streets (one merged line per street name).

PURPOSE
    Chicago's 25 major streets were hand-entered straight lines. Detroit's radial avenues
    (Woodward, Gratiot, Grand River, Michigan …) bend, so real geometry comes from OSM:
    one Overpass query for the named highway ways, grouped under a curated label, merged,
    simplified and clipped to the city. Keep the layer small — it is a label layer.

FLOW
    download() → Overpass `out geom` (geometry inline, no node join needed) → cache
    transform() → label_for(tags) → group → linemerge → clip to city → simplify

TRAPS
    - overpass-api.de answers HTTP 406 to httpx's default User-Agent (2026-10-02); use
      BaseImporter._http_post_json, which sends base_importer.HTTP_HEADERS.
    - OSM spells the same road several ways ("West Seven Mile Road", "W 7 Mile Rd",
      "Eight Mile Road" / M-102). STREET_LABELS matches with regexes, first match wins.
    - Clipping uses the council-district union (exact city outline) buffered by
      CLIP_BUFFER_DEG, because 8 Mile IS the north city limit and an unbuffered clip
      would shred it.
"""

from __future__ import annotations

import json
import re
from pathlib import Path

from shapely.geometry import LineString, MultiLineString, mapping
from shapely.ops import linemerge, unary_union

from app.data_import.base_importer import BaseImporter
from app.data_import.detroit.common import stable_id

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Curated label → regex on the OSM `name` (or `ref` for freeways). First match wins.
# ADJUSTABLE: add a street by appending (label, pattern); order matters only where two
# patterns could match the same way (Grand River before River-anything).
STREET_LABELS: tuple[tuple[str, str], ...] = (
    ("Woodward Ave", r"^woodward\b"),
    ("Gratiot Ave", r"^gratiot\b"),
    ("Grand River Ave", r"^grand river\b"),
    ("Michigan Ave", r"^michigan avenue\b|^michigan ave\b"),
    ("Jefferson Ave", r"^(east |west |e |w )?jefferson\b"),
    ("Fort St", r"^(east |west |e |w )?fort street\b"),
    ("Van Dyke", r"^van dyke\b"),
    ("Livernois Ave", r"^livernois\b"),
    ("W Grand Blvd", r"^(west|w) grand boulevard\b"),
    ("E Grand Blvd", r"^(east|e) grand boulevard\b"),
    ("7 Mile Rd", r"^(east |west |e |w )?(7|seven) mile\b"),
    ("8 Mile Rd", r"^(east |west |e |w )?(8|eight) mile\b"),
    ("Warren Ave", r"^(east |west |e |w )?warren avenue\b"),
    ("Mack Ave", r"^mack avenue\b"),
)
# Freeways by OSM `ref` (motorway ways). Label = the ref as people say it.
FREEWAY_REFS: tuple[str, ...] = ("I 75", "I 94", "I 96", "I 375", "M 10", "M 39")

# ADJUSTABLE: ~0.003° ≈ 250–330 m — keeps the boundary roads (8 Mile, parts of Jefferson)
# whole. 0 clips exactly at the city line.
CLIP_BUFFER_DEG = 0.003
# ADJUSTABLE: Douglas–Peucker tolerance in degrees (~5 m). Bigger = smaller file, coarser.
SIMPLIFY_DEG = 0.00005

# O(k) time, O(k) space — k = curated labels (compiled once at import)
_COMPILED = tuple((label, re.compile(pattern)) for label, pattern in STREET_LABELS)


def label_for(tags: dict) -> str | None:
    """O(k + r) time, O(r) space — k = curated labels (≈ 20); r = refs on the way (1–2).

    Curated label for an OSM way, or None when the way is not on the list.
    """
    highway = tags.get("highway", "")
    if highway in ("motorway", "motorway_link"):
        if highway == "motorway_link":
            return None
        refs = tags.get("ref", "").split(";")
        # O(r) time, O(1) space — r = refs on the way (usually 1–2)
        for ref in refs:
            normalised = ref.strip().replace("-", " ")
            if normalised in FREEWAY_REFS:
                return normalised.replace(" ", "-")
        return None
    name = tags.get("name", "").strip().lower()
    if not name:
        return None
    # O(k) time, O(1) space — k = curated labels
    for label, pattern in _COMPILED:
        if pattern.search(name):
            return label
    return None


def _overpass_query(bbox: str) -> str:
    """O(1) time, O(1) space — q = 1 fixed query string."""
    return f"""
[out:json][timeout:180];
(
  way["highway"~"^(motorway|trunk|primary|secondary)$"]["name"]({bbox});
  way["highway"="motorway"]["ref"]({bbox});
);
out tags geom;
"""


class DetroitMajorStreetsImporter(BaseImporter):
    """Config keys: major_streets.osm_overpass_bbox (s,w,n,e) and nested
    council_districts (for the city outline); see static_plan."""

    layer_name = "major_streets"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = highway ways in the bbox (one Overpass request)."""
        path = self._cache_path(".json")
        if path.exists():
            return path
        cfg = self._config.get("major_streets", self._config)
        bbox = cfg.get("osm_overpass_bbox", "42.20,-83.30,42.50,-82.90")
        data = self._http_post_json(OVERPASS_URL, data=f"data={_overpass_query(bbox)}", timeout=200.0)
        return self._save_json_cache(data, suffix=".json")

    def _city_outline(self):
        """O(v log v) time, O(v) space — v = council-district vertices. None if unavailable."""
        from app.data_import.detroit.import_boundaries import (
            DetroitCouncilDistrictsImporter, detroit_city_limits,
        )

        council_cfg = self._config.get("council_districts")
        if not council_cfg:
            return None
        council = DetroitCouncilDistrictsImporter(self._db_url, self._city_id, council_cfg)
        return detroit_city_limits(council.transform(council.download())).buffer(CLIP_BUFFER_DEG)

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v log v) time, O(v) space — v = vertices of matched ways.

        label_for() is constant per way: a fixed list of ≈ 20 patterns.
        """
        elements = json.loads(raw_path.read_text()).get("elements", [])
        grouped: dict[str, list[LineString]] = {}
        # O(w + v) time, O(v) space — w = ways (label_for is a fixed ≈ 20 patterns); v = vertices
        for el in elements:
            if el.get("type") != "way":
                continue
            label = label_for(el.get("tags", {}))
            # O(p) time, O(p) space — p = points on this way
            coords = [(pt["lon"], pt["lat"]) for pt in el.get("geometry", []) or []]
            if label and len(coords) >= 2:
                grouped.setdefault(label, []).append(LineString(coords))

        outline = self._city_outline()
        records: list[dict] = []
        # O(v log v) time, O(v) space — v = vertices across all labels (merge + clip)
        for label, lines in sorted(grouped.items()):
            geom = linemerge(unary_union(lines))
            if outline is not None:
                geom = geom.intersection(outline)
            geom = geom.simplify(SIMPLIFY_DEG, preserve_topology=False)
            if geom.is_empty:
                continue
            if isinstance(geom, LineString):
                geom = MultiLineString([geom])
            elif not isinstance(geom, MultiLineString):
                # O(g) time, O(g) space — g = parts of a mixed GeometryCollection
                parts = [g for g in getattr(geom, "geoms", []) if isinstance(g, LineString)]
                if not parts:
                    continue
                geom = MultiLineString(parts)
            records.append({
                "id": stable_id("det-street", re.sub(r"\W+", "-", label.lower())),
                "city_id": self._city_id,
                "name": label,
                "geom_json": json.dumps(mapping(geom)),
            })
        self._log.info("transformed", count=len(records), ways=len(elements))
        return records

    def load(self, records: list[dict]) -> int:
        """O(1) time, O(1) space — r = 0 rows written. Static-mode only, like the boundaries."""
        raise NotImplementedError("major_streets: database load not wired yet (static only)")
