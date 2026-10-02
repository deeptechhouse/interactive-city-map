"""City of Dayton zoning (MapLayers_Citywide/MapServer/203) → zoning_districts.

WHY AN OVERRIDE: the fork's import_zoning._ZONE_CLASS_MAP mixed Chicago prefixes (M, C,
    B, R, P, T…) with guessed Dayton prefixes under longest-prefix matching, so a Dayton
    "C…" or "R…" code could take a Chicago class. This importer classifies with Dayton's
    families only. The shared ZoningImporter (Chicago) is left untouched.

CONTRACT: every zone_class written here must be a key in frontend
    src/cities/dayton/zoning.ts DAYTON_ZONE_CLASSES. A mismatch hides buildings in the filter.

UNPROVEN: the families in DAYTON_ZONE_FAMILIES are the fork's guesses. Check them against
    a GROUP BY of the imported zone_code values (plan D1) before trusting them.

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.import_zoning import ZoningImporter

# Code prefix → zone_class. UNPROVEN (see module docstring). Longest prefix wins.
DAYTON_ZONE_FAMILIES: dict[str, str] = {
    "SF": "residential",
    "TF": "residential",
    "MF": "residential",
    "UR": "residential",
    "NC": "commercial",
    "GC": "commercial",
    "RC": "commercial",
    "OC": "commercial",
    "LM": "manufacturing",
    "GM": "manufacturing",
    "HM": "manufacturing",
    "IN": "manufacturing",
    "I": "manufacturing",
    "MU": "mixed",
    "MX": "mixed",
    "CBD": "mixed",
    "WR": "mixed",
    "OS": "special",
}


def classify_dayton_zone(zone_code: str) -> str:
    """O(1) time, O(1) space — k = 18 prefixes (a fixed bound), checked longest first.

    zone_class for a Dayton code, or "other". Never falls back to Chicago rules.
    """
    raise NotImplementedError("skeleton: classify_dayton_zone")


class DaytonZoningImporter(ZoningImporter):
    layer_name = "zoning"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = zoning polygons (~970 per the fork's import log).

        Map fields through field_maps.DAYTON_ZONING and classify with classify_dayton_zone.
        """
        raise NotImplementedError("skeleton: DaytonZoningImporter.transform")
