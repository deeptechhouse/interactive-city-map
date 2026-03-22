import uuid

from geoalchemy2 import Geometry
from sqlalchemy import ARRAY, Boolean, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class TransitLine(Base):
    __tablename__ = "transit_lines"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("MULTILINESTRING", srid=4326), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    color: Mapped[str | None] = mapped_column(Text, nullable=True)
    system: Mapped[str | None] = mapped_column(Text, nullable=True)
    line_type: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)

    # Relationships
    city = relationship("City", back_populates="transit_lines")
    stations = relationship("TransitStation", back_populates="line", lazy="selectin")


class TransitStation(Base):
    __tablename__ = "transit_stations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    line_id: Mapped[uuid.UUID | None] = mapped_column(
        UUID(as_uuid=True), ForeignKey("transit_lines.id"), nullable=True
    )
    geom = mapped_column(Geometry("POINT", srid=4326), nullable=False)
    name: Mapped[str] = mapped_column(Text, nullable=False)
    lines_served = mapped_column(ARRAY(Text), nullable=True)
    accessible: Mapped[bool | None] = mapped_column(Boolean, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)

    # Relationships
    city = relationship("City", back_populates="transit_stations")
    line = relationship("TransitLine", back_populates="stations")
