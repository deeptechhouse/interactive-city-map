"""Add blight violations table for Detroit abandoned/blight layer

Revision ID: 004
Revises: 003
Create Date: 2026-03-24
"""

from alembic import op
import sqlalchemy as sa
from sqlalchemy.dialects.postgresql import JSONB, UUID

revision = "004"
down_revision = "003"
branch_labels = None
depends_on = None


def upgrade() -> None:
    op.create_table(
        "blight_violations",
        sa.Column("id", UUID(as_uuid=True), primary_key=True, server_default=sa.text("gen_random_uuid()")),
        sa.Column("city_id", UUID(as_uuid=True), sa.ForeignKey("cities.id"), nullable=False),
        sa.Column("address", sa.Text, nullable=True),
        sa.Column("violation_code", sa.Text, nullable=True),
        sa.Column("violation_description", sa.Text, nullable=True),
        sa.Column("ticket_status", sa.Text, nullable=True),
        sa.Column("violation_date", sa.Text, nullable=True),
        sa.Column("source", sa.Text, nullable=True),
        sa.Column("metadata", JSONB, nullable=True),
    )
    op.execute(
        "SELECT AddGeometryColumn('blight_violations', 'geom', 4326, 'POINT', 2)"
    )
    op.create_index("ix_blight_violations_city_id", "blight_violations", ["city_id"])
    op.create_index("ix_blight_violations_geom", "blight_violations", ["geom"], postgresql_using="gist")
    op.create_index("ix_blight_violations_ticket_status", "blight_violations", ["ticket_status"])
    op.create_index("ix_blight_violations_source", "blight_violations", ["source"])


def downgrade() -> None:
    op.drop_table("blight_violations")
