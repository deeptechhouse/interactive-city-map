"""BSEED building permits → interior enrichment (Chicago twin: interior/permit_importer).

TRAP: detroit_interior.yaml points at a Socrata-style URL (xw2a-a7tf) but Detroit's
portal is now ArcGIS Hub — find the current permits FeatureServer first. Match to
buildings WITH a city_id filter (the Chicago importer forgets it — audit 2026-10-02).

STATUS — SKELETON (2026-10-02). Not referenced by run.py or Detroit's StaticPlan yet
    (Detroit loads into PostGIS through scripts/load_city_db.py → db_load.py).
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitPermitsImporter(BaseImporter):
    layer_name = "building_permits"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = permits.

        Fetch the permits FeatureServer (URL to be confirmed).
        """
        raise NotImplementedError("skeleton: DetroitPermitsImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = permits.

        Keep permits with an address or point; map work type + date.
        """
        raise NotImplementedError("skeleton: DetroitPermitsImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitPermitsImporter.load")
