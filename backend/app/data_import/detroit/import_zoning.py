"""Detroit zoning districts (Zoning_1 FeatureServer).

The shared _classify_zone is Chicago-shaped: Detroit TM → 'transportation' and SD*/W1 →
'other'. This override classifies Detroit codes; the class keys must match
frontend/src/cities/detroit/zoning.ts DETROIT_ZONE_CLASSES exactly.

STATUS — SKELETON (2026-10-02). Not referenced by run.py; wired in via city_registry.py.
"""

from pathlib import Path

from app.data_import.import_zoning import ZoningImporter


class DetroitZoningImporter(ZoningImporter):
    """Reuses ZoningImporter.download/load; only transform() knows Detroit's fields."""

    layer_name = "zoning"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = zoning polygons.

        Read zone_code via field_maps.DETROIT_ZONING; classify with a Detroit prefix table.
        """
        raise NotImplementedError("skeleton: DetroitZoningImporter.transform")
