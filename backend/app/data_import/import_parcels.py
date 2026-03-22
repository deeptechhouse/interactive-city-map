"""Import parcels from Cook County GIS data.

v1 stub: Cook County ArcGIS REST API requires complex pagination and
authentication handling. This importer logs a message and returns 0.
A future version will query the Cook County Assessor ArcGIS Feature Service.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class ParcelsImporter(BaseImporter):
    layer_name = "parcels"

    def download(self) -> Path:
        self._log.warning(
            "parcels_import_skipped",
            reason="Cook County ArcGIS REST API requires manual data download or "
                   "complex pagination. Parcels import is not yet automated.",
        )
        # Return a dummy path — transform will handle the empty case
        p = self._cache_path()
        if not p.exists():
            p.write_text('{"type": "FeatureCollection", "features": []}')
        return p

    def transform(self, raw_path: Path) -> list[dict]:
        return []

    def load(self, records: list[dict]) -> int:
        return 0
