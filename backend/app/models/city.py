import uuid
from datetime import datetime

from geoalchemy2 import Geometry
from sqlalchemy import DateTime, Integer, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class City(Base):
    __tablename__ = "cities"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    name: Mapped[str] = mapped_column(Text, nullable=False)
    slug: Mapped[str] = mapped_column(Text, unique=True, nullable=False)
    state: Mapped[str] = mapped_column(Text, nullable=False)
    bounds = mapped_column(Geometry("POLYGON", srid=4326), nullable=True)
    center = mapped_column(Geometry("POINT", srid=4326), nullable=True)
    default_zoom: Mapped[int | None] = mapped_column(Integer, server_default="12")
    layer_config = mapped_column(JSONB, nullable=True)
    data_sources = mapped_column(JSONB, nullable=True)
    created_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )
    updated_at: Mapped[datetime | None] = mapped_column(
        DateTime(timezone=True), server_default=text("now()")
    )

    # Relationships
    buildings = relationship("Building", back_populates="city", lazy="selectin")
    parcels = relationship("Parcel", back_populates="city", lazy="selectin")
    railroads = relationship("Railroad", back_populates="city", lazy="selectin")
    zoning_districts = relationship("ZoningDistrict", back_populates="city", lazy="selectin")
    pois = relationship("POI", back_populates="city", lazy="selectin")
    transit_lines = relationship("TransitLine", back_populates="city", lazy="selectin")
    transit_stations = relationship("TransitStation", back_populates="city", lazy="selectin")
    waterways = relationship("Waterway", back_populates="city", lazy="selectin")
