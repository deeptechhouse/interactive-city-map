"""City of Dayton building footprints (MapLayers_Citywide/MapServer/307).

TRAPS
    - Partial load: the fork's commit 01b91e6 reports "80K+" buildings, which looks like a
      stopped pagination. Its later commit claims 335,825 enriched, a number too large for
      the city alone (likely the Microsoft Ohio fallback for the whole bbox). Decide on one
      source per run and record the final count here.
    - The fallback (Microsoft US Building Footprints, Ohio.geojson.zip, ~5M features
      statewide) must be clipped to the profile bounds BEFORE transform. Never load
      all of Ohio.
    - Multipart: the shared transform keeps only the first polygon of a MultiPolygon. Split
      multipart features into separate rows (the same fix as DetroitBuildingsImporter).

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.import_buildings import BuildingsImporter


class DaytonBuildingsImporter(BuildingsImporter):
    """Reuses BuildingsImporter.download/load. Only transform() knows Dayton's fields."""

    layer_name = "buildings"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = footprints in the Dayton bbox.

        Map fields through field_maps.DAYTON_BUILDINGS, split multipart features, and drop
        anything outside the bounds.
        """
        raise NotImplementedError("skeleton: DaytonBuildingsImporter.transform")
