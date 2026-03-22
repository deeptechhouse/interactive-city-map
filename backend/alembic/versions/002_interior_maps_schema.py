"""Add interior maps tables and extend floor_plans

Revision ID: 002
Revises: 001
Create Date: 2026-03-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "002"
down_revision = "001"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- floor_plans: add interior columns ----------
    op.add_column("floor_plans", sa.Column("confidence", sa.Float, server_default="0.0"))
    op.add_column("floor_plans", sa.Column("source_type", sa.Text))
    op.add_column("floor_plans", sa.Column("source_url", sa.Text))
    op.add_column("floor_plans", sa.Column("source_date", sa.Date))
    op.add_column("floor_plans", sa.Column("vectorized", sa.Boolean, server_default="false"))
    op.add_column("floor_plans", sa.Column("vector_quality", sa.Text))

    # ---------- interior_sources ----------
    op.create_table(
        "interior_sources",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("source_type", sa.Text, nullable=False),
        sa.Column("source_url", sa.Text),
        sa.Column("source_date", sa.Date),
        sa.Column("fetch_date", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("raw_data", JSONB),
        sa.Column("raster_url", sa.Text),
        sa.Column("geojson", JSONB),
        sa.Column("confidence", sa.Float, server_default="0.0"),
        sa.Column("status", sa.Text, server_default="'raw'"),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("CREATE INDEX idx_interior_sources_building ON interior_sources(building_id)")
    op.execute("CREATE INDEX idx_interior_sources_city ON interior_sources(city_id)")
    op.execute("CREATE INDEX idx_interior_sources_type ON interior_sources(source_type)")
    op.execute("CREATE INDEX idx_interior_sources_status ON interior_sources(status)")

    # ---------- interior_rooms ----------
    op.create_table(
        "interior_rooms",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("floor_plan_id", UUID(as_uuid=True), sa.ForeignKey("floor_plans.id")),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("interior_sources.id")),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("room_type", sa.Text),
        sa.Column("name", sa.Text),
        sa.Column("area_sqm", sa.Float),
        sa.Column("capacity", sa.Integer),
        sa.Column("metadata", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('interior_rooms', 'geom', 4326, 'POLYGON', 2)")
    op.execute("ALTER TABLE interior_rooms ALTER COLUMN geom SET NOT NULL")
    op.execute("CREATE INDEX idx_interior_rooms_building ON interior_rooms(building_id)")
    op.execute("CREATE INDEX idx_interior_rooms_geom ON interior_rooms USING GIST(geom)")
    op.execute("CREATE INDEX idx_interior_rooms_level ON interior_rooms(building_id, level)")

    # ---------- interior_walls ----------
    op.create_table(
        "interior_walls",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("floor_plan_id", UUID(as_uuid=True), sa.ForeignKey("floor_plans.id")),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("interior_sources.id")),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("wall_type", sa.Text, server_default="'interior'"),
        sa.Column("material", sa.Text),
        sa.Column("thickness_m", sa.Float),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('interior_walls', 'geom', 4326, 'LINESTRING', 2)")
    op.execute("ALTER TABLE interior_walls ALTER COLUMN geom SET NOT NULL")
    op.execute("CREATE INDEX idx_interior_walls_building ON interior_walls(building_id)")
    op.execute("CREATE INDEX idx_interior_walls_geom ON interior_walls USING GIST(geom)")

    # ---------- interior_features ----------
    op.create_table(
        "interior_features",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("floor_plan_id", UUID(as_uuid=True), sa.ForeignKey("floor_plans.id")),
        sa.Column("source_id", UUID(as_uuid=True), sa.ForeignKey("interior_sources.id")),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("feature_type", sa.Text, nullable=False),
        sa.Column("name", sa.Text),
        sa.Column("metadata", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('interior_features', 'geom', 4326, 'GEOMETRY', 2)")
    op.execute("ALTER TABLE interior_features ALTER COLUMN geom SET NOT NULL")
    op.execute("CREATE INDEX idx_interior_features_building ON interior_features(building_id)")
    op.execute("CREATE INDEX idx_interior_features_geom ON interior_features USING GIST(geom)")

    # ---------- scrape_targets ----------
    op.create_table(
        "scrape_targets",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id")),
        sa.Column("poi_id", UUID(as_uuid=True), sa.ForeignKey("pois.id")),
        sa.Column("url", sa.Text, nullable=False),
        sa.Column("status", sa.Text, server_default="'pending'"),
        sa.Column("last_attempt", sa.DateTime(timezone=True)),
        sa.Column("floor_plan_urls", sa.ARRAY(sa.Text)),
        sa.Column("metadata", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("CREATE INDEX idx_scrape_targets_status ON scrape_targets(status)")
    op.execute("CREATE INDEX idx_scrape_targets_building ON scrape_targets(building_id)")

    # ---------- Martin MVT function for interior rooms ----------
    op.execute("""
        CREATE OR REPLACE FUNCTION interior_rooms_mvt(z integer, x integer, y integer)
        RETURNS bytea AS $$
            SELECT ST_AsMVT(q, 'interior_rooms', 4096, 'geom')
            FROM (
                SELECT
                    r.id,
                    r.building_id,
                    r.level,
                    r.room_type,
                    r.name,
                    r.area_sqm,
                    r.capacity,
                    ST_AsMVTGeom(r.geom, ST_TileEnvelope(z, x, y), 4096, 256, true) AS geom
                FROM interior_rooms r
                WHERE r.geom && ST_TileEnvelope(z, x, y)
                  AND z >= 17
            ) q
        $$ LANGUAGE sql STABLE PARALLEL SAFE;

        COMMENT ON FUNCTION interior_rooms_mvt IS 'Vector tiles for interior room polygons, served at zoom >= 17';
    """)


def downgrade() -> None:
    op.execute("DROP FUNCTION IF EXISTS interior_rooms_mvt(integer, integer, integer)")
    op.drop_table("scrape_targets")
    op.drop_table("interior_features")
    op.drop_table("interior_walls")
    op.drop_table("interior_rooms")
    op.drop_table("interior_sources")
    op.drop_column("floor_plans", "vector_quality")
    op.drop_column("floor_plans", "vectorized")
    op.drop_column("floor_plans", "source_date")
    op.drop_column("floor_plans", "source_url")
    op.drop_column("floor_plans", "source_type")
    op.drop_column("floor_plans", "confidence")
