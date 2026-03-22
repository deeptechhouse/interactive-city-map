import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class CityResponse(BaseModel):
    """Response schema for a single city."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    name: str
    slug: str
    state: str
    bounds: dict[str, Any] | None = None
    center: dict[str, Any] | None = None
    default_zoom: int | None = 12
    layer_config: dict[str, Any] | None = None
    data_sources: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class CityListResponse(BaseModel):
    """Response schema for a list of cities."""

    cities: list[CityResponse]
    total: int
