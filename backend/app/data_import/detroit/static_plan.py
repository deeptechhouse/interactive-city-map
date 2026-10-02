"""Detroit's static-mode build plan: which importer feeds which PMTiles file.

PURPOSE
    STATIC_PLAN is read by scripts/export_city_static.py → static_build.build_city(). It
    maps every Detroit frontend layer id to one PMTiles file in
    frontend/public/data/detroit/, names the tile layers inside it (the contract the
    shared frontend reads), and runs the post-transform joins (enrich_detroit).

    Run (from backend/):
        .venv-build/bin/python -m scripts.export_city_static --city detroit --basemap skip
        … --layers buildings,zoning        (one or more layer ids)

ARCHITECTURE
    select functions  — pure row shaping per tile layer (transit split, railroad owner
                        normalisation); named functions, not lambdas, so each carries its
                        complexity note.
    enrich_detroit()  — spatial/attribute joins after all layers are transformed:
                        buildings ← zoning (containment), buildings ← parcel owners (pin).
    STATIC_PLAN       — data only.

TRAPS
    - `--layers buildings` alone gets NO zoning tags: enrich only sees layers built in the
      same run. Build buildings together with zoning (`--layers buildings,zoning`).
    - parcel_owners rides inside the buildings StaticLayer only so its rows reach enrich;
      its rows have no geometry, so static_build writes no tiles for it.
    - Building ids are stable ("det-bldg-<SEMCOG gid>[-part]"); the popup's contact-list
      button keys on them, so never switch them to uuid4.

TO ADD A LAYER: write/choose an importer, add a StaticLayer below, then add the layer id
    to frontend/src/cities/detroit/layers.ts (DETROIT_STATIC_LAYER_IDS).
"""

from __future__ import annotations

import re

from app.data_import.detroit.import_area_overrides import (
    DetroitDLBAImporter, DetroitNeighborhoodsImporter, DetroitWaterwaysImporter,
)
from app.data_import.detroit.import_boundaries import (
    DetroitCouncilDistrictsImporter, DetroitPolicePrecinctsImporter, DetroitZipCodesImporter,
)
from app.data_import.detroit.import_buildings import DetroitBuildingsImporter
from app.data_import.detroit.import_major_streets import DetroitMajorStreetsImporter
from app.data_import.detroit.import_parcels import DetroitParcelsImporter
from app.data_import.detroit.import_parks import DetroitParksImporter
from app.data_import.detroit.import_zoning import DetroitZoningImporter
from app.data_import.import_blight import BlightImporter
from app.data_import.import_pois import POIsImporter
from app.data_import.import_railroads import RailroadsImporter
from app.data_import.import_transit import TransitImporter
from app.data_import.static_build import StaticLayer, StaticPlan, TileLayer, tag_by_containment

# --- transit ----------------------------------------------------------------------------


def transit_lines(rows: list[dict]) -> list[dict]:
    """O(n) time, O(n) space — n = GTFS routes.

    TransitImporter.transform returns [{"lines": [...], "stations": [...]}]. Lines get
    `line_name` (= name) because the shared TransitLayer colours by line_name.
    """
    lines = rows[0]["lines"] if rows else []
    # O(n) time, O(1) space — n = lines
    for line in lines:
        line["line_name"] = line.get("name")
    return lines


def transit_stations(rows: list[dict]) -> list[dict]:
    """O(n) time, O(1) space — n = GTFS stops (lines_served becomes a JSON string in tiles)."""
    return rows[0]["stations"] if rows else []


# --- railroads --------------------------------------------------------------------------

