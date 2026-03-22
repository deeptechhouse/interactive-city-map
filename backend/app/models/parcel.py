import uuid

from geoalchemy2 import Geometry
from sqlalchemy import ForeignKey, Numeric, Text, UniqueConstraint, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Parcel(Base):
    __tablename__ = "parcels"
    __table_args__ = (UniqueConstraint("city_id", "pin", name="idx_parcels_city_pin"),)

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    pin: Mapped[str] = mapped_column(Text, nullable=False)
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    assessed_value = mapped_column(Numeric, nullable=True)
    property_class: Mapped[str | None] = mapped_column(Text, nullable=True)
    land_use: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)

    # Relationships
    city = relationship("City", back_populates="parcels")
