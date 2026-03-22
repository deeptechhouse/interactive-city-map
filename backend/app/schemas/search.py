import uuid
from typing import Any

from pydantic import BaseModel


class SearchRequest(BaseModel):
    """Request schema for combined search across buildings and POIs."""

    query: str
    city_slug: str
    category: str | None = None
    zoning: str | None = None
    bbox: list[float] | None = None  # [west, south, east, north]


class SearchResultItem(BaseModel):
    """A single search result (building or POI)."""

    id: uuid.UUID
    result_type: str  # "building" or "poi"
    name: str | None = None
    address: str | None = None
    category: str | None = None
    zoning_code: str | None = None
    geom: dict[str, Any] | None = None
    rank: float | None = None


class SearchResponse(BaseModel):
    """Response schema for combined search results."""

    results: list[SearchResultItem]
    total: int
    query: str
