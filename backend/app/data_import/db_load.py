"""Load a city's StaticPlan rows into PostGIS — how Detroit and Dayton reach DATABASE mode.

PURPOSE
    Static mode and database mode must show the same map. The static build already turns
    each city's importers into rows (static_build.collect_rows: download → transform →
    select → enrich joins). This module writes those SAME rows into the PostGIS tables
    Martin serves, so the two modes cannot drift: one importer per layer, two outputs.

    Tile-layer name == table name (static_build.py), so the frontend's `source-layer`
    is identical in both modes.

    Chicago is NOT loaded here — it has no StaticPlan; its rows came from run.py long ago
    and stay as they are. Every write below is scoped `WHERE city_id = <this city>`, so
    loading Detroit can never touch a Chicago row (city separation is the top priority).

FLOW
    load_plan(plan, sources, db_url, city_uuid)
      → collect_rows()                        rows keyed by tile-layer name (= table)
      → for each table that exists:  TableSchema.read()   columns + geometry type
      → one transaction:  DELETE this city's rows (reverse order, FK-safe)
                          INSERT rows_for_table() batches (execute_values)
      → table → rows written

ARCHITECTURE
    TableSchema          what a table can hold (read from information_schema) — data only
    stable_uuid()        pure: importer ids ("detroit-bldg-123") → deterministic UUIDs
    split_geometry()     pure: fit a geometry to its column (split Multi*, unpack collections)
    coerce()             pure: python value → what the column type accepts
    rows_for_table()     pure: rows → insert tuples (unit-tested without a database)
    load_plan()          orchestration + I/O

TRAPS
    * Martin publishes COLUMNS as tile properties. A row key with no column goes into
      `metadata` JSONB, which the map cannot read — if a map filter or popup needs a
      field, add the column in a migration (see alembic/versions/005).
    * Rows without geometry (Detroit `parcel_owners`, owner attributes only) are joined into
      buildings by the plan's enrich step; they are not a table and are skipped here.

TO ADD A CITY: give it a StaticPlan (app/data_import/<slug>/static_plan.py) and run
    `python -m scripts.load_city_db --city <slug>`.
"""

from __future__ import annotations

import json
import uuid
from collections.abc import Iterable, Iterator
from dataclasses import dataclass

import psycopg2
import structlog
from psycopg2.extras import Json, execute_values

from app.data_import.static_build import StaticPlan, collect_rows

logger = structlog.get_logger(__name__)

# Row keys that are pipeline plumbing, never stored as data.
_PLUMBING = frozenset({"city_id", "geom_json", "geom", "metadata", "id"})

# ADJUSTABLE: rows per INSERT statement. Larger is faster but holds more SQL text in
# memory; 2,000 keeps a 240K-building load around a minute on a 2019 Intel Mac.
BATCH_SIZE = 2000

# Fixed namespace so the same importer id always maps to the same UUID across reloads —
# building ids stay stable for saved contact lists and links. Never change this value.
_ID_NAMESPACE = uuid.UUID("6f1c2a52-6b3e-4c39-9a8e-0d6a1b8f7c11")


@dataclass(frozen=True)
class TableSchema:
    """Columns (name → information_schema data_type) and the geometry type of `geom`."""

    name: str
    columns: dict[str, str]
    geom_type: str  # e.g. "MULTIPOLYGON", "POLYGON", "GEOMETRY"

    @property
    def is_multi(self) -> bool:
        """O(1) time, O(1) space — n = 1 type name."""
        return self.geom_type.startswith("MULTI")

    @property
    def is_single_part(self) -> bool:
        """POINT / LINESTRING / POLYGON columns reject Multi* values. O(1) time, O(1) space."""
        return self.geom_type in ("POINT", "LINESTRING", "POLYGON")

    @staticmethod
    def read(cur, table: str) -> TableSchema | None:
        """O(c) time, O(c) space — c = columns. None when the table doesn't exist."""
        cur.execute(
            "SELECT column_name, data_type FROM information_schema.columns "
            "WHERE table_schema = 'public' AND table_name = %s",
            (table,),
        )
        # O(c) time, O(c) space — c = columns
        columns = {name: dtype for name, dtype in cur.fetchall()}
        if not columns:
            return None
        cur.execute(
            "SELECT type FROM geometry_columns "
            "WHERE f_table_schema = 'public' AND f_table_name = %s AND f_geometry_column = 'geom'",
            (table,),
        )
        found = cur.fetchone()
        return TableSchema(table, columns, found[0].upper() if found else "GEOMETRY")


