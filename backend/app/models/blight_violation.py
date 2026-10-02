import uuid

from geoalchemy2 import Geometry
from sqlalchemy import ForeignKey, Text, text
from sqlalchemy.dialects.postgresql import JSONB, UUID
from sqlalchemy.orm import Mapped, mapped_column, relationship

from app.database import Base


class BlightViolation(Base):
    __tablename__ = "blight_violations"

    id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), primary_key=True, default=uuid.uuid4, server_default=text("gen_random_uuid()")
    )
    city_id: Mapped[uuid.UUID] = mapped_column(
        UUID(as_uuid=True), ForeignKey("cities.id"), nullable=False
    )
    geom = mapped_column(Geometry("POINT", srid=4326), nullable=False)
    address: Mapped[str | None] = mapped_column(Text, nullable=True)
    violation_code: Mapped[str | None] = mapped_column(Text, nullable=True)
    violation_description: Mapped[str | None] = mapped_column(Text, nullable=True)
    ticket_status: Mapped[str | None] = mapped_column(Text, nullable=True)
    violation_date: Mapped[str | None] = mapped_column(Text, nullable=True)
    source: Mapped[str | None] = mapped_column(Text, nullable=True)
    metadata_ = mapped_column("metadata", JSONB, nullable=True)

    # Relationships
    city = relationship("City", back_populates="blight_violations")
