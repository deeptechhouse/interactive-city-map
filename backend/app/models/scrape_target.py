import uuid
from datetime import datetime

from sqlalchemy import ARRAY, DateTime, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ScrapeTarget(Base):
    __tablename__ = "scrape_targets"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    building_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("buildings.id"), nullable=True
    )
    poi_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("pois.id"), nullable=True
    )
    url: Mapped[str] = mapped_column(Text, nullable=False)
    status: Mapped[str | None] = mapped_column(Text, server_default="'pending'")
    last_attempt: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), nullable=True
    )
    floor_plan_urls = mapped_column(ARRAY(Text), nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # Relationships
    building = relationship("Building", back_populates="scrape_targets")
    poi = relationship("POI")
