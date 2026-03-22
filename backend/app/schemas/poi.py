import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class POIResponse(BaseModel):
    """Response schema for a single POI."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    city_id: uuid.UUID
    building_id: uuid.UUID | None = None
    geom: dict[str, Any] | None = None
    name: str
    category: str
    subcategory: str | None = None
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    hours: dict[str, Any] | None = None
    description: str | None = None
    event_facilities: list[str] | None = None
    unit_count: int | None = None
    source: str | None = None
    source_id: str | None = None
    verified: bool | None = False
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class POIListResponse(BaseModel):
    """Response schema for a list of POIs."""

    pois: list[POIResponse]
    total: int


class POICreateRequest(BaseModel):
    """Request schema for creating a new POI."""

    city_id: uuid.UUID
    building_id: uuid.UUID | None = None
    geom: dict[str, Any]  # GeoJSON Point: {"type": "Point", "coordinates": [lng, lat]}
    name: str
    category: str
    subcategory: str | None = None
    address: str | None = None
    phone: str | None = None
    website: str | None = None
    hours: dict[str, Any] | None = None
    description: str | None = None
    event_facilities: list[str] | None = None
    unit_count: int | None = None
    source: str | None = None
    source_id: str | None = None
    metadata: dict[str, Any] | None = None
