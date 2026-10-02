"""Migration 006 — buildings_lod(z, x, y): building tiles with level of detail for Martin.

PURPOSE
    Martin serves a TABLE source raw: every row in the tile, at every zoom. With 1.3 M
    buildings across three cities, one zoom-11 Chicago tile tried to carry ~300 K
    footprints — 6 MB+ and over 30 s, so the database-mode map showed 502s and no buildings
    (measured 2026-10-02). Static mode never had this problem because tippecanoe's
    --drop-densest-as-needed thins small footprints at low zoom.

    This FUNCTION source does the same thinning in PostGIS. Martin auto-publishes it
    (martin.yaml functions.from_schemas: public) and the frontend's buildings layer points
    at it in database mode (cities/*/layers.ts devSources: buildings → 'buildings_lod').
    The MVT layer inside is still named 'buildings', so every `source-layer: 'buildings'`
    style and popup works unchanged.

RULE
    z < 11   → empty (static Detroit/Dayton start at 11 too; z10 scanned every row, 6.7 s)
    z 11–13  → only footprints at least _MIN_PIXELS screen pixels wide or tall
    z ≥ 14   → every building
    Measured with 2.0 px: z11 69 KB / 1.2 s, z12 162 KB / 0.6 s, z13 124 KB / 0.4 s,
    z14 290 KB / 0.4 s (central Chicago, 2019 Intel Mac, Docker postgis 16-3.4).

ADJUSTABLE: _MIN_PIXELS — lower shows more small buildings when zoomed out but makes
    tiles heavier (0.5 px gave 2.5 MB / 5.5 s at z12); higher thins harder.

Revision ID: 006
Revises: 005
"""

from collections.abc import Sequence

from alembic import op

revision: str = "006"
down_revision: str | None = "005"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

_MIN_PIXELS = 2.0
_MIN_ZOOM = 11
_FULL_DETAIL_ZOOM = 14

# Properties carried into the tile: every map-facing building column. metadata /
# external_links (JSONB) and timestamps stay out — the popup fetches those from the API.
_FUNCTION_SQL = f"""
CREATE OR REPLACE FUNCTION buildings_lod(z integer, x integer, y integer)
RETURNS bytea LANGUAGE sql STABLE PARALLEL SAFE AS $$
  WITH env AS (
    SELECT ST_TileEnvelope(z, x, y) AS e3857,
           ST_Transform(ST_TileEnvelope(z, x, y), 4326) AS e4326,
           360.0 / (2 ^ z) / 256 * {_MIN_PIXELS} AS min_deg   -- footprint size kept, in degrees
  )
  SELECT ST_AsMVT(q, 'buildings', 4096, 'geom')
  FROM (
    SELECT b.id::text AS id, b.address, b.name, b.parcel_pin, b.zoning_code, b.zoning_desc,
           b.zone_class, b.year_built, b.floors, b.sq_ft, b.owner_name, b.owner_type,
           b.property_class, b.land_use, b.zip, b.has_interior, b.is_hidden,
           ST_AsMVTGeom(ST_Transform(b.geom, 3857), env.e3857, 4096, 64, true) AS geom
    FROM buildings b, env
    WHERE z >= {_MIN_ZOOM}
      AND b.geom && env.e4326
      AND (z >= {_FULL_DETAIL_ZOOM}
           OR ST_XMax(b.geom) - ST_XMin(b.geom) >= env.min_deg
           OR ST_YMax(b.geom) - ST_YMin(b.geom) >= env.min_deg)
  ) q
$$;
"""


def upgrade() -> None:
    """O(1) time, O(1) space — n = 1 function created."""
    op.execute(_FUNCTION_SQL)


def downgrade() -> None:
    """O(1) time, O(1) space — n = 1 function dropped."""
    op.execute("DROP FUNCTION IF EXISTS buildings_lod(integer, integer, integer)")
