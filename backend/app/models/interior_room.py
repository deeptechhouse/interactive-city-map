import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, Float, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class InteriorRoom(Base):
    __tablename__ = "interior_rooms"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    building_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=False
    )
    floor_plan_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("floor_plans.id"), nullable=True
    )
    source_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("interior_sources.id"), nullable=True
    )
    level: Mapped[int] = mapped_column(Integer, nullable=False)
    room_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    area_sqm: Mapped[float | None] = mapped_column(Float, nullable=True)
    capacity: Mapped[int | None] = mapped_column(Integer, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)
    geom = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # Relationships
    building = relationship("Building", back_populates="interior_rooms")
    floor_plan = relationship("FloorPlan", back_populates="interior_rooms")
    source = relationship("InteriorSource")
