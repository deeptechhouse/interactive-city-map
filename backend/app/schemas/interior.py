import uuid
from datetime import date, datetime
from typing import Any

from pydantic import BaseModel, ConfigDict


# ── InteriorSource ──────────────────────────────────────────────

class InteriorSourceCreateRequest(BaseModel):
    source_type: str
    source_url: str | None = None
    source_date: date | None = None
    raster_url: str | None = None
    confidence: float | None = 0.0


class InteriorSourceResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    city_id: uuid.UUID
    source_type: str
    source_url: str | None = None
    source_date: date | None = None
    fetch_date: datetime | None = None
    raw_data: dict[str, Any] | None = None
    raster_url: str | None = None
    geojson: dict[str, Any] | None = None
    confidence: float | None = 0.0
    status: str | None = "raw"
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ── InteriorRoom ────────────────────────────────────────────────

class InteriorRoomCreateRequest(BaseModel):
    level: int
    room_type: str | None = None
    name: str | None = None
    area_sqm: float | None = None
    capacity: int | None = None
    geom: dict[str, Any]  # GeoJSON geometry


class InteriorRoomResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    floor_plan_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    level: int
    room_type: str | None = None
    name: str | None = None
    area_sqm: float | None = None
    capacity: int | None = None
    metadata: dict[str, Any] | None = None
    geom: dict[str, Any] | None = None
    created_at: datetime | None = None
    updated_at: datetime | None = None


# ── InteriorWall ────────────────────────────────────────────────

class InteriorWallCreateRequest(BaseModel):
    level: int
    wall_type: str | None = "interior"
    material: str | None = None
    thickness_m: float | None = None
    geom: dict[str, Any]  # GeoJSON geometry


class InteriorWallResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    floor_plan_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    level: int
    wall_type: str | None = "interior"
    material: str | None = None
    thickness_m: float | None = None
    geom: dict[str, Any] | None = None
    created_at: datetime | None = None


# ── InteriorFeature ─────────────────────────────────────────────

class InteriorFeatureCreateRequest(BaseModel):
    level: int
    feature_type: str
    name: str | None = None
    geom: dict[str, Any]  # GeoJSON geometry


class InteriorFeatureResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID
    floor_plan_id: uuid.UUID | None = None
    source_id: uuid.UUID | None = None
    level: int
    feature_type: str
    name: str | None = None
    metadata: dict[str, Any] | None = None
    geom: dict[str, Any] | None = None
    created_at: datetime | None = None


# ── ScrapeTarget ────────────────────────────────────────────────

class ScrapeTargetCreateRequest(BaseModel):
    url: str
    poi_id: uuid.UUID | None = None


class ScrapeTargetResponse(BaseModel):
    model_config = ConfigDict(from_attributes=True)

    id: uuid.UUID
    building_id: uuid.UUID | None = None
    poi_id: uuid.UUID | None = None
    url: str
    status: str | None = "pending"
    last_attempt: datetime | None = None
    floor_plan_urls: list[str] | None = None
    metadata: dict[str, Any] | None = None
    created_at: datetime | None = None


# ── Summary ─────────────────────────────────────────────────────

class InteriorSummaryResponse(BaseModel):
    building_id: uuid.UUID
    source_count: int = 0
    room_count: int = 0
    wall_count: int = 0
    feature_count: int = 0
    has_extracted_data: bool = False
