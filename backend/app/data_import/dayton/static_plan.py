"""Dayton's static-mode build plan: which importer feeds which PMTiles file.

PURPOSE
    `python -m scripts.export_city_static --city dayton` imports STATIC_PLAN from here and
    writes frontend/public/data/dayton/<layer_id>.pmtiles (see static_build.py). Tile-layer
    names equal the PostGIS table names, so the frontend reads one `source-layer` in both
    dev and static mode. This file is data plus small select/classify functions; the
    orchestration lives in static_build.build_city.

LAYERS (frontend layer id → tile layers)
    buildings        → buildings          City MapServer/307 + parcel join + zoning tag
    zoning           → zoning_districts   City MapServer/203 (NEW_ZONE)
    parks            → parks              OSM Overpass
    railroads        → railroads          shared RailroadsImporter (OSM) + owner normalising
    transit          → transit_lines, transit_stations   shared GTFS path (GDRTA)
    waterways        → waterways          USGS NHD flowlines
    pois             → pois               shared POIsImporter (OSM)
    major_streets    → major_streets      City MapServer/312 arterials
    zip_codes        → zip_codes          TIGERweb ZCTAs overlapping the city (+ .geojson)
    police_precincts → police_precincts   Dayton PD areas (+ .geojson)
    neighborhoods    → neighborhoods      City MapServer/310, in-city only (+ .geojson)

    NOT built: parcels (enrichment source only — 273K polygons would break the size
    budget), railroad_row (deferred), federal_properties (no Dayton list exists).

ENRICH: enrich.run_static — buildings ← parcels (address, owner, year), buildings ←
    zoning (zoning_code, zone_class). Parcels/zoning are read through their importers'
    download cache when they are not part of this run.

TO ADD A LAYER: write (or reuse) an importer, add a StaticLayer below, and add the id to
    frontend src/cities/dayton/layers.ts.
"""

from __future__ import annotations

import re

from app.data_import.base_importer import BaseImporter
from app.data_import.dayton import enrich
from app.data_import.dayton.import_boundaries import (
    NEIGHBORHOOD_TABLE,
    POLICE_TABLE,
    ZIP_TABLE,
    DaytonBoundariesImporter,
)
from app.data_import.dayton.import_buildings import DaytonBuildingsImporter
from app.data_import.dayton.import_major_streets import DaytonMajorStreetsImporter
from app.data_import.dayton.import_parcels import DaytonParcelsImporter
from app.data_import.dayton.import_parks import DaytonParksImporter
from app.data_import.dayton.import_waterways import DaytonWaterwaysImporter
from app.data_import.dayton.import_zoning import DaytonZoningImporter
from app.data_import.import_pois import POIsImporter
from app.data_import.import_railroads import RailroadsImporter
from app.data_import.import_transit import TransitImporter
from app.data_import.static_build import StaticLayer, StaticPlan, TileLayer

SLUG = "dayton"

# Railroad operator text (OSM `operator`/`owner`) → (canonical key, ownership type).
# Keys are what the tiles carry in `owner`, and what frontend DAYTON_RAILROAD_OWNERS lists.
# Patterns were checked against the distinct OSM values on 2026-10-02 (see taxonomies.ts).
# ADJUSTABLE: add a row when a new operator appears in the "_other" bucket.
RAILROAD_OPERATORS: tuple[tuple[str, str, str], ...] = (
    (r"\bCSX\b", "CSX", "private_class1"),
    (r"NORFOLK SOUTHERN|\bNS\b", "NS", "private_class1"),
    (r"AMTRAK", "Amtrak", "government_passenger"),
    (r"INDIANA (AND|&) OHIO|\bIORY\b|GENESEE", "IORY", "private_shortline"),
    (r"R\.?\s?J\.?\s?CORMAN", "RJC", "private_shortline"),
    (r"CAMP CHASE", "CCRL", "private_shortline"),
    (r"CITY OF DAYTON", "City of Dayton", "city_owned"),
    # Five Rivers MetroParks = Montgomery County's park district (12 ways, 2026-10-02).
    (r"METROPARKS", "MetroParks", "county_owned"),
    (r"MONTGOMERY COUNTY|MIAMI VALLEY", "Montgomery County", "county_owned"),
    (r"GREATER DAYTON|\bRTA\b", "GDRTA", "government_transit"),
    (r"US AIR FORCE|WRIGHT[- ]PATTERSON|USAF", "USAF", "government_passenger"),
)
# bigo-lint: disable=BIGO006 — module-level constant, compiled once at import
# O(1) time, O(1) space — k = 11 fixed patterns
_RAILROAD_PATTERNS = [(re.compile(p, re.I), key, kind) for p, key, kind in RAILROAD_OPERATORS]


