"""db_load: StaticPlan rows → PostGIS insert tuples. Pure parts only — no database."""

import json

import pytest
from psycopg2.extras import Json

from app.data_import.db_load import TableSchema, coerce, rows_for_table, split_geometry, stable_uuid

CITY = "11111111-1111-1111-1111-111111111111"

POLY = {"type": "Polygon", "coordinates": [[[0, 0], [1, 0], [1, 1], [0, 0]]]}


def _schema(geom_type="POLYGON", **cols):
    base = {"id": "uuid", "city_id": "uuid", "geom": "USER-DEFINED", "metadata": "jsonb"}
    return TableSchema("buildings", {**base, **cols}, geom_type)


def test_stable_uuid_keeps_real_uuids_and_maps_others_deterministically():
    real = "8125cc81-0000-4000-8000-000000000000"
    assert stable_uuid("detroit", "buildings", real) == real
    a = stable_uuid("detroit", "buildings", "bldg-1")
    assert a == stable_uuid("detroit", "buildings", "bldg-1")  # same on every reload
    assert a != stable_uuid("dayton", "buildings", "bldg-1")  # never collides across cities


def test_split_geometry_fits_each_column_type():
    multi = {"type": "MultiPolygon", "coordinates": [POLY["coordinates"], POLY["coordinates"]]}
    assert len(split_geometry(multi, "POLYGON")) == 2
    assert split_geometry(multi, "MULTIPOLYGON") == [multi]
    assert split_geometry(POLY, "MULTIPOLYGON") == [POLY]  # ST_Multi promotes it in SQL
    assert split_geometry(multi, "GEOMETRY") == [multi]
    # Dayton major_streets 2026-10-02: a clipped street left a stray Point in a collection.
    gc = {
        "type": "GeometryCollection",
        "geometries": [
            {"type": "Point", "coordinates": [0, 0]},
            {"type": "LineString", "coordinates": [[0, 0], [1, 1]]},
        ],
    }
    assert split_geometry(gc, "LINESTRING") == [gc["geometries"][1]]
    assert split_geometry({"type": "Point", "coordinates": [0, 0]}, "MULTILINESTRING") == []


@pytest.mark.parametrize(
    ("value", "dtype", "expected"),
    [
        ("1925", "integer", 1925),
        (3.0, "integer", 3),
        ("n/a", "integer", None),
        ("yes", "boolean", True),
        (0, "boolean", False),
        ('["Red", "Blue"]', "ARRAY", ["Red", "Blue"]),
        ("Red", "ARRAY", ["Red"]),
        ({"a": 1}, "text", '{"a": 1}'),
        (42, "text", "42"),
        (None, "text", None),
    ],
)
def test_coerce(value, dtype, expected):
    assert coerce(value, dtype) == expected


def test_rows_for_table_maps_columns_metadata_city_and_skips_geometryless_rows():
    schema = _schema(address="text", year_built="integer", zone_class="text")
    rows = [
        {
            "id": "b1",
            "city_id": "detroit",
            "address": "1 Main",
            "year_built": "1910",
            "zone_class": "residential",
            "source_only": "x",
            "geom_json": json.dumps(POLY),
        },
        {"parcel_pin": "123", "owner_name": "OWNER"},  # owner-only row: not a table row
    ]
    columns, values = rows_for_table(rows, schema, "detroit", CITY)
    out = list(values)
    assert columns == ["id", "city_id", "address", "year_built", "zone_class", "metadata", "geom"]
    assert len(out) == 1
    row = out[0]
    assert row[1] == CITY  # the real cities.id, never the slug the importer was built with
    assert row[2:5] == ("1 Main", 1910, "residential")
    assert isinstance(row[5], Json) and row[5].adapted == {"source_only": "x", "source_id": "b1"}
    assert json.loads(row[6]) == POLY


def test_rows_for_table_makes_repeated_ids_unique():
    """Detroit precincts repeat an id across polygons — a repeat would roll back the city."""
    schema = TableSchema(
        "police_precincts", {"id": "uuid", "city_id": "uuid", "precinct": "text"}, "MULTIPOLYGON"
    )
    rows = [{"id": "p3", "precinct": "3", "geom_json": json.dumps(POLY)}] * 3
    _, values = rows_for_table(rows, schema, "detroit", CITY)
    ids = [v[0] for v in values]
    assert len(set(ids)) == 3


def test_load_city_db_refuses_chicago(capsys):
    from scripts.load_city_db import main

    assert main(["--city", "chicago"]) == 2
    assert "refusing" in capsys.readouterr().err
