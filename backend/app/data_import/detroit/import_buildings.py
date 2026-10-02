"""Detroit building footprints from SEMCOG (Building_Footprints__2020, layer 60).

TRAPS
    - Source SRID is EPSG:2898 (Michigan South, US feet). arcgis_helper reprojects; check
      one known building lands on its parcel before trusting the whole run.
    - Shared transform keeps only the FIRST polygon of a MultiPolygon and arcgis_helper
      turns multi-ring features into one Polygon with false holes (audit 2026-10-02).
      This override must split multipart features into separate building rows.
    - The bbox includes Hamtramck, Highland Park, Dearborn edges and Windsor (CA) —
      clip to the city-limits polygon, not the bbox.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.import_buildings import BuildingsImporter


class DetroitBuildingsImporter(BuildingsImporter):
    """Reuses BuildingsImporter.download/load; only transform() knows Detroit's fields."""

    layer_name = "buildings"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = SEMCOG footprints in the Detroit bbox (~300K).

        Map SEMCOG fields via field_maps.SEMCOG_BUILDINGS; split multipart; clip to city limits.
        """
        raise NotImplementedError("skeleton: DetroitBuildingsImporter.transform")
