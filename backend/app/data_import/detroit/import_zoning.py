"""Detroit zoning districts (Zoning_1 FeatureServer) → zoning_districts rows.

PURPOSE
    Detroit's Zoning Ordinance (City Code Ch. 50) uses undashed codes — R2, B4, SD2, MKT —
    so the shared Chicago classifier (prefix table built for RS-3 / B1-1 / DX-…) would put
    TM in 'transportation' and SD*/W1/MKT in 'other'. This override classifies Detroit
    codes with a Detroit table.

CONTRACT
    The zone_class values emitted here are the ZoneClass keys in
    frontend/src/cities/detroit/zoning.ts (DETROIT_ZONE_CLASSES). A class key the
    frontend does not know hides every building tagged with it. Test:
    tests/test_detroit_parity.py::test_detroit_zone_codes_all_classified.

DATA (live 2026-10-02): 28,364 parcel-grain polygons, 29 distinct ZONING_REV codes:
    R1–R6, B1–B6, M1–M5, MKT, P1, PC, PCA, PD, PR, SD1, SD2, SD4, SD5, TM, W1.
    (No SD3 on the map today; the table still classifies it in case it appears.)
"""

from __future__ import annotations

from pathlib import Path

from app.data_import.detroit.common import as_multipolygon_json, read_features, stable_id
from app.data_import.detroit.field_maps import DETROIT_ZONING, pick
from app.data_import.import_zoning import ZoningImporter

# Exact code → zone_class. Reasoning for the non-obvious ones (ZDESCR_N in quotes):
#   MKT "Market and Distribution"  → manufacturing (Eastern Market wholesale/industrial)
#   TM  "Transitional-Industrial"  → manufacturing — NOT transportation (the Chicago trap)
#   W1  "Waterfront-Industrial"    → waterfront
#   PCA "Restricted Central Business" → commercial (downtown core)
#   PC  "Public Center" (Hart Plaza / civic core), PD "Planned Development",
#   PR  "Parks and Recreation", P1 "Open Parking", SD5 "Special Development, Casinos"
#                                  → special
#   SD1/SD2/SD4 "Special Development … Mixed-Use" → mixed
# ADJUSTABLE: move a code between classes here AND in frontend detroit/zoning.ts.
DETROIT_ZONE_CLASS: dict[str, str] = {
    "MKT": "manufacturing",
    "TM": "manufacturing",
    "W1": "waterfront",
    "PCA": "commercial",
    "PC": "special",
    "PD": "special",
    "PR": "special",
    "P1": "special",
    "SD1": "mixed",
    "SD2": "mixed",
    "SD3": "mixed",
    "SD4": "mixed",
    "SD5": "special",
}

# Single-letter family fallback for numbered codes not listed above (R7, B7, M6 …).
_FAMILY_CLASS: dict[str, str] = {"R": "residential", "B": "commercial", "M": "manufacturing"}


def classify_detroit_zone(zone_code: str | None) -> str:
    """O(1) time, O(1) space — c = 1 code (two dict probes).

    Detroit zone code → zone_class. Unknown codes → 'other' (the frontend's catch-all),
    never an exception: a new upstream code must not drop polygons.
    """
    if not zone_code:
        return "other"
    code = zone_code.strip().upper()
    if code in DETROIT_ZONE_CLASS:
        return DETROIT_ZONE_CLASS[code]
    if len(code) >= 2 and code[0] in _FAMILY_CLASS and code[1:].isdigit():
        return _FAMILY_CLASS[code[0]]
    return "other"


class DetroitZoningImporter(ZoningImporter):
    """Reuses ZoningImporter.download()/load(); only transform() knows Detroit's fields.

    The shared download pages with f=geojson and asks the server for outSR=4326 when
    pyproj is missing (native SRID is wkid 102690). maxRecordCount is 1000 although the
    yaml page_size may say 2000 — arcgis_helper follows exceededTransferLimit, so that's
    fine (~29 requests).
    """

    layer_name = "zoning"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices over all polygons; n = zoning polygons."""
        records: list[dict] = []
        # O(v) time, O(n) space — v = vertices; n = features
        for index, feat in enumerate(read_features(raw_path)):
            props = feat.get("properties") or {}
            geom_json = as_multipolygon_json(feat.get("geometry"))
            if not geom_json:
                continue
            code = (pick(props, DETROIT_ZONING, "zone_code") or "").upper()
            records.append({
                "id": stable_id("det-zone", props.get("FID", index)),
                "city_id": self._city_id,
                "zone_code": code or None,
                "zone_class": classify_detroit_zone(code),
                "zone_name": pick(props, DETROIT_ZONING, "zone_name"),
                "description": pick(props, DETROIT_ZONING, "zone_name") or "",
                "ordinance_ref": "Detroit City Code Ch. 50",
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records
