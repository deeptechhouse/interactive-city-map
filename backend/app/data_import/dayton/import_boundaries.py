"""Dayton admin boundaries → police_precincts, neighborhoods, zip_codes.

PURPOSE
    Replaces the fork's import_police_districts.py and import_neighborhoods.py. Those ran
    `CREATE TABLE IF NOT EXISTS` inside the importer and wrote neighborhoods into a table
    called `wards`. Here each row carries the table it belongs to (`_table`), and the static
    plan splits them into three tile layers with select functions.

FLOW
    download() → three cached ArcGIS fetches (police, neighborhoods, ZCTAs)
    transform() → police rows + in-city neighborhood rows + ZCTAs that overlap the city
                  (the city outline = union of the in-city neighborhoods)

TRAPS (verified 2026-10-02)
    - Police: 4 areas (Central, East, West, and the airport). The fork's log said 4 and
      its comment said 7; COUNT says 4. `Id` is 0 for the airport, so the key is the
      short name ("Central", "Airport").
    - Neighborhoods: 97 features, 31 of them "<TOWN> - OUTSIDE CITY" fillers. 66 remain.
    - ZCTAs: TIGER ZCTAs are national. The prefix (453/454) plus the city envelope still
      returns 27, several only grazing the city. Keep a ZCTA only if it overlaps the city
      outline by at least MIN_ZCTA_OVERLAP_KM2.

ADJUSTABLE: MIN_ZCTA_OVERLAP_KM2 below.
"""

import json
from pathlib import Path

from shapely import union_all
from shapely.geometry import MultiPolygon, Polygon, mapping, shape

from app.data_import.base_importer import BaseImporter
from app.data_import.dayton._sources import (
    DAYTON_CITY_BBOX,
    fetch_arcgis,
    read_features,
    replace_rows,
)
from app.data_import.dayton.field_maps import (
    DAYTON_NEIGHBORHOODS,
    DAYTON_POLICE_AREAS,
    TIGER_ZCTA,
)
from app.data_import.field_map import pick

# ADJUSTABLE: 0.25 km² keeps ZCTAs that hold a few real blocks of Dayton and drops ones
# that only touch the line. Raise to ~1.0 for a shorter zip list; 0 keeps all 27.
MIN_ZCTA_OVERLAP_KM2 = 0.25
# 1° lat ≈ 111.0 km; 1° lon ≈ 85.4 km at 39.75°N → 1 km² ≈ 1.055e-4 deg². Good enough for
# a threshold (±1 % across the city's latitude range).
_KM2_PER_DEG2 = 111.0 * 85.4

POLICE_TABLE = "police_precincts"
NEIGHBORHOOD_TABLE = "neighborhoods"
ZIP_TABLE = "zip_codes"


def as_multipolygon(geom_json: dict | None):
    """O(v) time, O(v) space — v = vertices. Polygon/MultiPolygon → MultiPolygon, else None."""
    if not geom_json:
        return None
    try:
        geom = shape(geom_json)
    except Exception:  # noqa: BLE001 — malformed upstream geometry is skipped
        return None
    if isinstance(geom, Polygon) and not geom.is_empty:
        return MultiPolygon([geom])
    if isinstance(geom, MultiPolygon) and not geom.is_empty:
        return geom
    return None


def police_key(name: str) -> str:
    """O(n) time, O(n) space — n = name length.

    "Central District" → "Central"; "James M. Cox / Dayton International Airport" → "Airport".
    """
    if "airport" in name.lower():
        return "Airport"
    return name.replace(" District", "").strip()


def display_name(upper: str) -> str:
    """O(n) time, O(n) space — n = name length. "DAYTON VIEW TRIANGLE" → "Dayton View Triangle".

    UNPROVEN for names with inner capitals ("McPherson" comes out "Mcpherson"): HOOD is
    stored all upper case, so the original casing is unknowable here.
    """
    return upper.strip().title()


def is_outside_city(name: str) -> bool:
    """O(n) time, O(1) space — n = name length."""
    return "OUTSIDE CITY" in name.upper()


def overlap_km2(geom, city) -> float:
    """O(v log v) time, O(v) space — v = vertices of both shapes (polygon overlay)."""
    return geom.intersection(city).area * _KM2_PER_DEG2


