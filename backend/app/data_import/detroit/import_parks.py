"""Detroit parks from Data Driven Detroit Parks_Landmarks → `parks` rows.

PURPOSE
    Detroit parks get their own table/tile layer (`parks`), NOT the parcels layer: Chicago's
    ParkLayer paints its whole `parcels` source-layer green because Chicago's parcels table
    only holds parks, while Detroit's parcels are real parcels. See models/park.py.

DATA (live 2026-10-02): 390 polygons, fields FULLNAME + Type. Type values: Park 369,
    Cemetery 14, Golf 4, Airport 1 (Coleman A. Young), Convention 1 (Cobo/Huntington Place,
    still named "Cobo Center" upstream), Fort 1 (Fort Wayne). park_type keeps them apart so
    the layer can filter or colour non-parks differently.
"""

from __future__ import annotations

from pathlib import Path

from app.data_import.base_importer import BaseImporter
from app.data_import.detroit.common import (
    as_multipolygon_json, cached_arcgis_download, read_features, stable_id,
)
from app.data_import.detroit.field_maps import D3_PARKS, pick


class DetroitParksImporter(BaseImporter):
    layer_name = "parks"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = park polygons (390)."""
        return cached_arcgis_download(
            self, url=self._config.get("url", ""),
            page_size=int(self._config.get("page_size", 2000)),
        )

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices; n = park polygons."""
        records: list[dict] = []
        # O(v) time, O(n) space — v = vertices; n = features
        for index, feat in enumerate(read_features(raw_path)):
            props = feat.get("properties") or {}
            geom_json = as_multipolygon_json(feat.get("geometry"))
            if not geom_json:
                continue
            records.append({
                "id": stable_id("det-park", props.get("FID", index)),
                "city_id": self._city_id,
                "name": pick(props, D3_PARKS, "name"),
                "park_type": (pick(props, D3_PARKS, "park_type") or "Park").lower(),
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        """O(1) time, O(1) space — r = 0 rows written. Static-mode only, like the boundaries."""
        raise NotImplementedError("parks: database load not wired yet (static only)")
