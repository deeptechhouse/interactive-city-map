"""Detroit parcels from the Office of the Assessor (parcel_file_current).

The shared import_parcels.py is a Cook-County stub that always returns 0, so Detroit
parcels have never been imported. This is the source for owner of record (backend
side), property class, and the railroad right-of-way layer.

VOLUME: 378K rows at 2000/page = ~190 requests. Cache the merged GeoJSON; respect
exceededTransferLimit; never re-download on a transform bug.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitParcelsImporter(BaseImporter):
    layer_name = "parcels"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = Detroit parcels (~378K).

        Paginate parcel_file_current with ArcGISFeatureServerClient; cache.
        """
        raise NotImplementedError("skeleton: DetroitParcelsImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = Detroit parcels (~378K).

        Map fields via field_maps.DETROIT_PARCELS; normalise PIN; force MultiPolygon.
        """
        raise NotImplementedError("skeleton: DetroitParcelsImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitParcelsImporter.load")
