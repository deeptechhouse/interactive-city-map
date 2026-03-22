"""Initial schema with all tables

Revision ID: 001
Revises:
Create Date: 2026-03-22
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "001"
down_revision = None
branch_labels = None
depends_on = None


def upgrade() -> None:
    # Ensure extensions
    op.execute("CREATE EXTENSION IF NOT EXISTS postgis")
    op.execute("CREATE EXTENSION IF NOT EXISTS pg_trgm")
    op.execute("CREATE EXTENSION IF NOT EXISTS unaccent")

    # ---------- cities ----------
    op.create_table(
        "cities",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("slug", sa.Text, unique=True, nullable=False),
        sa.Column("state", sa.Text, nullable=False),
        sa.Column("default_zoom", sa.Integer, server_default="12"),
        sa.Column("layer_config", JSONB),
        sa.Column("data_sources", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('cities', 'bounds', 4326, 'POLYGON', 2)")
    op.execute("SELECT AddGeometryColumn('cities', 'center', 4326, 'POINT', 2)")

    # ---------- parcels ----------
    op.create_table(
        "parcels",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("pin", sa.Text, nullable=False),
        sa.Column("address", sa.Text),
        sa.Column("owner_name", sa.Text),
        sa.Column("assessed_value", sa.Numeric),
        sa.Column("property_class", sa.Text),
        sa.Column("land_use", sa.Text),
        sa.Column("metadata", JSONB),
    )
    op.execute("SELECT AddGeometryColumn('parcels', 'geom', 4326, 'MULTIPOLYGON', 2)")
    op.execute("CREATE INDEX idx_parcels_geom ON parcels USING GIST(geom)")
    op.execute("CREATE UNIQUE INDEX idx_parcels_city_pin ON parcels(city_id, pin)")

    # ---------- buildings ----------
    op.create_table(
        "buildings",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("parcel_pin", sa.Text),
        sa.Column("address", sa.Text),
        sa.Column("name", sa.Text),
        sa.Column("zoning_code", sa.Text),
        sa.Column("zoning_desc", sa.Text),
        sa.Column("year_built", sa.Integer),
        sa.Column("floors", sa.Integer),
        sa.Column("sq_ft", sa.Integer),
        sa.Column("owner_name", sa.Text),
        sa.Column("owner_type", sa.Text),
        sa.Column("property_class", sa.Text),
        sa.Column("has_interior", sa.Boolean, server_default="false"),
        sa.Column("is_hidden", sa.Boolean, server_default="false"),
        sa.Column("external_links", JSONB),
        sa.Column("metadata", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('buildings', 'geom', 4326, 'POLYGON', 2)")
    op.execute("CREATE INDEX idx_buildings_geom ON buildings USING GIST(geom)")
    op.execute("CREATE INDEX idx_buildings_city ON buildings(city_id)")
    op.execute("CREATE INDEX idx_buildings_zoning ON buildings(zoning_code)")
    op.execute("CREATE INDEX idx_buildings_owner_type ON buildings(owner_type)")
    op.execute("CREATE INDEX idx_buildings_not_hidden ON buildings(is_hidden) WHERE is_hidden = false")

    # ---------- railroads ----------
    op.create_table(
        "railroads",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("name", sa.Text),
        sa.Column("owner", sa.Text),
        sa.Column("status", sa.Text, nullable=False),
        sa.Column("track_class", sa.Text),
        sa.Column("trackage_rights", sa.ARRAY(sa.Text)),
        sa.Column("source", sa.Text),
        sa.Column("metadata", JSONB),
    )
    op.execute("SELECT AddGeometryColumn('railroads', 'geom', 4326, 'MULTILINESTRING', 2)")
    op.execute("CREATE INDEX idx_railroads_geom ON railroads USING GIST(geom)")
    op.execute("CREATE INDEX idx_railroads_city ON railroads(city_id)")
    op.execute("CREATE INDEX idx_railroads_status ON railroads(status)")
    op.execute("CREATE INDEX idx_railroads_owner ON railroads(owner)")

    # ---------- zoning_districts ----------
    op.create_table(
        "zoning_districts",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("zone_code", sa.Text, nullable=False),
        sa.Column("zone_class", sa.Text, nullable=False),
        sa.Column("zone_name", sa.Text),
        sa.Column("description", sa.Text),
        sa.Column("ordinance_ref", sa.Text),
        sa.Column("metadata", JSONB),
    )
    op.execute("SELECT AddGeometryColumn('zoning_districts', 'geom', 4326, 'MULTIPOLYGON', 2)")
    op.execute("CREATE INDEX idx_zoning_geom ON zoning_districts USING GIST(geom)")
    op.execute("CREATE INDEX idx_zoning_city ON zoning_districts(city_id)")
    op.execute("CREATE INDEX idx_zoning_class ON zoning_districts(zone_class)")

    # ---------- pois ----------
    op.create_table(
        "pois",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id")),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("category", sa.Text, nullable=False),
        sa.Column("subcategory", sa.Text),
        sa.Column("address", sa.Text),
        sa.Column("phone", sa.Text),
        sa.Column("website", sa.Text),
        sa.Column("hours", JSONB),
        sa.Column("description", sa.Text),
        sa.Column("event_facilities", sa.ARRAY(sa.Text)),
        sa.Column("unit_count", sa.Integer),
        sa.Column("source", sa.Text),
        sa.Column("source_id", sa.Text),
        sa.Column("verified", sa.Boolean, server_default="false"),
        sa.Column("metadata", JSONB),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('pois', 'geom', 4326, 'POINT', 2)")
    op.execute("CREATE INDEX idx_pois_geom ON pois USING GIST(geom)")
    op.execute("CREATE INDEX idx_pois_city ON pois(city_id)")
    op.execute("CREATE INDEX idx_pois_category ON pois(category)")
    op.execute("CREATE INDEX idx_pois_building ON pois(building_id)")
    # Full-text search
    op.execute("""
        ALTER TABLE pois ADD COLUMN search_vector tsvector
        GENERATED ALWAYS AS (
            to_tsvector('english', coalesce(name, '') || ' ' || coalesce(address, '') || ' ' || coalesce(description, ''))
        ) STORED
    """)
    op.execute("CREATE INDEX idx_pois_search ON pois USING GIN(search_vector)")

    # ---------- transit_lines ----------
    op.create_table(
        "transit_lines",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("color", sa.Text),
        sa.Column("system", sa.Text),
        sa.Column("line_type", sa.Text),
        sa.Column("metadata", JSONB),
    )
    op.execute("SELECT AddGeometryColumn('transit_lines', 'geom', 4326, 'MULTILINESTRING', 2)")
    op.execute("CREATE INDEX idx_transit_lines_geom ON transit_lines USING GIST(geom)")
    op.execute("CREATE INDEX idx_transit_lines_city ON transit_lines(city_id)")

    # ---------- transit_stations ----------
    op.create_table(
        "transit_stations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("line_id", UUID(as_uuid=True), sa.ForeignKey("transit_lines.id")),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("lines_served", sa.ARRAY(sa.Text)),
        sa.Column("accessible", sa.Boolean),
        sa.Column("metadata", JSONB),
    )
    op.execute("SELECT AddGeometryColumn('transit_stations', 'geom', 4326, 'POINT', 2)")
    op.execute("CREATE INDEX idx_transit_stations_geom ON transit_stations USING GIST(geom)")
    op.execute("CREATE INDEX idx_transit_stations_city ON transit_stations(city_id)")

    # ---------- waterways ----------
    op.create_table(
        "waterways",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("name", sa.Text),
        sa.Column("waterway_type", sa.Text),
        sa.Column("metadata", JSONB),
    )
    op.execute("SELECT AddGeometryColumn('waterways', 'geom', 4326, 'GEOMETRY', 2)")
    op.execute("CREATE INDEX idx_waterways_geom ON waterways USING GIST(geom)")
    op.execute("CREATE INDEX idx_waterways_city ON waterways(city_id)")

    # ---------- floor_plans ----------
    op.create_table(
        "floor_plans",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("building_id", UUID(as_uuid=True), sa.ForeignKey("buildings.id"), nullable=False),
        sa.Column("level", sa.Integer, nullable=False),
        sa.Column("level_name", sa.Text),
        sa.Column("geojson", JSONB),
        sa.Column("raster_url", sa.Text),
        sa.Column("source", sa.Text),
        sa.Column("created_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
        sa.Column("updated_at", sa.DateTime(timezone=True), server_default=sa.text("now()")),
    )
    op.execute("SELECT AddGeometryColumn('floor_plans', 'raster_bounds', 4326, 'POLYGON', 2)")
    op.execute("CREATE UNIQUE INDEX idx_floor_plans_building_level ON floor_plans(building_id, level)")


def downgrade() -> None:
    op.drop_table("floor_plans")
    op.drop_table("waterways")
    op.drop_table("transit_stations")
    op.drop_table("transit_lines")
    op.drop_table("pois")
    op.drop_table("zoning_districts")
    op.drop_table("railroads")
    op.drop_table("buildings")
    op.drop_table("parcels")
    op.drop_table("cities")
