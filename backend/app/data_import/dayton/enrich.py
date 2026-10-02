"""Spatial joins for Dayton: buildings ← parcels (address, owner, year), buildings ← zoning.

WHY: City footprints (MapServer/307) carry no address, owner or year built. The fork's
    commit 8a2ac00 claims 335,825 enriched buildings, but only the popup that reads the
    data was committed, never the join. Here the join is code: idempotent and tested.

TWO BACKENDS, SAME RULE ("the polygon that contains the building's representative point")
    Static build (no database) — pure functions over importer rows:
        join_parcels(buildings, parcels)     address, parcel_pin, owner_name, year_built,
                                             land_use, property_class; floors if unknown
        tag_zoning(buildings, zoning)        zoning_code, zone_class (default "other")
        run_static(rows_by_layer, …)         both, in that order (STATIC_PLAN.enrich)
    PostGIS (dev mode) — one set-based UPDATE … FROM per join, filtered by city_id, using
        the GIST indexes: O(n log m) in the database, never a Python double loop.
        tag_buildings_with_parcels / tag_buildings_with_zoning / link_pois_to_buildings
        UNPROVEN: the SQL versions were not run against a database on 2026-10-02.

TRAP: representative_point(), not centroid(). An L-shaped building's centroid can fall in
    the neighbouring parcel; representative_point is guaranteed inside the footprint.
"""

from __future__ import annotations

import json
from collections.abc import Callable

import psycopg2
from shapely import STRtree
from shapely.geometry import shape

from app.data_import.static_build import tag_by_containment

# Parcel field → building field copied by join_parcels. `floors` is handled separately
# (the footprint's own NUMSTORIES wins when it is known).
PARCEL_TO_BUILDING: dict[str, str] = {
    "address": "address",
    "parcel_pin": "pin",
    "owner_name": "owner_name",
    "year_built": "year_built",
    "land_use": "land_use",
    "property_class": "property_class",
    "zip": "zip",
}


def join_parcels(buildings: list[dict], parcels: list[dict]) -> int:
    """O((n + m) log m) time, O(m) space — n = buildings; m = parcels (R-tree lookups).

    Copy parcel fields onto each building whose representative point is inside a parcel.
    Returns buildings tagged. Overlapping (condo/stacked) parcels: the first hit wins.
    """
    if not buildings or not parcels:
        return 0
    # O(m) time, O(m) space — m = parcels
    tree = STRtree([shape(json.loads(p["geom_json"])) for p in parcels])
    tagged = 0
    # O(n log m) time, O(1) space — n = buildings; m = parcels in the R-tree
    for building in buildings:
        point = shape(json.loads(building["geom_json"])).representative_point()
        hits = tree.query(point, predicate="within")
        if len(hits) == 0:
            continue
        parcel = parcels[int(hits[0])]
        # O(f) time, O(1) space — f = 7 copied fields
        for dst, src in PARCEL_TO_BUILDING.items():
            if parcel.get(src) is not None:
                building[dst] = parcel[src]
        if building.get("floors") is None:
            building["floors"] = parcel.get("floors")
        tagged += 1
    return tagged


def tag_zoning(buildings: list[dict], zoning: list[dict]) -> int:
    """O((n + m) log m) time, O(m) space — n = buildings; m = zoning polygons.

    Every building ends with zoning_code (None outside the city) and zone_class
    ("other" when untagged), so the frontend's zone_class filter never sees a missing key.
    """
    # O(n) time, O(1) space — n = buildings
    for building in buildings:
        building.setdefault("zoning_code", None)
        building["zone_class"] = "other"
    return tag_by_containment(
        buildings, zoning, {"zoning_code": "zone_code", "zone_class": "zone_class"}
    )


def run_static(
    rows: dict[str, list[dict]],
    load_parcels: Callable[[], list[dict]],
    load_zoning: Callable[[], list[dict]],
) -> dict[str, int]:
    """O((n + m) log m) time, O(m) space — n = buildings; m = parcels + zoning polygons.

    STATIC_PLAN.enrich body. Loaders are injected so tests pass rows directly and the
    static plan can fetch parcels (never shipped as a layer) or zoning (when the run was
    `--layers buildings`) from the importer cache.
    """
    buildings = rows.get("buildings")
    if not buildings:
        return {}
    zoning = rows.get("zoning_districts") or load_zoning()
    return {
        "parcels": join_parcels(buildings, load_parcels()),
        "zoning": tag_zoning(buildings, zoning),
    }


# ---------------------------------------------------------------------------
# PostGIS versions (dev mode). UNPROVEN — see module docstring.
# ---------------------------------------------------------------------------

_PARCEL_SQL = """
UPDATE buildings b
   SET parcel_pin = p.pin, address = COALESCE(b.address, p.address),
       owner_name = p.owner_name, property_class = p.property_class,
       metadata = COALESCE(b.metadata, '{}'::jsonb) || COALESCE(p.metadata, '{}'::jsonb)
  FROM parcels p
 WHERE b.city_id = %(city)s AND p.city_id = %(city)s
   AND ST_Within(ST_PointOnSurface(b.geom), p.geom)
"""

_ZONING_SQL = """
UPDATE buildings b
   SET zoning_code = z.zone_code, zoning_desc = z.zone_name
  FROM zoning_districts z
 WHERE b.city_id = %(city)s AND z.city_id = %(city)s
   AND ST_Within(ST_PointOnSurface(b.geom), z.geom)
"""

_POI_SQL = """
UPDATE pois p
   SET building_id = b.id
  FROM buildings b
 WHERE p.city_id = %(city)s AND b.city_id = %(city)s
   AND ST_Within(p.geom, b.geom)
"""


def _execute(db_url: str, city_id: str, sql: str) -> int:
    """O(n log m) time, O(1) space — n = rows updated; m = rows probed via the GIST index."""
    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        cur.execute(sql, {"city": city_id})
        updated = cur.rowcount
        conn.commit()
        cur.close()
        return updated
    finally:
        conn.close()


def tag_buildings_with_parcels(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = buildings; m = parcels (one GIST probe each)."""
    return _execute(db_url, city_id, _PARCEL_SQL)


def tag_buildings_with_zoning(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = buildings; m = zoning polygons."""
    return _execute(db_url, city_id, _ZONING_SQL)


def link_pois_to_buildings(db_url: str, city_id: str) -> int:
    """O(p log n) time, O(1) space — p = POIs; n = buildings.

    UNPROVEN: assumes pois.building_id exists (Chicago schema); check before running.
    """
    return _execute(db_url, city_id, _POI_SQL)


def run_all(db_url: str, city_id: str) -> dict[str, int]:
    """O(n log m) time, O(1) space — n = buildings; m = the largest joined table."""
    return {
        "parcels": tag_buildings_with_parcels(db_url, city_id),
        "zoning": tag_buildings_with_zoning(db_url, city_id),
        "pois": link_pois_to_buildings(db_url, city_id),
    }
