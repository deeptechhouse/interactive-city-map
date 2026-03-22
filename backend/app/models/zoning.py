import uuid

from geoalchemy2 import Geometry
from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class ZoningDistrict(Base):
    __tablename__ = "zoning_districts"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("MULTIPOLYGON", srid=4326), nullable=False)
    zone_code: Mapped[str] = mapped_column(Text, nullable=False)
    zone_class: Mapped[str] = mapped_column(Text, nullable=False)
    zone_name: Mapped[str | None] = mapped_column(Text, nullable=True)
    description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ordinance_ref: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)

    # Relationships
    city = relationship("City", back_populates="zoning_districts")
