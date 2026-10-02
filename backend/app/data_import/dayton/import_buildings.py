"""City of Dayton building footprints (MapLayers_Citywide/MapServer/307).

PURPOSE
    Footprint polygons for the profile bbox. The layer is county-wide (338,321 features on
    2026-10-02); the server-side envelope filter keeps the 230,328 that touch the bbox.

FLOW
    download() → _sources.fetch_arcgis(307, envelope=DAYTON_BBOX)  (cached)
    transform() → one row per polygon part, with a deterministic id
    (address / owner / year built come later from enrich.join_parcels — 307 has none)

TRAPS
    - Partial load (fork commit 01b91e6, "80K+" buildings): the old paging stopped early.
      The shared client now follows exceededTransferLimit. Expect ~230K here.
    - NO ADDRESS: 307 has no address, name or year field (verified 2026-10-02). Without
      the parcel join every popup and every contact-list owner lookup would be blank.
    - Multipart: the shared BuildingsImporter keeps only the first polygon of a
      MultiPolygon. Here every part becomes its own row (same fix as Detroit).
    - NUMSTORIES is 0 for "unknown" on most rows. 0 is stored as None, never as 0 floors.
    - The fallback (Microsoft Ohio footprints, ~5M features) is NOT wired: 307 works, and
      the statewide file must be clipped before transform if it is ever needed.

STATUS — implemented 2026-10-02 (static build). load() reuses BuildingsImporter.load.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import MultiPolygon, Polygon, mapping, shape

from app.data_import.dayton._sources import DAYTON_BBOX, fetch_arcgis, read_features
from app.data_import.dayton.field_maps import DAYTON_BUILDINGS
from app.data_import.field_map import pick
from app.data_import.import_buildings import BuildingsImporter

# Stable ids: the same footprint part gets the same UUID on every run, so saved contact
# lists and "Open details" links survive a rebuild. uuid5 → still a valid UUID column.
_ID_NAMESPACE = uuid.uuid5(uuid.NAMESPACE_URL, "https://maps.daytonohio.gov/307")

_OUT_FIELDS = "OBJECTID_1,GlobalID,NUMSTORIES,BLDGHEIGHT,CTYSTRUCT"


def polygon_parts(geom_json: dict | None) -> list[Polygon]:
    """O(v) time, O(v) space — v = vertices in the feature.

    Every non-empty polygon in a Polygon/MultiPolygon; anything else (null geometry,
    lines) → []. Invalid rings are kept as-is: tippecanoe draws them fine and fixing them
    with buffer(0) can drop thin walls.
    """
    if not geom_json:
        return []
    try:
        geom = shape(geom_json)
    except Exception:  # noqa: BLE001 — malformed upstream geometry is skipped, not fatal
        return []
    if isinstance(geom, Polygon):
        return [] if geom.is_empty else [geom]
    if isinstance(geom, MultiPolygon):
        # O(p) time, O(p) space — p = parts
        return [g for g in geom.geoms if not g.is_empty]
    return []


def _positive_int(value) -> int | None:
    """O(1) time, O(1) space — n = one scalar. 0 / negative / junk → None (unknown)."""
    try:
        number = int(float(value))
    except (TypeError, ValueError):
        return None
    return number if number > 0 else None


class DaytonBuildingsImporter(BuildingsImporter):
    """Reuses BuildingsImporter.load. download/transform know Dayton's layer."""

    layer_name = "buildings"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = footprints in the bbox (~230K, 1000 per page)."""
        url = self._config.get("url") or DAYTON_BUILDINGS.source
        return fetch_arcgis(self, url, out_fields=_OUT_FIELDS, envelope=DAYTON_BBOX)

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = footprint parts in the Dayton bbox.

        Split multipart features; give each part a stable id. Booleans is_hidden /
        has_interior are always present: the frontend layer filters on is_hidden == false
        and a missing key fails that filter, hiding the building.
        """
        records: list[dict] = []
        # O(n) time, O(n) space — n = features (parts per feature are amortised into n)
        for feat in read_features(raw_path):
            props = feat.get("properties") or {}
            parts = polygon_parts(feat.get("geometry"))
            source_id = pick(props, DAYTON_BUILDINGS, "source_id") or ""
            # bigo-lint: disable=BIGO006 — amortised: each part is emitted once overall (n)
            # O(p) time, O(p) space — p = parts of this footprint (almost always 1)
            for index, part in enumerate(parts):
                records.append(
                    {
                        "id": str(uuid.uuid5(_ID_NAMESPACE, f"{source_id}:{index}")),
                        "city_id": self._city_id,
                        "address": None,
                        "name": None,
                        "year_built": None,
                        "floors": _positive_int(pick(props, DAYTON_BUILDINGS, "floors")),
                        "height_ft": _positive_int(pick(props, DAYTON_BUILDINGS, "height_ft")),
                        "building_type": pick(props, DAYTON_BUILDINGS, "building_type"),
                        "sq_ft": None,
                        "is_hidden": False,
                        "has_interior": False,
                        "geom_json": json.dumps(mapping(part)),
                    }
                )
        self._log.info("transformed", count=len(records))
        return records
