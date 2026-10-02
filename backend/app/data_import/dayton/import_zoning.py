"""City of Dayton zoning (MapLayers_Citywide/MapServer/203) → zoning_districts.

WHY AN OVERRIDE: the fork's import_zoning._ZONE_CLASS_MAP mixed Chicago prefixes (M, C,
    B, R, P, T…) with guessed Dayton prefixes under longest-prefix matching, so a Dayton
    "C…" or "R…" code could take a Chicago class. This importer classifies with Dayton's
    codes only. The shared ZoningImporter (Chicago) is left untouched.

THE CODES (verified 2026-10-02 by GROUP BY NEW_ZONE on the live layer: 26 codes, 970 rows)
    Dayton's 2006 code names districts by neighborhood type — S(uburban), E(clectic),
    M(ature) — so the fork's guessed families (SF, TF, UR, GC…) never matched anything.
        residential    SR-1 SR-2 ER-3 ER-4 MR-5 SMF EMF MMF MH
        commercial     SNC ENC MNC SGC EGC MGC
        mixed          CBD UBD MX T
        manufacturing  I-1 I-2 BP
        special        CI OS WO
        transportation AP
    UNPROVEN: "T" (100 polygons, small blocks re-zoned from old B-1/B-2/R-5M/R-6) is read
    as Transitional (mixed); "MX" (1 polygon, no legacy code) as Mixed-Use; "AP" as
    Airport. The City's legend labels T as just "T". Check the Zoning Code text before
    relying on those three labels.

TRAP: the layer also has DISTRICT (the pre-2006 code: B-2, R-4…). It is NOT the current
    zoning. The fork's yaml mapped zone_code ← DISTRICT, which shows 1990s zoning.

CONTRACT: every zone_class written here must be a key in frontend
    src/cities/dayton/zoning.ts DAYTON_ZONE_CLASSES (test_dayton_parity pins this).
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import mapping, shape

from app.data_import.dayton._sources import fetch_arcgis, read_features
from app.data_import.dayton.field_maps import DAYTON_ZONING
from app.data_import.field_map import pick
from app.data_import.import_zoning import ZoningImporter

# Exact code → (zone_class, human name). Exact, not prefix: Dayton codes are short and
# overlap as prefixes ("I-1" vs "I-12" would be a future trap; "MR-5" vs "MR-5A").
# TO ADD A CODE: add it here AND to frontend DAYTON_ZONE_CLASSES, or the parity test fails.
DAYTON_ZONES: dict[str, tuple[str, str]] = {
    "SR-1": ("residential", "Suburban Residential 1"),
    "SR-2": ("residential", "Suburban Residential 2"),
    "ER-3": ("residential", "Eclectic Residential 3"),
    "ER-4": ("residential", "Eclectic Residential 4"),
    "MR-5": ("residential", "Mature Residential 5"),
    "SMF": ("residential", "Suburban Multi-Family"),
    "EMF": ("residential", "Eclectic Multi-Family"),
    "MMF": ("residential", "Mature Multi-Family"),
    "MH": ("residential", "Manufactured Home"),
    "SNC": ("commercial", "Suburban Neighborhood Commercial"),
    "ENC": ("commercial", "Eclectic Neighborhood Commercial"),
    "MNC": ("commercial", "Mature Neighborhood Commercial"),
    "SGC": ("commercial", "Suburban General Commercial"),
    "EGC": ("commercial", "Eclectic General Commercial"),
    "MGC": ("commercial", "Mature General Commercial"),
    "CBD": ("mixed", "Central Business District"),
    "UBD": ("mixed", "Urban Business District"),
    "MX": ("mixed", "Mixed-Use"),  # UNPROVEN label
    "T": ("mixed", "Transitional"),  # UNPROVEN label
    "I-1": ("manufacturing", "Light Industrial"),
    "I-2": ("manufacturing", "General Industrial"),
    "BP": ("manufacturing", "Business Park"),
    "CI": ("special", "Campus Institutional"),
    "OS": ("special", "Open Space"),
    "WO": ("special", "Well Head Operation"),
    "AP": ("transportation", "Airport"),  # UNPROVEN label
}

# Every class this importer can emit (the frontend catalogue must have each key).
DAYTON_ZONE_CLASS_KEYS: tuple[str, ...] = (
    "residential",
    "commercial",
    "manufacturing",
    "mixed",
    "special",
    "transportation",
    "other",
)


def normalise_zone_code(raw: str | None) -> str:
    """O(n) time, O(n) space — n = code length. " er-3 " → "ER-3"; None → ""."""
    return (raw or "").strip().upper()


def classify_dayton_zone(zone_code: str) -> str:
    """O(1) time, O(1) space — n = one dict lookup.

    zone_class for a Dayton code, or "other". Never falls back to Chicago rules, so
    classify_dayton_zone("C1") == "other".
    """
    entry = DAYTON_ZONES.get(normalise_zone_code(zone_code))
    return entry[0] if entry else "other"


def zone_name(zone_code: str) -> str | None:
    """O(1) time, O(1) space — n = one dict lookup. Human name, or None if unknown."""
    entry = DAYTON_ZONES.get(normalise_zone_code(zone_code))
    return entry[1] if entry else None


class DaytonZoningImporter(ZoningImporter):
    layer_name = "zoning"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = zoning polygons (970)."""
        url = self._config.get("url") or DAYTON_ZONING.source
        return fetch_arcgis(self, url, out_fields="OBJECTID,NEW_ZONE,DISTRICT,NAME")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = zoning polygons (970 on 2026-10-02).

        Rows without a current code (25 have NEW_ZONE null) are kept as class "other" so
        the map shows them, rather than silently leaving holes.
        """
        records: list[dict] = []
        # O(n) time, O(n) space — n = features
        for feat in read_features(raw_path):
            geom_json = feat.get("geometry")
            if not geom_json:
                continue
            try:
                geom = shape(geom_json)
            except Exception:  # noqa: BLE001 — malformed upstream geometry is skipped
                continue
            if geom.is_empty:
                continue
            props = feat.get("properties") or {}
            code = normalise_zone_code(pick(props, DAYTON_ZONING, "zone_code"))
            records.append(
                {
                    "id": str(uuid.uuid4()),
                    "city_id": self._city_id,
                    "zone_code": code or None,
                    "zone_class": classify_dayton_zone(code),
                    "zone_name": zone_name(code),
                    "description": None,
                    "ordinance_ref": "Dayton Zoning Code (2006)",
                    "legacy_code": pick(props, DAYTON_ZONING, "legacy_code"),
                    "geom_json": json.dumps(mapping(geom)),
                }
            )
        self._log.info("transformed", count=len(records))
        return records
