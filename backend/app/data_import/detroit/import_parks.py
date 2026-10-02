"""Detroit parks from Data Driven Detroit Parks_Landmarks → `parks` table.

NOT the parcels table — see models/park.py for why. The D3 layer mixes parks with
landmarks, golf courses and City Airport; keep a park_type so the layer can filter.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitParksImporter(BaseImporter):
    layer_name = "parks"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = park polygons.

        Fetch Parks_Landmarks FeatureServer.
        """
        raise NotImplementedError("skeleton: DetroitParksImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = park polygons.

        Keep polygons; map name + park_type; force MultiPolygon.
        """
        raise NotImplementedError("skeleton: DetroitParksImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitParksImporter.load")
