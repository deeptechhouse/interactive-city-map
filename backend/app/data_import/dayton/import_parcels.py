"""Montgomery County Auditor parcels → parcels table (~272K rows county-wide).

PURPOSE
    Replaces the shared import_parcels, which is a Cook County stub that logs "not yet
    automated" and returns 0. That stub is why the fork's parcels never loaded through the
    pipeline. Dayton's parcels carry the owner, appraisal and sale data that the building
    popup shows (via enrich.tag_buildings_with_parcels).

TRAPS
    - Scope: the county FeatureServer covers all of Montgomery County. Keep parcels whose
      centroid falls inside the profile bounds, not just the city limit, so railroad_row
      corridors at the edge still have parcels. ADJUSTABLE: clip to the city limit instead
      if the static parcels.pmtiles goes over its size budget (~15 MB).
    - Uniqueness: parcels has UNIQUE (city_id, pin). Condo parcels can share one footprint
      but never a PARID. A duplicate PIN means the wrong field is mapped as `pin`.
    - The fork's count of 272K came from a shapefile, not this FeatureServer. Expect
      a different total and record the real count here after the first run.

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DaytonParcelsImporter(BaseImporter):
    layer_name = "parcels"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = parcels in the bbox (~272K, paged 2000 per request).

        Paged ArcGIS query (arcgis_helper.ArcGISFeatureServerClient), cached as JSON.
        """
        raise NotImplementedError("skeleton: DaytonParcelsImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = parcels.

        Map fields through field_maps.MONTGOMERY_PARCELS. Values that aren't columns go
        into metadata with clean keys (owner_address, appraised_value, sale_date, …).
        """
        raise NotImplementedError("skeleton: DaytonParcelsImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records (batched execute_values, page 1000).

        Delete this city's parcels first, then insert, so re-runs are idempotent.
        """
        raise NotImplementedError("skeleton: DaytonParcelsImporter.load")
