"""Dayton waterways from USGS NHD flowlines (Great Miami, Stillwater, Mad River, Wolf Creek…).

WHY A DAYTON SUBCLASS: the shared WaterwaysImporter downloads one URL with no paging and
    reads `name`/`gnis_name` only. NHD MapServer/6 returns `gnis_name` from this service
    but `GNIS_NAME` from others (the trap Detroit hit), and it caps pages at 2,000. Here
    the download goes through the paged client with an envelope filter, and names are read
    through field_maps.NHD_FLOWLINES, which lists both spellings.

COUNT (2026-10-02): 560 flowlines intersect the profile bbox; 174 have a GNIS name.
    Unnamed flowlines (ditches, culverts) are kept: they draw the network, and the
    frontend only labels named ones.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import mapping, shape

from app.data_import.dayton._sources import DAYTON_BBOX, fetch_arcgis, read_features
from app.data_import.dayton.field_maps import NHD_FLOWLINES
from app.data_import.field_map import pick
from app.data_import.import_waterways import WaterwaysImporter


class DaytonWaterwaysImporter(WaterwaysImporter):
    """Reuses WaterwaysImporter.load; download/transform know NHD."""

    layer_name = "waterways"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = flowlines in the bbox (~560)."""
        url = self._config.get("url") or NHD_FLOWLINES.source
        # The yaml URL may be a full /query?... string from the fork; keep only the layer.
        url = url.split("/query")[0]
        return fetch_arcgis(
            self,
            url,
            out_fields="gnis_name,ftype",
            envelope=DAYTON_BBOX,
            page_size=2000,
        )

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = flowlines."""
        records: list[dict] = []
        # O(n) time, O(n) space — n = features
        for feat in read_features(raw_path):
            geom_json = feat.get("geometry")
            if not geom_json:
                continue
            try:
                geom = shape(geom_json)
            except Exception:  # noqa: BLE001 — malformed upstream geometry is skipped
                continue
            if geom.is_empty:
                continue
            props = feat.get("properties") or {}
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "city_id": self._city_id,
                    "name": pick(props, NHD_FLOWLINES, "name"),
                    "waterway_type": pick(props, NHD_FLOWLINES, "waterway_type"),
                    "geom_json": json.dumps(mapping(geom)),
                }
            )
        self._log.info("transformed", count=len(records))
        return records
