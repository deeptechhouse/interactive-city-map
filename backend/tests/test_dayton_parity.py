"""Dayton parity acceptance tests.

PURPOSE
    Pins the Dayton contract the static build and the frontend share: zone classes and
    codes, tile property names, the parcel join, boundary filtering, the GTFS route. Pure
    tests — no network, no database. Recorded fixtures are tiny dicts written inline.

Run: cd backend && .venv-build/bin/python -m pytest -q --noconftest -p no:cacheprovider \
         tests/test_dayton_parity.py

Still skipped (named phase not built): railroad_row (deferred), the Tracerfy owner batch
(shared code, lead's lane).
"""

import json
import re
from pathlib import Path

import pytest
import yaml
from shapely.geometry import MultiPolygon, box, mapping

from app.data_import import base_importer
from app.data_import.dayton import enrich
from app.data_import.dayton.import_boundaries import (
    DaytonBoundariesImporter,
    display_name,
    police_key,
)
from app.data_import.dayton.import_buildings import DaytonBuildingsImporter
from app.data_import.dayton.import_major_streets import DaytonMajorStreetsImporter, arterial_where
from app.data_import.dayton.import_parcels import parcel_row, split_city_line
from app.data_import.dayton.import_parks import relation_polygon, way_polygon
from app.data_import.dayton.import_zoning import (
    DAYTON_ZONE_CLASS_KEYS,
    DAYTON_ZONES,
    classify_dayton_zone,
)
from app.data_import.dayton.plan import DAYTON_SKIPPED_LAYERS, dayton_importer_overrides
from app.data_import.dayton.static_plan import (
    STATIC_PLAN,
    classify_railroad_owner,
    select_transit_lines,
)
from app.data_import.import_transit import _is_gtfs_config

BACKEND = Path(__file__).resolve().parent.parent
REPO = BACKEND.parent
FRONTEND_ZONING = REPO / "frontend" / "src" / "cities" / "dayton" / "zoning.ts"
STATIC_DIR = REPO / "frontend" / "public" / "data" / "dayton"

pending = pytest.mark.skip(reason="Dayton parity — named phase not built yet")


def _square(x: float, y: float, size: float = 0.001) -> str:
    """O(1) time, O(1) space — n = one 5-point ring as GeoJSON text."""
    return json.dumps(mapping(box(x, y, x + size, y + size)))


def _write_fc(path: Path, features: list[dict]) -> Path:
    """O(n) time, O(n) space — n = features serialised."""
    path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))
    return path


@pytest.fixture()
def cache_dir(tmp_path, monkeypatch):
    """O(1) time, O(1) space — n = one patched module global (importer cache → tmp)."""
    monkeypatch.setattr(base_importer, "CACHE_DIR", tmp_path)
    return tmp_path


# --- D2 importer plan -----------------------------------------------------------------


def test_d2_dayton_importer_plan_skips_detroit_only_layers():
    """importers_for('dayton') has no blight, dlba or council_districts importer."""
    overrides = dayton_importer_overrides()
    # O(s) time, O(1) space — s = skipped layers
    for layer in ("blight_violations", "dlba_properties", "council_districts"):
        assert overrides[layer] is None
        assert layer in DAYTON_SKIPPED_LAYERS
    assert overrides["parcels"].__name__ == "DaytonParcelsImporter"


def test_d2_parcels_importer_is_not_the_cook_county_stub():
    """A Montgomery County (OH) row maps to a clean parcel row with PIN, owner, address."""
    props = {
        "GISADMIN.WEB_CAMA.PARID": "R72 12307 0032",
        "GISADMIN.WEB_CAMA.PARLOC": "100 SAMPLE AVE",
        "GISADMIN.WEB_CAMA.OWNER_NAME": "SAMPLE OWNER",
        "GISADMIN.WEB_CAMA.OWNER_ADDR": "100 SAMPLE AVE",
        "GISADMIN.WEB_CAMA.OWNER_AD_2": "DAYTON, OH  45402",
        "GISADMIN.WEB_CAMA.MAILING_AD": "549 GRAMONT AVE",
        "GISADMIN.WEB_CAMA.MAILING__3": "DAYTON OH 45402",
        "GISADMIN.WEB_CAMA.APPRTOTAL": "33,470",
        "GISADMIN.WEB_CAMA.DWEL_YRBLT": 1966.0,
        "GISADMIN.WEB_CAMA.COMM_YRBLT": 0.0,
        "GISADMIN.WEB_CAMA.DWEL_STORI": 1.0,
    }
    row = parcel_row(props, box(-84.2, 39.75, -84.19, 39.76), "dayton")
    assert row["pin"] == "R72 12307 0032"
    assert row["address"] == "100 SAMPLE AVE"
    assert row["owner_name"] == "SAMPLE OWNER"
    assert row["year_built"] == 1966 and row["floors"] == 1
    assert row["assessed_value"] == 33470
    assert parcel_row({}, box(0, 0, 1, 1), "dayton") is None  # no PIN → skipped


