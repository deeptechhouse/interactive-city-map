"""Detroit labelled arterials → major_streets.

Chicago's 25 streets were hand-entered as straight lines. Detroit's radial avenues are
not straight, so take real geometry from OSM (highway=primary/trunk by name) and merge
segments per name. Curated list: Woodward, Gratiot, Grand River, Michigan, Jefferson,
Fort, Van Dyke, Livernois, Grand Blvd, 7/8 Mile, Warren, Mack, plus I-75/I-94/I-96/
M-10/I-375 labels. ADJUSTABLE: the list lives in detroit.yaml `major_streets.names`.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DetroitMajorStreetsImporter(BaseImporter):
    layer_name = "major_streets"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = street segments matched.

        Overpass query for the named ways inside the bbox.
        """
        raise NotImplementedError("skeleton: DetroitMajorStreetsImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = street segments matched.

        Merge ways per name into one LineString (or MultiLineString).
        """
        raise NotImplementedError("skeleton: DetroitMajorStreetsImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's rows for the table first, then insert — re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DetroitMajorStreetsImporter.load")
