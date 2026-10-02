"""Migration 005 — the tables and columns Detroit and Dayton need in DATABASE mode.

PURPOSE
    Static mode builds every city's tiles straight from the importers. Database mode
    serves the same layers from PostGIS through Martin, which publishes each public table
    as a tile source whose properties are the table's COLUMNS. So every property a city's
    map reads (zone_class on buildings, precinct on police_precincts, …) must be a real
    column here — a value tucked into `metadata` JSONB never reaches the map.

    Tile-layer names in the static build == table names here (static_build.py), so the
    frontend reads the same `source-layer` in both modes.

WHAT IT DOES
    * CREATE council_districts, police_precincts, parks (models in app/models/).
    * CREATE IF NOT EXISTS zip_codes, major_streets — the Chicago dev database already has
      both, created by hand with no migration (59 zips, 25 streets entered by hand).
      Never dropped or rewritten: those rows may not be reproducible.
    * ADD COLUMN IF NOT EXISTS for city-specific properties on shared tables
      (_ADDED_COLUMNS). All nullable: Chicago rows simply have NULL, and Martin leaves a
      NULL property out of the tile, so BuildingLayer's ['has', 'zone_class'] test stays
      false for Chicago exactly as before.

    NOT touched: business_licenses. The Chicago dev DB has a hand-made table with an
    integer id and no city_id (50,000 rows); no Detroit/Dayton layer writes it yet. Its
    reconciliation with app/models/business_license.py is left for when one does.

Revision ID: 005
Revises: 004
"""

from collections.abc import Sequence

from alembic import op

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# Tables this migration owns: name → (geometry type, extra columns). Every table also
# gets id uuid PK, city_id FK cities, geom (SRID 4326), metadata JSONB, GIST + city index.
_NEW_TABLES: dict[str, tuple[str, str]] = {
    "council_districts": (
        "MULTIPOLYGON",
        "district_number TEXT NOT NULL, council_member TEXT, name TEXT",
    ),
    "police_precincts": ("MULTIPOLYGON", "precinct TEXT NOT NULL, name TEXT"),
    "parks": ("MULTIPOLYGON", "name TEXT, park_type TEXT"),
}

# Hand-made in the Chicago DB; created only on a fresh database.
_FORMALISED_TABLES: dict[str, tuple[str, str]] = {
    "zip_codes": ("MULTIPOLYGON", "zip_code TEXT NOT NULL"),
    "major_streets": ("LINESTRING", "name TEXT NOT NULL"),
}

# Shared tables → columns a Detroit/Dayton layer reads (from the cities' static plans).
_ADDED_COLUMNS: dict[str, tuple[str, ...]] = {
    "buildings": ("zone_class TEXT", "land_use TEXT", "zip TEXT"),
    "zoning_districts": ("legacy_code TEXT",),
    "railroads": ("operator TEXT", "ownership_type TEXT"),
    "transit_lines": ("line_name TEXT",),
    "neighborhoods": ("priority_board TEXT",),
    "zip_codes": ("metadata JSONB",),
    "major_streets": ("metadata JSONB",),
}


def _create_table_sql(name: str, geom_type: str, columns: str, if_not_exists: bool) -> str:
    """O(1) time, O(1) space — n = 1 statement built from fixed strings (no user input)."""
    guard = "IF NOT EXISTS " if if_not_exists else ""
    return f"""
        CREATE TABLE {guard}{name} (
            id uuid PRIMARY KEY DEFAULT gen_random_uuid(),
            city_id uuid NOT NULL REFERENCES cities(id),
            {columns},
            metadata JSONB,
            geom geometry({geom_type}, 4326) NOT NULL
        );
        CREATE INDEX IF NOT EXISTS ix_{name}_geom ON {name} USING gist (geom);
        CREATE INDEX IF NOT EXISTS ix_{name}_city_id ON {name} (city_id);
    """


def upgrade() -> None:
    """O(t + c) time, O(1) space — t = tables (5); c = added columns (11)."""
    # O(t) time, O(1) space — t = new tables (3)
    for name, (geom_type, columns) in _NEW_TABLES.items():
        op.execute(_create_table_sql(name, geom_type, columns, if_not_exists=False))
    # O(t) time, O(1) space — t = formalised tables (2)
    for name, (geom_type, columns) in _FORMALISED_TABLES.items():
        op.execute(_create_table_sql(name, geom_type, columns, if_not_exists=True))
    # O(c) time, O(1) space — c = added columns across tables (11)
    for table, columns in _ADDED_COLUMNS.items():
        # bigo-lint: disable=BIGO006 — amortised: each added column is visited once overall (c)
        # O(k) time, O(k) space — k = columns for this table (1–3)
        clauses = ", ".join(f"ADD COLUMN IF NOT EXISTS {c}" for c in columns)
        op.execute(f"ALTER TABLE {table} {clauses}")


def downgrade() -> None:
    """O(t + c) time, O(1) space — t = tables; c = columns.

    Drops only what this migration CREATED. zip_codes / major_streets pre-date it in the
    Chicago DB, so they stay; so do the city-specific columns' Chicago NULLs (dropping a
    column is cheap but would delete Detroit/Dayton values — run the importers again after
    re-upgrading).
    """
    # O(t) time, O(1) space — t = new tables (3)
    for name in _NEW_TABLES:
        op.execute(f"DROP TABLE IF EXISTS {name}")
    # O(c) time, O(1) space — c = added columns
    for table, columns in _ADDED_COLUMNS.items():
        if table in _FORMALISED_TABLES:
            continue
        # bigo-lint: disable=BIGO006 — amortised: each added column is visited once overall (c)
        # O(k) time, O(k) space — k = columns for this table (1–3)
        clauses = ", ".join(f"DROP COLUMN IF EXISTS {c.split()[0]}" for c in columns)
        op.execute(f"ALTER TABLE {table} {clauses}")