def classify_railroad_owner(raw: str | None) -> tuple[str | None, str]:
    """O(1) time, O(1) space — k = 11 fixed patterns, each one regex search.

    Raw operator text → (canonical owner key or the raw text, ownership_type).
    No operator → (None, "unknown"); unrecognised → (raw, "unknown").
    """
    text = (raw or "").strip()
    if not text:
        return None, "unknown"
    # O(k) time, O(1) space — k = fixed patterns
    for pattern, key, kind in _RAILROAD_PATTERNS:
        if pattern.search(text):
            return key, kind
    return text, "unknown"


def select_railroads(rows: list[dict]) -> list[dict]:
    """O(n) time, O(1) space — n = railroad rows (mutated in place)."""
    # O(n) time, O(1) space — n = rows
    for row in rows:
        row["operator"] = row.get("owner")
        row["owner"], row["ownership_type"] = classify_railroad_owner(row.get("owner"))
    return rows


def select_transit_lines(rows: list[dict]) -> list[dict]:
    """O(n) time, O(n) space — n = GTFS routes. TransitImporter returns [{"lines","stations"}]."""
    lines = rows[0].get("lines", []) if rows else []
    # O(n) time, O(1) space — n = lines
    for line in lines:
        line["line_name"] = line.get("name")
        # routes.txt colours arrive lower case ("#ff8080"); upper-case them to match the
        # '#RRGGBB' contract. Fallback GDRTA blue is used only if a route has none.
        line["color"] = (line.get("color") or "#0B5394").upper()
    return lines


def select_transit_stations(rows: list[dict]) -> list[dict]:
    """O(1) time, O(1) space — n = rows passed through (the stations list itself)."""
    return rows[0].get("stations", []) if rows else []


def _table(name: str):
    """O(1) time, O(1) space — n = one closure. Select boundary rows of one table."""

    def select(rows: list[dict]) -> list[dict]:
        """O(n) time, O(n) space — n = boundary rows (~100)."""
        # O(n) time, O(n) space — n = rows
        return [r for r in rows if r.get("_table") == name]

    return select


def _cached_rows(importer_cls: type[BaseImporter]) -> list[dict]:
    """O(n) time, O(n) space — n = rows the importer transforms (download is cached)."""
    importer = importer_cls(db_url="", city_id=SLUG, config={})
    return importer.transform(importer.download())


def enrich_static(rows: dict[str, list[dict]]) -> None:
    """O((n + m) log m) time, O(m) space — n = buildings; m = parcels + zoning polygons."""
    counts = enrich.run_static(
        rows,
        load_parcels=lambda: _cached_rows(DaytonParcelsImporter),
        load_zoning=lambda: _cached_rows(DaytonZoningImporter),
    )
    if counts:
        print(f"  enrich: buildings tagged {counts}")


BUILDING_PROPS = (
    "id",
    "address",
    "name",
    "year_built",
    "floors",
    "zoning_code",
    "zone_class",
    "is_hidden",
    "has_interior",
    "parcel_pin",
    "owner_name",
    "land_use",
    "zip",
)

