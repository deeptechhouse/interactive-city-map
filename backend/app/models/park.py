"""Park / green-space polygon.

WHY A NEW TABLE: Chicago parks live in the `parcels` table, and ParkLayer paints the
whole `parcels` source-layer green. Detroit's parcels table will hold ~378K real
parcels, so Detroit parks get their own table (and DetroitParkLayer reads it).

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


class Park(Base):
    __tablename__ = "parks"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    park_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)
