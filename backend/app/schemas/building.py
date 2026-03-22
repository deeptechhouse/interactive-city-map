import uuid
from datetime import datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


class BuildingResponse(BaseModel):
    """Response schema for a single building."""

    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    city_id: uuid.UUID
    parcel_pin: str | None = None
    geom: dict[str, Any] | None = None
    address: str | None = None
    name: str | None = None
    zoning_code: str | None = None
    zoning_desc: str | None = None
    year_built: int | None = None
    floors: int | None = None
    sq_ft: int | None = None
    owner_name: str | None = None
    owner_type: str | None = None
    property_class: str | None = None
    has_interior: bool | None = False
    is_hidden: bool | None = False
    external_links: dict[str, Any] | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


class BuildingListResponse(BaseModel):
    """Response schema for a list of buildings."""

    buildings: list[BuildingResponse]
    total: int


class BuildingUpdateRequest(BaseModel):
    """Request schema for updating building properties (hide/unhide, external links)."""

    is_hidden: bool | None = None
    external_links: dict[str, Any] | None = None
