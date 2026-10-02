"""Detroit building footprints from SEMCOG (Building_Footprints__2020, layer 60).

PURPOSE
    One row per building part, WGS84, with the fields the building popup reads
    (address, name, year_built, floors, parcel_pin) plus the two booleans the frontend
    building layer filters on. zoning_code / zone_class are added later by the static
    plan's enrich step (static_plan.enrich_detroit).

FLOW
    download() → common.cached_arcgis_download(where = Detroit sub-areas, f=json)
    transform() → split each feature's rings into parts → one row per part

TRAPS (all checked live 2026-10-02)
    - Region-wide layer: 1,671,189 footprints across 7 counties. SEMCOG's `city_id` codes
      Detroit as 55 planning sub-areas, 501–555 (244,010 rows; 240,697 not demolished).
      Filtering on that server-side IS the city clip — no bbox, so no Hamtramck,
      Highland Park, Dearborn or Windsor footprints. ADJUSTABLE in detroit.yaml
      `buildings.where`.
    - Source SRID is EPSG:2898 (Michigan South, ft). Without pyproj, arcgis_helper asks
      the server for outSR=4326; spot-check 2026-10-02: gid 1001568 lands at
      -83.0463, 42.3291 (downtown, on its block).
    - The server only speaks f=json (ArcGIS JSON), and arcgis_helper turns every multi-ring
      feature into ONE Polygon — a 2-part building became a polygon with a false hole.
      common.split_arcgis_rings() splits by ring orientation instead.
    - year_built 0 and stories 0 mean "unknown", not "built in year 0" — stored as null.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import mapping

from app.data_import.detroit.common import (
    cached_arcgis_download, read_features, split_arcgis_rings, stable_id,
)
from app.data_import.detroit.field_maps import SEMCOG_BUILDINGS, pick
from app.data_import.import_buildings import BuildingsImporter

# Default server-side filter = Detroit's SEMCOG sub-areas, standing buildings only.
DETROIT_SEMCOG_WHERE = "city_id BETWEEN 501 AND 555 AND demolished IS NULL"


def positive_int(value) -> int | None:
    """O(1) time, O(1) space — d = 1 value. '1968' / 8.0 → int; 0, blanks, junk → None."""
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


class DetroitBuildingsImporter(BuildingsImporter):
    """Reuses BuildingsImporter.load(); download/transform know SEMCOG's shape."""

    layer_name = "buildings"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = Detroit footprints (~240K, ~120 pages of 2,000)."""
        fields = SEMCOG_BUILDINGS.fields
        # O(f) time, O(f) space — f = mapped fields (6)
        out_fields = ",".join(name for names in fields.values() for name in names)
        return cached_arcgis_download(
            self,
            url=self._config.get("url", ""),
            source_srid=int(self._config.get("source_srid", 2898)),
            page_size=int(self._config.get("page_size", 2000)),
            where=self._config.get("where", DETROIT_SEMCOG_WHERE),
            out_fields=out_fields,
            output_format=self._config.get("output_format", "json"),
        )

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices over all footprints; n = rows emitted."""
        records: list[dict] = []
        multipart = 0
        # O(v) time, O(n) space — v = vertices over all features; n = rows
        for feat in read_features(raw_path):
            props = feat.get("properties") or {}
            parts = split_arcgis_rings(feat.get("geometry"))
            if not parts:
                continue
            if len(parts) > 1:
                multipart += 1
            source_id = pick(props, SEMCOG_BUILDINGS, "source_id")
            base = {
                "city_id": self._city_id,
                "address": pick(props, SEMCOG_BUILDINGS, "address"),
                "name": pick(props, SEMCOG_BUILDINGS, "name"),
                "year_built": positive_int(props.get("year_built")),
                "floors": positive_int(props.get("stories")),
                "sq_ft": None,
                # SEMCOG `apn` is the Assessor's parcel_id format ("02002017-8").
                "parcel_pin": pick(props, SEMCOG_BUILDINGS, "apn"),
                # REQUIRED by the frontend building layer filter (is_hidden == false);
                # a feature without them is hidden.
                "is_hidden": False,
                "has_interior": False,
            }
            # bigo-lint: disable=BIGO006 — amortised: each part is emitted once overall (n)
            # O(p) time, O(p) space — p = parts of this building (usually 1)
            for index, part in enumerate(parts):
                row = dict(base)
                row["id"] = stable_id("det-bldg", source_id, index if len(parts) > 1 else None)
                row["geom_json"] = json.dumps(mapping(part))
                records.append(row)
        self._log.info("transformed", count=len(records), multipart_split=multipart)
        return records