def test_d2_enrichment_writes_clean_metadata_keys():
    """metadata has owner_address/mailing_address, never owner_ad_2/mailing__3."""
    props = {
        "GISADMIN.WEB_CAMA.PARID": "X",
        "GISADMIN.WEB_CAMA.OWNER_AD_2": "SPRINGBORO, OH  45066",
        "GISADMIN.WEB_CAMA.MAILING__3": "DAYTON OH 45406",
    }
    meta = parcel_row(props, box(0, 0, 1, 1), "dayton")["metadata"]
    assert meta["owner_address"] == {
        "street": "",
        "city": "SPRINGBORO",
        "state": "OH",
        "zip": "45066",
    }
    assert meta["mailing_address"]["zip"] == "45406"
    text = json.dumps(meta).lower()
    assert "owner_ad_2" not in text and "mailing__3" not in text
    assert split_city_line("LONDON UK") == {"city": "LONDON UK", "state": "", "zip": ""}


# --- D2 zoning ----------------------------------------------------------------------------


def test_d2_zoning_never_uses_chicago_prefixes():
    """classify_dayton_zone('C1') == 'other', never Chicago's 'commercial' rule."""
    # O(c) time, O(1) space — c = Chicago codes sampled
    for chicago_code in ("C1", "B1-1", "M1-2", "RS-3", "PMD 4", "PD 1047"):
        assert classify_dayton_zone(chicago_code) == "other"
    assert classify_dayton_zone("er-3 ") == "residential"
    assert classify_dayton_zone("I-2") == "manufacturing"
    assert classify_dayton_zone("") == "other"


def test_d2_zoning_classes_match_frontend_keys():
    """Every zone_class and code the importer can emit exists in DAYTON_ZONE_CLASSES."""
    source = FRONTEND_ZONING.read_text()
    # O(k) time, O(k) space — k = class keys
    for cls in DAYTON_ZONE_CLASS_KEYS:
        assert re.search(rf"key:\s*'{re.escape(cls)}'", source), f"class {cls} missing in zoning.ts"
    # O(z) time, O(1) space — z = Dayton codes (26)
    for code in DAYTON_ZONES:
        assert f"'{code}'" in source, f"code {code} missing in zoning.ts"


# --- D2 boundaries --------------------------------------------------------------------------


def test_d2_neighborhoods_load_into_neighborhoods_not_wards(cache_dir):
    """Boundaries emit neighborhoods, police_precincts, zip_codes only; OUTSIDE CITY dropped;
    ZCTAs that only graze the city are dropped."""
    importer = DaytonBoundariesImporter(db_url="", city_id="dayton")
    sq = lambda x, y, s=0.02: json.loads(_square(x, y, s))  # noqa: E731
    _write_fc(
        importer._cache_path("_police.geojson"),
        [
            {"properties": {"District": "Central District"}, "geometry": sq(-84.2, 39.75)},
            {
                "properties": {"District": "James M. Cox / Dayton International Airport"},
                "geometry": sq(-84.3, 39.88),
            },
        ],
    )
    _write_fc(
        importer._cache_path("_neighborhoods.geojson"),
        [
            {"properties": {"HOOD": "DAYTON VIEW TRIANGLE"}, "geometry": sq(-84.2, 39.75)},
            {"properties": {"HOOD": "BROOKVILLE - OUTSIDE CITY"}, "geometry": sq(-84.4, 39.8)},
        ],
    )
    _write_fc(
        importer._cache_path("_zcta.geojson"),
        [
            {"properties": {"ZCTA5": "45406"}, "geometry": sq(-84.2, 39.75)},
            {"properties": {"ZCTA5": "45999"}, "geometry": sq(-84.1, 39.7)},  # no overlap
        ],
    )
    rows = importer.transform(importer._cache_path("_zcta.geojson"))
    # O(n) time, O(n) space — n = rows
    tables = {r["_table"] for r in rows}
    assert tables == {"police_precincts", "neighborhoods", "zip_codes"}
    # O(n) time, O(n) space — n = rows
    names = [r["name"] for r in rows if r["_table"] == "neighborhoods"]
    assert names == ["Dayton View Triangle"]
    # O(n) time, O(n) space — n = rows
    assert [r["zip_code"] for r in rows if r["_table"] == "zip_codes"] == ["45406"]
    # O(n) time, O(n) space — n = rows
    assert sorted(r["precinct"] for r in rows if r["_table"] == "police_precincts") == [
        "Airport",
        "Central",
    ]
    assert police_key("East District") == "East" and display_name(" WEST ") == "West"