def stable_uuid(slug: str, table: str, raw_id: object) -> str:
    """O(k) time, O(k) space — k = id length.

    Keep a real UUID as-is; turn anything else ("detroit-bldg-123", 42) into a UUID that
    is the same on every reload, so building ids in saved lists keep working.
    """
    text = str(raw_id)
    try:
        return str(uuid.UUID(text))
    except ValueError:
        return str(uuid.uuid5(_ID_NAMESPACE, f"{slug}/{table}/{text}"))


def _leaves(geom: dict) -> list[dict]:
    """O(p) time, O(p) space — p = single-part pieces inside the geometry.

    Flatten Multi* and GeometryCollection into single-part pieces (Point, LineString, Polygon).
    """
    kind = geom.get("type", "")
    if kind == "GeometryCollection":
        out: list[dict] = []
        # O(p) time, O(p) space — p = pieces across the collection's members
        for member in geom.get("geometries", []):
            out.extend(_leaves(member))
        return out
    if kind.startswith("Multi"):
        # O(p) time, O(p) space — p = parts
        return [
            {"type": kind[len("Multi") :], "coordinates": c} for c in geom.get("coordinates", [])
        ]
    return [geom]


def split_geometry(geom: dict, column_type: str) -> list[dict]:
    """O(p) time, O(p) space — p = pieces in the geometry.

    Shape a geometry to fit its column (TableSchema.geom_type):
      * POINT / LINESTRING / POLYGON → one value per matching piece (a MultiPolygon becomes
        its polygons);
      * MULTI* → one Multi value from the matching pieces (ST_Multi promotes the rest);
      * GEOMETRY → unchanged.
    Pieces of the wrong kind are dropped: clipping a street to the city edge can leave a
    GeometryCollection holding a stray Point (Dayton major_streets, 2026-10-02), and
    PostGIS rejects the whole batch for one such value.
    """
    if column_type == "GEOMETRY":
        return [geom]
    base = column_type.removeprefix("MULTI").title().replace("string", "String")
    if (
        not geom.get("type", "").startswith(("Multi", "GeometryCollection"))
        and geom.get("type") == base
    ):
        return [geom]
    # O(p) time, O(p) space — p = pieces
    pieces = [g for g in _leaves(geom) if g.get("type") == base]
    if column_type.startswith("MULTI"):
        # O(p) time, O(p) space — p = matching pieces
        return (
            [{"type": f"Multi{base}", "coordinates": [g["coordinates"] for g in pieces]}]
            if pieces
            else []
        )
    return pieces


def coerce(value: object, data_type: str) -> object:
    """O(v) time, O(v) space — v = size of the value (JSON-encoding a list/dict).

    Make an importer value fit its column. Unparseable numbers become NULL rather than
    failing the whole city — a missing year_built is better than no Detroit map.
    """
    if value is None:
        return None
    if data_type in ("integer", "bigint", "smallint"):
        try:
            return int(float(value))  # "1925" and 1925.0 both arrive from ArcGIS
        except (TypeError, ValueError):
            return None
    if data_type in ("double precision", "real", "numeric"):
        try:
            return float(value)
        except (TypeError, ValueError):
            return None
    if data_type == "boolean":
        if isinstance(value, str):
            return value.strip().lower() in ("true", "t", "yes", "y", "1")
        return bool(value)
    if data_type == "jsonb":
        return Json(value)
    if data_type == "ARRAY":
        if isinstance(value, str):
            try:
                parsed = json.loads(value)
                return parsed if isinstance(parsed, list) else [value]
            except ValueError:
                return [value]
        return list(value) if isinstance(value, list | tuple) else [value]
    if isinstance(value, list | dict):
        return json.dumps(value)
    return str(value) if not isinstance(value, str) else value


