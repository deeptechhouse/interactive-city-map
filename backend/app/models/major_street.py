"""Labelled arterial street line (Detroit: Woodward, Gratiot, Grand River, Michigan,
Jefferson, Fort, plus the Mile roads and freeways).

TRAP: like zip_codes, Chicago's `major_streets` table is hand-made with no migration.
Same IF NOT EXISTS rule as ZipCode. Column `name` is what MajorStreetsLayer.ts reads.

STATUS — SKELETON (2026-10-02). Deliberately NOT imported in models/__init__.py, so it is
not part of Base.metadata and cannot affect Chicago's schema, tests or Martin tiles until
plan Phase 1 imports it together with migration 005 (backend/alembic/drafts/).
"""

import uuid

from geoalchemy2 import Geometry
from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column

from app.database import Base


class MajorStreet(Base):
    __tablename__ = "major_streets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("LINESTRING", srid=4326), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)
