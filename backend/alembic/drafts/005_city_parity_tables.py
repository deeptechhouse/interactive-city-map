"""DRAFT migration 005 — tables Detroit needs for Chicago parity.

STATUS — SKELETON. Lives in alembic/drafts/, which Alembic does NOT scan, so
`alembic upgrade head` is unaffected. Phase 1 moves it to alembic/versions/ after the
pre-flight check below.

PRE-FLIGHT (do this first — the 2am trap): `zip_codes` and `major_streets` already exist
in the Chicago dev database but were created by hand (no migration). Run `\\d zip_codes`
and `\\d major_streets`. If their columns differ from the models, change this migration
to ALTER the existing table. Never DROP: the Chicago rows (59 zips, 25 streets) were
entered by hand and may not be reproducible.

Tables: council_districts, police_precincts, zip_codes*, major_streets*, parks,
business_licenses   (* = IF NOT EXISTS, formalising Chicago's hand-made tables)

Martin auto-publishes every public table (martin.yaml auto_publish), so these become
tile sources with no Martin config change.

Revision ID: 005
Revises: 004
"""

from collections.abc import Sequence

revision: str = "005"
down_revision: str | None = "004"
branch_labels: str | Sequence[str] | None = None
depends_on: str | Sequence[str] | None = None

# O(1) time, O(1) space — t = 6 tables, a fixed list.
_POLYGON_TABLES = {
    "council_districts": "district_number TEXT NOT NULL, council_member TEXT",
    "police_precincts": "precinct TEXT NOT NULL, name TEXT",
    "zip_codes": "zip_code TEXT NOT NULL",
    "parks": "name TEXT, park_type TEXT",
}


def upgrade() -> None:
    """O(t) time, O(1) space — t = tables created (6).

    Each table: id uuid PK, city_id FK cities, geom (SRID 4326), metadata JSONB,
    GIST index on geom, btree index on city_id. major_streets is LINESTRING,
    business_licenses is POINT with a nullable building_id FK.
    """
    raise NotImplementedError("draft — see module docstring")


def downgrade() -> None:
    """O(t) time, O(1) space — t = tables. Drops only tables this migration CREATED.

    zip_codes / major_streets pre-date it in the Chicago DB, so downgrade must leave them.
    """
    raise NotImplementedError("draft — see module docstring")
