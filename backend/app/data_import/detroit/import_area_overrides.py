"""Detroit overrides of shared importers whose field reading is wrong for Detroit.

PURPOSE
    The shared NeighborhoodsImporter, DLBAImporter and WaterwaysImporter download fine but
    read field names that Detroit's live layers do not have. Each class here reuses the
    shared download()/load() and replaces only transform(). The shared files stay
    untouched, so Chicago behaviour cannot change.

WHAT WAS WRONG (live checks 2026-10-02)
    Neighborhoods  council_district is a Double → the shared code wrote "4.0"; the URL field
                   is `Website` (capital W) and was dropped.
    DLBA           56,896 POINTS; address lives in `name`, status in
                   `inventory_status_socrata`. The shared code read `address`/`status`/
                   `property_type` — none exist — so every row had null address & status.
    Waterways      NHD answered with lower-case gnis_name/ftype although the yaml asks for
                   GNIS_NAME/FTYPE; both are read via field_maps.NHD_FLOWLINES.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import mapping, shape

from app.data_import.detroit.common import (
    as_multipolygon_json, int_text, read_features, stable_id,
)
from app.data_import.detroit.field_maps import (
    DETROIT_NEIGHBORHOODS, DLBA_PROPERTIES, NHD_FLOWLINES, pick,
)
from app.data_import.import_dlba import DLBAImporter
from app.data_import.import_neighborhoods import NeighborhoodsImporter
from app.data_import.import_waterways import WaterwaysImporter


class DetroitNeighborhoodsImporter(NeighborhoodsImporter):
    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices; n = neighborhoods (205)."""
        records: list[dict] = []
        # O(v) time, O(n) space — v = vertices; n = features
        for index, feat in enumerate(read_features(raw_path)):
            props = feat.get("properties") or {}
            name = pick(props, DETROIT_NEIGHBORHOODS, "name")
            geom_json = as_multipolygon_json(feat.get("geometry"))
            if not name or not geom_json:
                continue
            records.append({
                "id": stable_id("det-nhood", props.get("OBJECTID", index)),
                "city_id": self._city_id,
                "name": name,
                "council_district": int_text(pick(props, DETROIT_NEIGHBORHOODS, "council_district")),
                "website": pick(props, DETROIT_NEIGHBORHOODS, "website"),
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records


class DetroitDLBAImporter(DLBAImporter):
    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = DLBA points (~57K)."""
        records: list[dict] = []
        # O(n) time, O(n) space — n = features
        for index, feat in enumerate(read_features(raw_path)):
            props = feat.get("properties") or {}
            geometry = feat.get("geometry")
            if not geometry:
                continue
            try:
                point = shape(geometry)
            except (ValueError, TypeError, AttributeError):
                continue
            if point.is_empty:
                continue
            records.append({
                "id": stable_id("det-dlba", props.get("parcel_id") or index),
                "city_id": self._city_id,
                "address": pick(props, DLBA_PROPERTIES, "address"),
                "status": pick(props, DLBA_PROPERTIES, "status"),
                # The layer has no property-type field; the status text carries it
                # ("… Lot For Sale" vs "… Structure For Sale").
                "property_type": _lot_or_structure(pick(props, DLBA_PROPERTIES, "status")),
                "parcel_id": pick(props, DLBA_PROPERTIES, "parcel_id"),
                "neighborhood": pick(props, DLBA_PROPERTIES, "neighborhood"),
                "council_district": int_text(pick(props, DLBA_PROPERTIES, "council_district")),
                "geom_json": json.dumps(mapping(point)),
            })
        self._log.info("transformed", count=len(records))
        return records


def _lot_or_structure(status: str | None) -> str | None:
    """O(1) time, O(1) space — s = 1 status string (bounded length).

    'Neighborhood Lot For Sale' → 'lot'; 'DLBA Owned Structure' → 'structure'; else None.
    """
    if not status:
        return None
    lowered = status.lower()
    if "structure" in lowered:
        return "structure"
    if "lot" in lowered:
        return "lot"
    return None


# ADJUSTABLE: how far past the city limit waterways are kept (degrees; 0.01° ≈ 0.8–1.1 km).
# Must cover the Detroit River centreline (the city limit runs along its US bank). Too
# large and Windsor's drain network reappears (seen in the 2026-10-02 smoke screenshot).
WATER_CLIP_BUFFER_DEG = 0.01


class DetroitWaterwaysImporter(WaterwaysImporter):
    """NHD flowlines clipped to Detroit + WATER_CLIP_BUFFER_DEG.

    Config is TWO yaml blocks, {"waterways": {...}, "council_districts": {...}} (static plan
    config_keys) — the districts give the exact city outline. The bbox alone pulled in
    Windsor, Ontario's channel network across the river.
    """

    # O(1) time, O(1) space — n = 1 importer (unwraps the two-block config)
    def __init__(self, db_url: str, city_id: str, config: dict | None = None):
        config = config or {}
        self._council_cfg = config.get("council_districts")
        super().__init__(db_url, city_id, config.get("waterways", config))

    def _city_outline(self):
        """O(v log v) time, O(v) space — v = council-district vertices. None if unconfigured."""
        from app.data_import.detroit.import_boundaries import (
            DetroitCouncilDistrictsImporter, detroit_city_limits,
        )

        if not self._council_cfg:
            return None
        council = DetroitCouncilDistrictsImporter(self._db_url, self._city_id, self._council_cfg)
        return detroit_city_limits(council.transform(council.download())).buffer(WATER_CLIP_BUFFER_DEG)

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices; n = NHD flowlines (~900)."""
        outline = self._city_outline()
        records: list[dict] = []
        # O(v) time, O(n) space — v = vertices; n = features
        for index, feat in enumerate(read_features(raw_path)):
            props = feat.get("properties") or {}
            geometry = feat.get("geometry")
            if not geometry:
                continue
            try:
                geom = shape(geometry)
            except (ValueError, TypeError, AttributeError):
                continue
            if outline is not None:
                geom = geom.intersection(outline)
            if geom.is_empty:
                continue
            records.append({
                "id": stable_id("det-water", index),
                "city_id": self._city_id,
                "name": pick(props, NHD_FLOWLINES, "name"),
                "waterway_type": pick(props, NHD_FLOWLINES, "ftype"),
                "geom_json": json.dumps(mapping(geom)),
            })
        self._log.info("transformed", count=len(records))
        return records
