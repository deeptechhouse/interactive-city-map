import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, ForeignKey, Integer, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class FloorPlan(Base):
    __tablename__ = "floor_plans"
    __table_args__ = (UniqueConstraint("building_id", "level", name="idx_floor_plans_building_level"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    building_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    level_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    geojson = mapped_column(JSONB, nullable=True)
    raster_url: Mapped[str | None] = mapped_column(Text, nullable=True)
    raster_bounds = mapped_column(Geometry("POLYGON", srid=4326), nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # Relationships
    building = relationship("Building", back_populates="floor_plans")
