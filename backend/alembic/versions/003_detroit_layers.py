"""Add neighborhoods and DLBA properties tables for Detroit

Revision ID: 003
Revises: 002
Create Date: 2026-03-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "003"
down_revision = "002"
branch_labels = None
depends_on = None


def upgrade() -> None:
    # ---------- neighborhoods ----------
    op.create_table(
        "neighborhoods",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("name", sa.Text, nullable=False),
        sa.Column("council_district", sa.Text, nullable=True),
        sa.Column("website", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
    )
    op.execute(
        "SELECT AddGeometryColumn('neighborhoods', 'geom', 4326, 'MULTIPOLYGON', 2)"
    )
    op.create_index("ix_neighborhoods_city_id", "neighborhoods", ["city_id"])
    op.create_index("ix_neighborhoods_geom", "neighborhoods", ["geom"], postgresql_using="gist")
    op.create_index("ix_neighborhoods_name", "neighborhoods", ["name"])

    # ---------- dlba_properties ----------
    op.create_table(
        "dlba_properties",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("status", sa.Text, nullable=True),
        sa.Column("property_type", sa.Text, nullable=True),
        sa.Column("neighborhood", sa.Text, nullable=True),
        sa.Column("council_district", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
    )
    op.execute(
        "SELECT AddGeometryColumn('dlba_properties', 'geom', 4326, 'GEOMETRY', 2)"
    )
    op.create_index("ix_dlba_properties_city_id", "dlba_properties", ["city_id"])
    op.create_index("ix_dlba_properties_geom", "dlba_properties", ["geom"], postgresql_using="gist")
    op.create_index("ix_dlba_properties_status", "dlba_properties", ["status"])
    op.create_index("ix_dlba_properties_neighborhood", "dlba_properties", ["neighborhood"])


def downgrade() -> None:
    op.drop_table("dlba_properties")
    op.drop_table("neighborhoods")
