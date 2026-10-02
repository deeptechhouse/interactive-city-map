"""Detroit admin boundaries → police_precincts, council_districts, zip_codes tables.

ZIP TRAP: detroit.yaml's City_of_Detroit_Zip_Code_List may be a non-spatial table.
Use the configured fallback_url (Census TIGERweb ZCTA) and clip ZCTAs to the city limit.
Council districts: use the 2026 map (city_council_districts_2026), not the 2014 one.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitBoundariesImporter(BaseImporter):
    layer_name = "boundaries"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = boundary features (12 precincts + 7 districts + ~30 ZCTAs).

        Fetch the three configured layers (zip via fallback_url).
        """
        raise NotImplementedError("skeleton: DetroitBoundariesImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = boundary features (12 precincts + 7 districts + ~30 ZCTAs).

        Emit rows tagged with their target table; numbers as text ('1'..'12').
        """
        raise NotImplementedError("skeleton: DetroitBoundariesImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitBoundariesImporter.load")