# --- D2 transit, streets, parks, railroads ---------------------------------------------------


def test_d2_gdrta_gtfs_goes_through_shared_gtfs_path():
    """dayton.yaml's *_gtfs_url key makes import_transit take the GTFS path, not CTA/Socrata."""
    sources = yaml.safe_load((BACKEND / "app/data_import/configs/dayton.yaml").read_text())[
        "sources"
    ]
    config = {
        "transit_lines": sources["transit_lines"],
        "transit_stations": sources["transit_stations"],
    }
    assert _is_gtfs_config(config)
    lines = select_transit_lines(
        [{"lines": [{"name": "ROUTE 1", "color": "#ff8080"}], "stations": []}]
    )
    assert lines[0]["line_name"] == "ROUTE 1" and lines[0]["color"] == "#FF8080"


def test_d2_major_streets_filter_and_merge(tmp_path):
    """Arterial filter is a constant IN list; touching segments of one street merge."""
    assert arterial_where() == "FUNCT_CLAS IN ('11','12','14','16')"
    path = _write_fc(
        tmp_path / "s.geojson",
        [
            {
                "properties": {"GEONAME": "W Third St"},
                "geometry": {"type": "LineString", "coordinates": [[0, 0], [1, 0]]},
            },
            {
                "properties": {"GEONAME": "W Third St"},
                "geometry": {"type": "LineString", "coordinates": [[1, 0], [2, 0]]},
            },
            {
                "properties": {"GEONAME": None},
                "geometry": {"type": "LineString", "coordinates": [[5, 5], [6, 6]]},
            },
        ],
    )
    rows = DaytonMajorStreetsImporter(db_url="", city_id="dayton").transform(path)
    assert len(rows) == 1 and rows[0]["name"] == "W Third St"


def test_d2_parks_assemble_ways_and_relations():
    """Closed ways become polygons; split outer ways of a relation are stitched."""
    ring = [{"lon": x, "lat": y} for x, y in ((0, 0), (1, 0), (1, 1), (0, 1), (0, 0))]
    assert way_polygon({"geometry": ring}).area == pytest.approx(1.0)
    assert way_polygon({"geometry": ring[:3]}) is None  # open way
    relation = {
        "members": [
            {"type": "way", "role": "outer", "geometry": ring[:3]},
            {"type": "way", "role": "outer", "geometry": ring[2:]},
        ]
    }
    assert relation_polygon(relation).area == pytest.approx(1.0)


def test_d2_railroad_owners_are_canonical():
    """OSM operator text → reporting-mark keys the frontend taxonomy lists."""
    assert classify_railroad_owner("CSX Transportation") == ("CSX", "private_class1")
    assert classify_railroad_owner("Norfolk Southern Railway") == ("NS", "private_class1")
    assert classify_railroad_owner("Five Rivers MetroParks") == ("MetroParks", "county_owned")
    assert classify_railroad_owner(None) == (None, "unknown")
    assert classify_railroad_owner("Acme Spur Co") == ("Acme Spur Co", "unknown")


# --- D2 buildings + enrichment -----------------------------------------------------------------


def test_d2_buildings_split_multipart_with_stable_ids(tmp_path):
    """Every polygon part is a row; ids are deterministic; booleans always present."""
    multi = mapping(MultiPolygon([box(0, 0, 1, 1), box(2, 2, 3, 3)]))
    path = _write_fc(
        tmp_path / "b.geojson",
        [
            {"properties": {"GlobalID": "{G1}", "NUMSTORIES": 0}, "geometry": multi},
            {"properties": {"GlobalID": "{G2}", "NUMSTORIES": 3}, "geometry": None},
        ],
    )
    importer = DaytonBuildingsImporter(db_url="", city_id="dayton")
    first, second = importer.transform(path), importer.transform(path)
    assert len(first) == 2
    assert [r["id"] for r in first] == [r["id"] for r in second]
    assert first[0]["id"] != first[1]["id"]
    # O(n) time, O(1) space — n = rows
    assert all(r["is_hidden"] is False and r["has_interior"] is False for r in first)
    assert first[0]["floors"] is None  # NUMSTORIES 0 = unknown


