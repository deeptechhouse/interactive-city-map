"""Dayton admin boundaries → police_precincts, neighborhoods, zip_codes tables.

PURPOSE
    Replaces the fork's import_police_districts.py and import_neighborhoods.py. Those ran
    `CREATE TABLE IF NOT EXISTS` inside the importer, wrote neighborhoods into a table
    called `wards`, and had no model or migration. Here the tables come from migrations
    003 (neighborhoods) and 005 (police_precincts, zip_codes), and rows are keyed by city_id.

TRAPS
    - Police: the fork's import log says 4 areas while its MapContainer comment says 7.
      Trust COUNT(*) after import and record the number here.
    - ZCTAs: Census TIGER ZCTA520 is national (~33K polygons). Filter by the 453/454 prefix
      AND intersect with the city limit; the prefix alone pulls in the whole Miami Valley.

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DaytonBoundariesImporter(BaseImporter):
    layer_name = "boundaries"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = boundary features (~4 areas + 97 neighborhoods + ~20 ZCTAs).

        Fetch the configured police, neighborhood and ZCTA sources.
        """
        raise NotImplementedError("skeleton: DaytonBoundariesImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = boundary features.

        Emit rows tagged with their target table. Numbers are stored as text.
        """
        raise NotImplementedError("skeleton: DaytonBoundariesImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows in each target table first, then insert, so re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DaytonBoundariesImporter.load")
