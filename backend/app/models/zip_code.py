"""ZIP code (Census ZCTA) boundary.

TRAP: Chicago's `zip_codes` table exists in the dev database but was created by hand —
no migration or model defines it (backend audit 2026-10-02). This model + migration 005
(CREATE TABLE IF NOT EXISTS) formalise it. Column `zip_code` is what ZipCodeLayer.ts
reads. If the live Chicago table has different columns, migration 005 must ALTER, not
recreate — inspect it first (psql: \\d zip_codes).

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


class ZipCode(Base):
    __tablename__ = "zip_codes"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)
    zip_code: Mapped[str] = mapped_column(Text, nullable=False)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)
