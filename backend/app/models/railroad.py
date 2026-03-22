import uuid

from geoalchemy2 import Geometry
from sqlalchemy import ARRAY, ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class Railroad(Base):
    __tablename__ = "railroads"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("MULTILINESTRING", srid=4326), nullable=False)
    name: Mapped[str | None] = mapped_column(Text, nullable=True)
    owner: Mapped[str | None] = mapped_column(Text, nullable=True)
    status: Mapped[str] = mapped_column(Text, nullable=False)
    track_class: Mapped[str | None] = mapped_column(Text, nullable=True)
    trackage_rights = mapped_column(ARRAY(Text), nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)

    # Relationships
    city = relationship("City", back_populates="railroads")