class DaytonBoundariesImporter(BaseImporter):
    layer_name = "boundaries"

    # Cache suffix per source, so each is downloaded once and re-runs are offline.
    _SUFFIXES = {
        POLICE_TABLE: "_police.geojson",
        NEIGHBORHOOD_TABLE: "_neighborhoods.geojson",
        ZIP_TABLE: "_zcta.geojson",
    }

    def _source_url(self, table: str, default: str) -> str:
        """O(1) time, O(1) space — n = one config lookup."""
        return (self._config.get(table) or {}).get("url") or default

    def download(self) -> Path:
        """O(n) time, O(n) space — n = boundary features (4 + 97 + ~27)."""
        fetch_arcgis(
            self,
            self._source_url(POLICE_TABLE, DAYTON_POLICE_AREAS.source),
            out_fields="OBJECTID,District",
            suffix=self._SUFFIXES[POLICE_TABLE],
        )
        fetch_arcgis(
            self,
            self._source_url(NEIGHBORHOOD_TABLE, DAYTON_NEIGHBORHOODS.source),
            out_fields="OBJECTID,HOOD,PRI_BOARD,PRIBD",
            suffix=self._SUFFIXES[NEIGHBORHOOD_TABLE],
        )
        zcta = fetch_arcgis(
            self,
            self._source_url(ZIP_TABLE, TIGER_ZCTA.source),
            where="ZCTA5 LIKE '453%' OR ZCTA5 LIKE '454%'",
            out_fields="ZCTA5",
            envelope=DAYTON_CITY_BBOX,
            suffix=self._SUFFIXES[ZIP_TABLE],
        )
        return zcta

    def transform(self, raw_path: Path) -> list[dict]:
        """O(V log V) time, O(V) space — V = boundary vertices across all three sources.

        The ZCTA overlays dominate; the 453/454 prefix bounds them to ~27 polygons.

        Emit rows tagged with `_table`. Ids/numbers are stored as text.
        """
        police = self._police_rows()
        neighborhoods = self._neighborhood_rows()
        # O(n) time, O(n) space — n = neighborhoods
        city = union_all([shape(json.loads(r["geom_json"])) for r in neighborhoods])
        zips = self._zip_rows(city)
        self._log.info(
            "transformed", police=len(police), neighborhoods=len(neighborhoods), zips=len(zips)
        )
        return police + neighborhoods + zips

    def _police_rows(self) -> list[dict]:
        """O(n) time, O(n) space — n = police areas (4)."""
        rows: list[dict] = []
        # O(n) time, O(n) space — n = features
        for feat in read_features(self._cache_path(self._SUFFIXES[POLICE_TABLE])):
            geom = as_multipolygon(feat.get("geometry"))
            name = pick(feat.get("properties") or {}, DAYTON_POLICE_AREAS, "name")
            if geom is None or not name:
                continue
            rows.append(
                {
                    "_table": POLICE_TABLE,
                    "city_id": self._city_id,
                    "precinct": police_key(name),
                    "name": name,
                    "geom_json": json.dumps(mapping(geom)),
                }
            )
        return rows

    def _neighborhood_rows(self) -> list[dict]:
        """O(n) time, O(n) space — n = neighborhood features (97 → 66 kept)."""
        rows: list[dict] = []
        # O(n) time, O(n) space — n = features
        for feat in read_features(self._cache_path(self._SUFFIXES[NEIGHBORHOOD_TABLE])):
            props = feat.get("properties") or {}
            geom = as_multipolygon(feat.get("geometry"))
            raw_name = pick(props, DAYTON_NEIGHBORHOODS, "name")
            if geom is None or not raw_name or is_outside_city(raw_name):
                continue
            rows.append(
                {
                    "_table": NEIGHBORHOOD_TABLE,
                    "city_id": self._city_id,
                    "name": display_name(raw_name),
                    "priority_board": pick(props, DAYTON_NEIGHBORHOODS, "priority_board"),
                    "geom_json": json.dumps(mapping(geom)),
                }
            )
        return rows

    def _zip_rows(self, city) -> list[dict]:
        """O(V log V) time, O(V) space — V = vertices of candidate ZCTAs + city outline."""
        rows: list[dict] = []
        # O(V log V) time, O(V) space — V = vertices over all ZCTA overlays (~27 polygons)
        for feat in read_features(self._cache_path(self._SUFFIXES[ZIP_TABLE])):
            geom = as_multipolygon(feat.get("geometry"))
            zip_code = pick(feat.get("properties") or {}, TIGER_ZCTA, "zip_code")
            if geom is None or not zip_code:
                continue
            if not city.is_empty and overlap_km2(geom, city) < MIN_ZCTA_OVERLAP_KM2:
                continue
            rows.append(
                {
                    "_table": ZIP_TABLE,
                    "city_id": self._city_id,
                    "zip_code": zip_code,
                    "geom_json": json.dumps(mapping(geom)),
                }
            )
        return rows

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records. Per table: delete this city's rows, insert."""
        columns = {
            POLICE_TABLE: ("precinct", "name"),
            NEIGHBORHOOD_TABLE: ("name",),
            ZIP_TABLE: ("zip_code",),
        }
        total = 0
        # O(n) time, O(n) space — n = records, split across 3 fixed tables
        for table, cols in columns.items():
            # bigo-lint: disable=BIGO006 — 3 fixed tables; each record is scanned three times
            # O(n) time, O(n) space — n = records
            rows = [r for r in records if r.get("_table") == table]
            total += replace_rows(self, table, cols, rows)
        return total
