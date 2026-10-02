"""Railroad right-of-way parcels — Detroit equivalent of Chicago's 2,780 Cook County RR
parcels (railroadRowData.ts).

Derived, not downloaded: select imported Detroit parcels whose owner_name matches a
railroad (CSX, NORFOLK SOUTHERN, CANADIAN NATIONAL / GRAND TRUNK, CPKC / SOO LINE,
CONRAIL, DETROIT CONNECTING). UNPROVEN: owner strings — list distinct matches and
review by hand before trusting the pattern. Requires DetroitParcelsImporter first.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitRailroadRowImporter(BaseImporter):
    layer_name = "railroad_row"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = parcels.

        No network: reads the parcels table (return a marker path).
        """
        raise NotImplementedError("skeleton: DetroitRailroadRowImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = parcels.

        Classify owner → carrier + ownership_type (same keys as the frontend taxonomy).
        """
        raise NotImplementedError("skeleton: DetroitRailroadRowImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitRailroadRowImporter.load")
