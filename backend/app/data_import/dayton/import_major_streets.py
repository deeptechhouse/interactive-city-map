"""Dayton arterial streets → major_streets (labels on the map).

WHY: the shared import_streets is a "TIGER for Cook County" stub, and the fork never loaded
    major_streets. Here they come from the City's street centerlines (MapLayers_Citywide/312),
    filtered by FHWA functional class.

FILTER (verified 2026-10-02): FUNCT_CLAS holds FHWA codes as text. Counts county-wide:
    11 interstate 276 · 12 freeway/expressway 425 · 14 principal arterial 2,353 ·
    16 minor arterial 4,617 · 17 collector 5,156 · 19 local 41,168 · blank 27,034.
    ARTERIAL_CLASSES keeps 11–16: 7,649 segments inside the city envelope.

FLOW
    download() → fetch_arcgis(312, where FUNCT_CLAS IN (…), envelope = city bbox)
    transform() → group segments by GEONAME → linemerge → one row per merged LineString
    (major_streets.geom is LINESTRING in PostGIS, so rows stay single lines; a street with
    gaps becomes several rows with the same name, which labels fine)
"""

import json
import uuid
from collections import defaultdict
from pathlib import Path

from shapely.geometry import LineString, MultiLineString, mapping, shape
from shapely.ops import linemerge

from app.data_import.base_importer import BaseImporter
from app.data_import.dayton._sources import (
    DAYTON_CITY_BBOX,
    fetch_arcgis,
    read_features,
    replace_rows,
)
from app.data_import.dayton.field_maps import DAYTON_STREETS
from app.data_import.field_map import pick

# ADJUSTABLE: add "17" (collectors, +5K segments) for denser labels at high zoom; drop
# "16" to label only principal arterials and highways.
ARTERIAL_CLASSES: tuple[str, ...] = ("11", "12", "14", "16")


def arterial_where(classes: tuple[str, ...] = ARTERIAL_CLASSES) -> str:
    """O(c) time, O(c) space — c = classes. Values are constants, never user input."""
    # O(c) time, O(c) space — c = classes
    quoted = ",".join(f"'{c}'" for c in classes)
    return f"FUNCT_CLAS IN ({quoted})"


def _lines(geom_json: dict | None) -> list[LineString]:
    """O(v) time, O(v) space — v = vertices. LineString/MultiLineString → list of lines."""
    if not geom_json:
        return []
    try:
        geom = shape(geom_json)
    except Exception:  # noqa: BLE001 — malformed upstream geometry is skipped
        return []
    if isinstance(geom, LineString):
        return [geom]
    if isinstance(geom, MultiLineString):
        return list(geom.geoms)
    return []


class DaytonMajorStreetsImporter(BaseImporter):
    layer_name = "major_streets"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = arterial segments in the city envelope (~7.6K)."""
        url = self._config.get("url") or DAYTON_STREETS.source
        return fetch_arcgis(
            self,
            url,
            where=arterial_where(),
            out_fields="OBJECTID_1,GEONAME,FUNCT_CLAS",
            envelope=DAYTON_CITY_BBOX,
        )

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n log n) time, O(n) space — n = segment vertices (linemerge sorts endpoints)."""
        by_name: dict[str, list[LineString]] = defaultdict(list)
        # O(n) time, O(n) space — n = features
        for feat in read_features(raw_path):
            name = pick(feat.get("properties") or {}, DAYTON_STREETS, "name")
            if name:
                by_name[name].extend(_lines(feat.get("geometry")))
        records: list[dict] = []
        # O(n log n) time, O(n) space — n = segments over all names (each merged once)
        for name, lines in by_name.items():
            if not lines:
                continue
            merged = linemerge(lines)
            parts = list(merged.geoms) if isinstance(merged, MultiLineString) else [merged]
            # bigo-lint: disable=BIGO006 — amortised: each merged part is emitted once (n)
            # O(p) time, O(p) space — p = merged parts of this street
            for part in parts:
                records.append(
                    {
                        "id": str(uuid.uuid4()),
                        "city_id": self._city_id,
                        "name": name,
                        "geom_json": json.dumps(mapping(part)),
                    }
                )
        self._log.info("transformed", streets=len(by_name), rows=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = rows. Delete this city's rows, then insert."""
        return replace_rows(self, "major_streets", ("name",), records)