def test_d2_enrichment_joins_parcels_and_zoning():
    """Building ← parcel (address/owner/year) and ← zoning (code/class); untagged → 'other'."""
    buildings = [
        {"geom_json": _square(0.1, 0.1, 0.1), "floors": None},
        {"geom_json": _square(5.1, 5.1, 0.1), "floors": 2},
    ]
    parcels = [
        {
            "geom_json": _square(0, 0, 1),
            "pin": "P1",
            "address": "1 MAIN ST",
            "owner_name": "ACME LLC",
            "year_built": 1920,
            "floors": 3,
        }
    ]
    zoning = [{"geom_json": _square(0, 0, 1), "zone_code": "CBD", "zone_class": "mixed"}]
    counts = enrich.run_static({"buildings": buildings}, lambda: parcels, lambda: zoning)
    assert counts == {"parcels": 1, "zoning": 1}
    assert buildings[0]["address"] == "1 MAIN ST" and buildings[0]["parcel_pin"] == "P1"
    assert buildings[0]["floors"] == 3 and buildings[0]["zone_class"] == "mixed"
    assert buildings[1]["zone_class"] == "other" and buildings[1]["floors"] == 2


def test_d2_enrichment_updates_only_dayton_rows():
    """Every enrich.* UPDATE filters both joined tables by city_id."""
    # O(q) time, O(1) space — q = 3 SQL statements
    for sql in (enrich._PARCEL_SQL, enrich._ZONING_SQL, enrich._POI_SQL):
        assert sql.count("city_id = %(city)s") == 2


# --- static plan + export ------------------------------------------------------------------------


def test_d3_static_plan_matches_frontend_contract():
    """Layer ids, tile-layer names and building props match the shared static contract."""
    # O(l) time, O(l) space — l = layers
    ids = {layer.layer_id for layer in STATIC_PLAN.layers}
    assert ids == {
        "buildings",
        "zoning",
        "parks",
        "railroads",
        "transit",
        "waterways",
        "pois",
        "major_streets",
        "zip_codes",
        "police_precincts",
        "neighborhoods",
    }
    # O(l) time, O(l) space — l = layers
    by_id = {layer.layer_id: layer for layer in STATIC_PLAN.layers}
    assert by_id["zoning"].tile_layers[0].name == "zoning_districts"
    # O(t) time, O(t) space — t = transit tile layers
    assert [t.name for t in by_id["transit"].tile_layers] == ["transit_lines", "transit_stations"]
    keep = by_id["buildings"].tile_layers[0].keep
    # O(k) time, O(1) space — k = required props
    for prop in ("id", "address", "zoning_code", "zone_class", "is_hidden", "has_interior"):
        assert prop in keep
    # O(b) time, O(1) space — b = boundary layers
    for boundary in ("zip_codes", "police_precincts", "neighborhoods"):
        assert by_id[boundary].geojson_copy
    assert "parcels" not in ids and "federal_properties" not in ids


def test_d3_static_export_size_budget():
    """public/data/dayton/ totals ≤ 120 MB (buildings ≤ 70 MB)."""
    if not (STATIC_DIR / "buildings.pmtiles").exists():
        pytest.skip("static export not built")
    # O(f) time, O(1) space — f = files in the folder
    total = sum(p.stat().st_size for p in STATIC_DIR.iterdir() if p.is_file())
    assert total <= 120 * 1024 * 1024
    assert (STATIC_DIR / "buildings.pmtiles").stat().st_size <= 70 * 1024 * 1024
    assert not (STATIC_DIR / "parcels.pmtiles").exists()


@pending
def test_d2_railroad_row_buffer_is_metric():
    """A 30 m buffer around an east–west track is ~30 m wide, not ~23 m."""


@pending
def test_d6_owner_batch_uses_dayton_oh():
    """A BatchItem with city=DAYTON, state=OH reaches Tracerfy as Dayton, not Chicago, IL."""