# OSM `operator`/`owner` text → (reporting mark, ownership type). First match wins.
# Keys match frontend cities/detroit/taxonomies.ts and the shared RailroadFilter semantics
# (`owner` = mark, `owner_type` = ownership type, '_other' = anything unlisted).
# ADJUSTABLE: add a carrier as (regex on lower-case operator/owner, mark, type).
# OSM operator strings seen 2026-10-02 (3,382 ways): none 995, Consolidated Rail Corporation
# 800, Canadian National Railway 458, CSX Transportation 258, Norfolk Southern Railway 171,
# Delray Connecting Railroad 158, Canadian Pacific Kansas City 134, Conrail Shared Assets
# Operations 117, Ford Motor Company 79, Essex Terminal Railway (ETR) 74, VIA Rail 55,
# Amtrak 42, US Steel 13, Great Lakes Steel 12, Detroit Connecting Railroad 8,
# Detroit Transportation Corporation 7, CN 1.
# TRAP: "Consolidated Rail Corporation" does not contain the word "conrail" — both
# spellings are listed, or 800 ways fall into Other.
RAILROAD_OWNER_RULES: tuple[tuple[str, str, str], ...] = (
    (r"\bcsx\b", "CSX", "private_class1"),
    (r"norfolk southern|\bns\b", "NS", "private_class1"),
    (r"canadian national|grand trunk|\bcn\b", "CN", "private_class1"),
    (r"canadian pacific|cpkc|soo line|\bcp\b", "CP", "private_class1"),
    (r"conrail|consolidated rail", "CRSH", "private_terminal"),
    (r"delray connecting|detroit connecting", "DC", "private_terminal"),
    (r"essex terminal", "ETR", "private_terminal"),
    (r"amtrak", "AMTK", "government_passenger"),
    (r"\bvia rail\b", "VIA", "government_passenger"),
    (r"people mover|detroit transportation corporation", "DPM", "government_transit"),
    (r"m-1 rail|qline|q-line", "QLINE", "government_transit"),
    (r"ford motor|us steel|u\.s\. steel|great lakes steel", "IND", "private_industrial"),
)
# O(k) time, O(k) space — k = owner rules (compiled once at import)
_OWNER_RULES = tuple((re.compile(p), mark, kind) for p, mark, kind in RAILROAD_OWNER_RULES)


def classify_railroad_owner(raw: str | None) -> tuple[str, str]:
    """O(k) time, O(1) space — k = owner rules (fixed ≈ 9).

    OSM operator text → (owner mark, owner_type). Unknown → (raw text or '_other', 'unknown').
    The raw text is kept as the mark for unknown owners so the "Other" bucket still shows
    something meaningful in a popup; the filter treats any unlisted mark as '_other'.
    """
    if not raw:
        return "_other", "unknown"
    lowered = raw.lower()
    # O(k) time, O(1) space — k = rules
    for pattern, mark, kind in _OWNER_RULES:
        if pattern.search(lowered):
            return mark, kind
    return raw.strip(), "unknown"


def railroads_with_owner_marks(rows: list[dict]) -> list[dict]:
    """O(n) time, O(1) space — n = railroad ways (rule list is a fixed ≈ 9 patterns)."""
    # O(n) time, O(1) space — n = rows
    for row in rows:
        row["operator"] = row.get("owner")
        row["owner"], row["owner_type"] = classify_railroad_owner(row.get("owner"))
    return rows


# --- enrichment -------------------------------------------------------------------------


def join_parcel_owners(buildings: list[dict], owners: list[dict]) -> int:
    """O(n + m) time, O(m) space — n = buildings; m = parcel owner rows (hash join on pin)."""
    # O(m) time, O(m) space — m = owner rows
    by_pin = {row["parcel_pin"].strip(): row["owner_name"] for row in owners}
    joined = 0
    # O(n) time, O(1) space — n = buildings
    for building in buildings:
        owner = by_pin.get((building.get("parcel_pin") or "").strip())
        if owner:
            building["owner_name"] = owner
            joined += 1
    return joined


def enrich_detroit(rows: dict[str, list[dict]]) -> None:
    """O((n + m) log m + p) time, O(m + p) space — n = buildings; m = zoning; p = owner rows.

    Mutates building rows in place: zoning_code/zone_class from the containing zoning
    polygon, owner_name from the parcel with the same pin. Skips joins whose inputs
    were not built in this run.
    """
    buildings = rows.get("buildings")
    if not buildings:
        return
    if rows.get("zoning_districts"):
        tag_by_containment(
            buildings, rows["zoning_districts"],
            {"zoning_code": "zone_code", "zone_class": "zone_class"},
        )
    if rows.get("parcel_owners"):
        join_parcel_owners(buildings, rows["parcel_owners"])


# --- plan -------------------------------------------------------------------------------

