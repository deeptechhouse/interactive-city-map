"""BSEED active business licences → business_licenses (points).

Used by enrich.py to attach businesses to buildings — the backend twin of the browser
contact source (frontend/src/cities/detroit/contacts.ts).

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitBusinessLicensesImporter(BaseImporter):
    layer_name = "business_licenses"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = active licences.

        Fetch bseed_active_business_licenses FeatureServer.
        """
        raise NotImplementedError("skeleton: DetroitBusinessLicensesImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = active licences.

        Points only; drop rows with no geometry and count them in the log.
        """
        raise NotImplementedError("skeleton: DetroitBusinessLicensesImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitBusinessLicensesImporter.load")