STATIC_PLAN = StaticPlan(
    slug=SLUG,
    layers=(
        StaticLayer(
            "buildings",
            (
                TileLayer(
                    "buildings",
                    DaytonBuildingsImporter,
                    ("buildings",),
                    keep=BUILDING_PROPS,
                    minzoom=12,
                    maxzoom=15,
                ),
            ),
            # ~232K footprints. maxzoom 16 gave a 77 MB archive (2026-10-02), over the
            # 70 MB buildings budget; 15 + MapLibre overzoom looks the same on screen.
            # ADJUSTABLE: 16 for sharper corners at z18+, at ~+30 % size.
            # Drop the densest at z12–13 instead of failing the tile.
            tippecanoe_args=("--drop-densest-as-needed", "--extend-zooms-if-still-dropping"),
        ),
        StaticLayer(
            "zoning",
            (
                TileLayer(
                    "zoning_districts",
                    DaytonZoningImporter,
                    ("zoning",),
                    keep=("zone_code", "zone_class", "zone_name", "legacy_code"),
                    minzoom=9,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "parks",
            (
                TileLayer(
                    "parks",
                    DaytonParksImporter,
                    ("parks",),
                    keep=("name", "park_type"),
                    minzoom=9,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "railroads",
            (
                TileLayer(
                    "railroads",
                    RailroadsImporter,
                    ("railroads",),
                    select=select_railroads,
                    keep=("name", "owner", "operator", "ownership_type", "status", "track_class"),
                    minzoom=8,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "transit",
            (
                TileLayer(
                    "transit_lines",
                    TransitImporter,
                    ("transit_lines", "transit_stations"),
                    select=select_transit_lines,
                    keep=("name", "line_name", "color", "system", "line_type"),
                    minzoom=8,
                    maxzoom=15,
                ),
                TileLayer(
                    "transit_stations",
                    TransitImporter,
                    ("transit_lines", "transit_stations"),
                    select=select_transit_stations,
                    keep=("name", "lines_served", "accessible"),
                    minzoom=11,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "waterways",
            (
                TileLayer(
                    "waterways",
                    DaytonWaterwaysImporter,
                    ("waterways",),
                    keep=("name", "waterway_type"),
                    minzoom=8,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "pois",
            (
                TileLayer(
                    "pois",
                    POIsImporter,
                    ("pois",),
                    keep=("name", "category", "subcategory", "address", "phone", "website"),
                    minzoom=10,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "major_streets",
            (
                TileLayer(
                    "major_streets",
                    DaytonMajorStreetsImporter,
                    ("major_streets",),
                    keep=("name",),
                    minzoom=10,
                    maxzoom=15,
                ),
            ),
        ),
        StaticLayer(
            "zip_codes",
            (
                TileLayer(
                    "zip_codes",
                    DaytonBoundariesImporter,
                    ("police_precincts", "neighborhoods", "zip_codes"),
                    select=_table(ZIP_TABLE),
                    keep=("zip_code",),
                    minzoom=8,
                    maxzoom=14,
                ),
            ),
            geojson_copy=True,
        ),
        StaticLayer(
            "police_precincts",
            (
                TileLayer(
                    "police_precincts",
                    DaytonBoundariesImporter,
                    ("police_precincts", "neighborhoods", "zip_codes"),
                    select=_table(POLICE_TABLE),
                    keep=("precinct", "name"),
                    minzoom=8,
                    maxzoom=14,
                ),
            ),
            geojson_copy=True,
        ),
        StaticLayer(
            "neighborhoods",
            (
                TileLayer(
                    "neighborhoods",
                    DaytonBoundariesImporter,
                    ("police_precincts", "neighborhoods", "zip_codes"),
                    select=_table(NEIGHBORHOOD_TABLE),
                    keep=("name", "priority_board"),
                    minzoom=8,
                    maxzoom=14,
                ),
            ),
            geojson_copy=True,
        ),
    ),
    enrich=enrich_static,
    notes=(
        "parcels: enrichment source only (no parcels.pmtiles)",
        "railroad_row: deferred",
        "federal_properties: not offered (no Dayton dataset)",
    ),
)