BUILDING_PROPS = (
    "id", "address", "name", "year_built", "floors", "zoning_code", "zone_class",
    "is_hidden", "has_interior", "parcel_pin", "owner_name",
)

STATIC_PLAN = StaticPlan(
    slug="detroit",
    layers=(
        StaticLayer(
            "buildings",
            (
                TileLayer("buildings", DetroitBuildingsImporter, ("buildings",),
                          keep=BUILDING_PROPS, minzoom=11, maxzoom=16),
                TileLayer("parcel_owners", DetroitParcelsImporter, ("parcels",)),
            ),
            tippecanoe_args=("--drop-densest-as-needed", "--extend-zooms-if-still-dropping"),
        ),
        StaticLayer(
            "zoning",
            (TileLayer("zoning_districts", DetroitZoningImporter, ("zoning",),
                       keep=("id", "zone_code", "zone_class", "zone_name"),
                       minzoom=9, maxzoom=14),),
            tippecanoe_args=("--coalesce-densest-as-needed", "--detect-shared-borders"),
        ),
        StaticLayer("parks", (TileLayer("parks", DetroitParksImporter, ("parks",),
                                        minzoom=9, maxzoom=14),)),
        StaticLayer("railroads", (TileLayer("railroads", RailroadsImporter, ("railroads",),
                                            select=railroads_with_owner_marks,
                                            minzoom=8, maxzoom=14),)),
        StaticLayer(
            "transit",
            (
                TileLayer("transit_lines", TransitImporter, ("transit_lines", "transit_stations"),
                          select=transit_lines, minzoom=8, maxzoom=14),
                TileLayer("transit_stations", TransitImporter,
                          ("transit_lines", "transit_stations"),
                          select=transit_stations, minzoom=11, maxzoom=14),
            ),
            tippecanoe_args=("--drop-densest-as-needed",),
        ),
        StaticLayer("waterways", (TileLayer("waterways", DetroitWaterwaysImporter,
                                            ("waterways", "council_districts"),
                                            minzoom=8, maxzoom=14),)),
        StaticLayer("pois", (TileLayer("pois", POIsImporter, ("pois",),
                                       minzoom=11, maxzoom=14),),
                    tippecanoe_args=("--drop-densest-as-needed",)),
        StaticLayer("major_streets", (TileLayer(
            "major_streets", DetroitMajorStreetsImporter,
            ("major_streets", "council_districts"), minzoom=8, maxzoom=14),)),
        StaticLayer("zip_codes", (TileLayer(
            "zip_codes", DetroitZipCodesImporter, ("zip_codes", "council_districts"),
            minzoom=8, maxzoom=14),), geojson_copy=True),
        StaticLayer("police_precincts", (TileLayer(
            "police_precincts", DetroitPolicePrecinctsImporter, ("police_precincts",),
            minzoom=8, maxzoom=14),), geojson_copy=True),
        StaticLayer("council_districts", (TileLayer(
            "council_districts", DetroitCouncilDistrictsImporter, ("council_districts",),
            minzoom=8, maxzoom=14),), geojson_copy=True),
        StaticLayer("neighborhoods", (TileLayer(
            "neighborhoods", DetroitNeighborhoodsImporter, ("neighborhoods",),
            minzoom=8, maxzoom=14),), geojson_copy=True),
        StaticLayer("dlba_properties", (TileLayer(
            "dlba_properties", DetroitDLBAImporter, ("dlba_properties",),
            minzoom=11, maxzoom=15),), tippecanoe_args=("--drop-densest-as-needed",)),
        StaticLayer("abandoned_blight", (TileLayer(
            "blight_violations", BlightImporter, ("blight_violations",),
            keep=("id", "address", "violation_code", "violation_description",
                  "ticket_status", "violation_date", "source"),
            minzoom=12, maxzoom=16),),
            tippecanoe_args=("--drop-densest-as-needed", "--extend-zooms-if-still-dropping")),
    ),
    enrich=enrich_detroit,
    notes=(
        "Buildings: SEMCOG city_id 501–555 (Detroit sub-areas), not demolished.",
        "Blight: tickets issued since 2021-01-01 (yaml tickets_where).",
        "Parcels: owner attributes only; no parcels.pmtiles.",
    ),
)
