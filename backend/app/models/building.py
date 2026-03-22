import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import Boolean, DateTime, ForeignKey, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Building(Base):
    __tablename__ = "buildings"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    parcel_pin: Mapped[str | None] = mapped_column(Text, nullable=True)
    geom = mapped_column(Geometry("POLYGON", srid=4326), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    zoning_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    zoning_desc: Mapped[str | None] = mapped_column(Text, nullable=True)
    year_built: Mapped[int | None] = mapped_column(Integer, nullable=True)
    floors: Mapped[int | None] = mapped_column(Integer, nullable=True)
    sq_ft: Mapped[int | None] = mapped_column(Integer, nullable=True)
    owner_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    property_class: Mapped[str | None] = mapped_column(Text, nullable=True)
    has_interior: Mapped[bool | None] = mapped_column(Boolean, server_default="false")
    is_hidden: Mapped[bool | None] = mapped_column(Boolean, server_default="false")
    external_links = mapped_column(JSONB, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # Relationships
    city = relationship("City", back_populates="buildings")
    pois = relationship("POI", back_populates="building", lazy="selectin")
    floor_plans = relationship("FloorPlan", back_populates="building", lazy="selectin")
    interior_sources = relationship("InteriorSource", back_populates="building", lazy="noload")
    interior_rooms = relationship("InteriorRoom", back_populates="building", lazy="noload")
    interior_walls = relationship("InteriorWall", back_populates="building", lazy="noload")
    interior_features = relationship("InteriorFeature", back_populates="building", lazy="noload")
    scrape_targets = relationship("ScrapeTarget", back_populates="building", lazy="noload")
