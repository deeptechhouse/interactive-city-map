"""Import streets — v1 stub.

Streets are rendered from basemap vector tiles (OpenMapTiles / MapLibre),
so a dedicated streets import is not needed for the initial release.
A future version could import TIGER/Line streets for Cook County
for custom street-level queries and styling.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class StreetsImporter(BaseImporter):
    layer_name = "streets"

    # O(1) time, O(1) space
    def download(self) -> Path:
        self._log.info(
            "streets_import_skipped",
            reason="Streets come from basemap tiles. "
                   "TIGER/Line import is optional for v1.",
        )
        p = self._cache_path()
        if not p.exists():
            p.write_text('{"type": "FeatureCollection", "features": []}')
        return p

    # O(1) time, O(1) space
    def transform(self, raw_path: Path) -> list[dict]:
        return []

    # O(1) time, O(1) space
    def load(self, records: list[dict]) -> int:
        return 0
