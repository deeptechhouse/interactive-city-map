import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class FloorPlanResponse(BaseModel):
    """Response schema for a single floor plan."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    level: int
    level_name: str | None = None
    geojson: dict[str, Any] | None = None
    raster_url: str | None = None
    raster_bounds: dict[str, Any] | None = None
    source: str | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class FloorPlanListResponse(BaseModel):
    """Response schema for a list of floor plans."""

    floor_plans: list[FloorPlanResponse]
    total: int