def rows_for_table(
    rows: Iterable[dict], schema: TableSchema, slug: str, city_uuid: str
) -> tuple[list[str], Iterator[tuple]]:
    """O(S) time, O(r) space — S = values across all rows; r = rows (ids issued so far).

    → (insert column order, iterator of value tuples). Geometry is the last value, as
    GeoJSON text. Keys with no column go into `metadata` (when the table has one).
    """
    # O(c) time, O(c) space — c = columns
    data_cols = [c for c in schema.columns if c not in _PLUMBING and c != "search_vector"]
    has_meta = "metadata" in schema.columns
    insert_cols = ["id", "city_id", *data_cols, *(["metadata"] if has_meta else []), "geom"]

    # Ids already issued in this table. Some sources repeat an id (Detroit's precinct
    # layer has several polygons per precinct, all "precinct-3"), and a repeat would break
    # the primary key and roll back the whole city — the 2nd copy gets a "~2" suffix.
    seen: dict[str, int] = {}

    # O(S) time, O(r) space — S = values across all rows; r = rows (the seen-id map)
    def generate() -> Iterator[tuple]:
        # O(S) time, O(p) space — S = values across all rows; p = values in one row
        for row in rows:
            raw = row.get("geom_json")
            if not raw:
                continue  # owner-only rows etc. — joined by enrich, not a table
            geom = json.loads(raw) if isinstance(raw, str) else raw
            # bigo-lint: disable=BIGO006 — amortised: each row key is visited once overall (S)
            # O(p) time, O(p) space — p = keys on this row
            extra = {
                k: v
                for k, v in row.items()
                if k not in schema.columns and k not in _PLUMBING and v is not None
            }
            # bigo-lint: disable=BIGO006 — amortised: one pass over this row's columns (S)
            # O(c) time, O(c) space — c = data columns
            values = [coerce(row.get(c), schema.columns[c]) for c in data_cols]
            parts = split_geometry(geom, schema.geom_type)
            base_id = row.get("id") or json.dumps(geom)[:200]
            # bigo-lint: disable=BIGO006 — amortised: parts of one geometry are part of S
            # O(q) time, O(q) space — q = parts of this geometry (usually 1)
            for i, part in enumerate(parts):
                part_id = base_id if len(parts) == 1 else f"{base_id}#{i}"
                seen[part_id] = seen.get(part_id, 0) + 1
                if seen[part_id] > 1:
                    part_id = f"{part_id}~{seen[part_id]}"
                meta = [Json({**extra, "source_id": str(row.get("id", ""))})] if has_meta else []
                yield (
                    stable_uuid(slug, schema.name, part_id),
                    city_uuid,
                    *values,
                    *meta,
                    json.dumps(part),
                )

    return insert_cols, generate()


def _geom_sql(schema: TableSchema) -> str:
    """O(1) time, O(1) space — n = 1 SQL fragment for the geometry value."""
    base = "ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326)"
    return f"ST_Multi({base})" if schema.is_multi else base


def _insert(cur, schema: TableSchema, columns: list[str], values: Iterator[tuple]) -> int:
    """O(n) time, O(B) space — n = rows; B = BATCH_SIZE rows held at once."""
    placeholders = ", ".join(["%s"] * (len(columns) - 1) + [_geom_sql(schema)])
    sql = f"INSERT INTO {schema.name} ({', '.join(columns)}) VALUES %s"
    template = f"({placeholders})"
    written = 0
    batch: list[tuple] = []
    # O(n) time, O(B) space — n = rows streamed; B = batch size
    for value in values:
        batch.append(value)
        if len(batch) >= BATCH_SIZE:
            execute_values(cur, sql, batch, template=template, page_size=BATCH_SIZE)
            written += len(batch)
            batch = []
    if batch:
        execute_values(cur, sql, batch, template=template, page_size=BATCH_SIZE)
        written += len(batch)
    return written


def load_plan(
    plan: StaticPlan,
    sources: dict,
    db_url: str,
    city_uuid: str,
    only: set[str] | None = None,
) -> dict[str, int]:
    """O(N) time, O(N) space — N = rows across the plan (held once by collect_rows); B = BATCH_SIZE.

    Replace this city's rows in every table the plan feeds (or the `only` layer ids) in ONE
    transaction: a failure leaves the database exactly as it was. Returns table → rows.
    """
    _, rows = collect_rows(plan, sources, only)
    conn = psycopg2.connect(db_url)
    written: dict[str, int] = {}
    try:
        with conn, conn.cursor() as cur:
            schemas: dict[str, TableSchema] = {}
            # O(t) time, O(t) space — t = tile layers collected
            for table in rows:
                schema = TableSchema.read(cur, table)
                if schema is None:
                    logger.info("db_load_no_table", city=plan.slug, table=table)
                    continue
                schemas[table] = schema
            # Delete in reverse so children (transit_stations → transit_lines) go first.
            # O(t) time, O(1) space — t = tables (each DELETE is server-side)
            for table in reversed(list(schemas)):
                cur.execute(f"DELETE FROM {table} WHERE city_id = %s", (city_uuid,))
                logger.info("db_load_cleared", city=plan.slug, table=table, rows=cur.rowcount)
            # O(N) time, O(B) space — N = rows across tables; B = BATCH_SIZE rows per insert
            for table, schema in schemas.items():
                columns, values = rows_for_table(rows[table], schema, plan.slug, city_uuid)
                written[table] = _insert(cur, schema, columns, values)
                logger.info("db_load_written", city=plan.slug, table=table, rows=written[table])
    finally:
        conn.close()
    return written
