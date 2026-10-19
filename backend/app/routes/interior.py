"""Interior map CRUD endpoints: sources, rooms, walls, features."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from geoalchemy2.shape import to_shape
from pydantic import BaseModel
from shapely.geometry import mapping
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import Building, InteriorFeature, InteriorRoom, InteriorSource, InteriorWall
from app.schemas.interior import (
    InteriorFeatureCreateRequest,
    InteriorFeatureResponse,
    InteriorRoomCreateRequest,
    InteriorRoomResponse,
    InteriorSourceCreateRequest,
    InteriorSourceResponse,
    InteriorSummaryResponse,
    InteriorWallCreateRequest,
    InteriorWallResponse,
)
from app.services.interior_service import InteriorService

router = APIRouter(tags=["interior"])


# ── Helpers ─────────────────────────────────────────────────────

# O(v) time, O(v) space — v = vertices in the geometry (WKB decode + GeoJSON mapping)
def _geom_to_dict(geom) -> dict | None:
    if geom is None:
        return None
    return mapping(to_shape(geom))


# O(1) time, O(1) space
def _source_to_dict(s: InteriorSource) -> dict:
    return {
        "id": s.id,
        "building_id": s.building_id,
        "city_id": s.city_id,
        "source_type": s.source_type,
        "source_url": s.source_url,
        "source_date": s.source_date,
        "fetch_date": s.fetch_date,
        "raw_data": s.raw_data,
        "raster_url": s.raster_url,
        "geojson": s.geojson,
        "confidence": s.confidence,
        "status": s.status,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


# O(v) time, O(v) space — v = vertices in the room geometry
def _room_to_dict(r: InteriorRoom) -> dict:
    return {
        "id": r.id,
        "building_id": r.building_id,
        "floor_plan_id": r.floor_plan_id,
        "source_id": r.source_id,
        "level": r.level,
        "room_type": r.room_type,
        "name": r.name,
        "area_sqm": r.area_sqm,
        "capacity": r.capacity,
        "metadata": r.metadata_,
        "geom": _geom_to_dict(r.geom),
        "created_at": r.created_at,
        "updated_at": r.updated_at,
    }


# O(v) time, O(v) space — v = vertices in the wall geometry
def _wall_to_dict(w: InteriorWall) -> dict:
    return {
        "id": w.id,
        "building_id": w.building_id,
        "floor_plan_id": w.floor_plan_id,
        "source_id": w.source_id,
        "level": w.level,
        "wall_type": w.wall_type,
        "material": w.material,
        "thickness_m": w.thickness_m,
        "geom": _geom_to_dict(w.geom),
        "created_at": w.created_at,
    }


# O(v) time, O(v) space — v = vertices in the feature geometry
def _feature_to_dict(f: InteriorFeature) -> dict:
    return {
        "id": f.id,
        "building_id": f.building_id,
        "floor_plan_id": f.floor_plan_id,
        "source_id": f.source_id,
        "level": f.level,
        "feature_type": f.feature_type,
        "name": f.name,
        "metadata": f.metadata_,
        "geom": _geom_to_dict(f.geom),
        "created_at": f.created_at,
    }


# O(log n) time, O(1) space — n = buildings in the database (primary-key lookup)
async def _require_building(building_id: uuid.UUID, session: AsyncSession) -> Building:
    stmt = select(Building).where(Building.id == building_id)
    result = await session.execute(stmt)
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")
    return building


# ── Sources ─────────────────────────────────────────────────────

@router.get("/buildings/{building_id}/interior/sources")
# O(log n + s) time, O(s) space — n = buildings in the database; s = interior sources of this building (indexed, no limit)
async def list_sources(
    building_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    sources = await InteriorService.get_sources(building_id, session)
    # O(s) time, O(s) space — s = interior sources of this building
    return [_source_to_dict(s) for s in sources]


@router.post("/buildings/{building_id}/interior/sources", status_code=201)
# O(log n) time, O(1) space — n = rows in buildings and interior_sources (lookup + insert)
async def create_source(
    building_id: uuid.UUID,
    data: InteriorSourceCreateRequest,
    session: AsyncSession = Depends(get_async_session),
):
    building = await _require_building(building_id, session)
    source = await InteriorService.create_source(building_id, building.city_id, data, session)
    return _source_to_dict(source)


class StatusUpdateRequest(BaseModel):
    status: str


@router.patch("/interior/sources/{source_id}/status")
# O(log n) time, O(1) space — n = interior sources in the database (primary-key lookup + update)
async def update_source_status(
    source_id: uuid.UUID,
    data: StatusUpdateRequest,
    session: AsyncSession = Depends(get_async_session),
):
    source = await InteriorService.update_source_status(source_id, data.status, session)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return _source_to_dict(source)


# ── Rooms ───────────────────────────────────────────────────────

@router.get("/buildings/{building_id}/interior/rooms")
# O(log n + r log r + v) time, O(v) space — n = buildings in the database; r = rooms of this building (optionally one level, sorted); v = total vertices across the returned room geometries
async def list_rooms(
    building_id: uuid.UUID,
    level: Optional[int] = None,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    rooms = await InteriorService.get_rooms(building_id, session, level=level)
    # O(v) time, O(v) space — v = total vertices across the rooms room geometries returned
    return [_room_to_dict(r) for r in rooms]


@router.post("/buildings/{building_id}/interior/rooms", status_code=201)
# O(log n + v) time, O(v) space — n = rows in buildings and interior_rooms (lookup + insert); v = vertices in the submitted geometry
async def create_room(
    building_id: uuid.UUID,
    data: InteriorRoomCreateRequest,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    room = await InteriorService.create_room(building_id, data, session)
    return _room_to_dict(room)


@router.delete("/interior/rooms/{room_id}", status_code=204)
# O(log n) time, O(1) space — n = interior rooms in the database (primary-key delete)
async def delete_room(
    room_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await InteriorService.delete_room(room_id, session)
    if not deleted:
        raise HTTPException(status_code=404, detail="Room not found")
    return Response(status_code=204)


# ── Walls ───────────────────────────────────────────────────────

@router.get("/buildings/{building_id}/interior/walls")
# O(log n + w log w + v) time, O(v) space — n = buildings in the database; w = walls of this building (optionally one level, sorted); v = total vertices across the returned wall geometries
async def list_walls(
    building_id: uuid.UUID,
    level: Optional[int] = None,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    walls = await InteriorService.get_walls(building_id, session, level=level)
    # O(v) time, O(v) space — v = total vertices across the walls wall geometries returned
    return [_wall_to_dict(w) for w in walls]


@router.post("/buildings/{building_id}/interior/walls", status_code=201)
# O(log n + v) time, O(v) space — n = rows in buildings and interior_walls (lookup + insert); v = vertices in the submitted geometry
async def create_wall(
    building_id: uuid.UUID,
    data: InteriorWallCreateRequest,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    wall = await InteriorService.create_wall(building_id, data, session)
    return _wall_to_dict(wall)


@router.delete("/interior/walls/{wall_id}", status_code=204)
# O(log n) time, O(1) space — n = interior walls in the database (primary-key delete)
async def delete_wall(
    wall_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await InteriorService.delete_wall(wall_id, session)
    if not deleted:
        raise HTTPException(status_code=404, detail="Wall not found")
    return Response(status_code=204)


# ── Features ────────────────────────────────────────────────────

@router.get("/buildings/{building_id}/interior/features")
# O(log n + f log f + v) time, O(v) space — n = buildings in the database; f = features of this building (optionally one level, sorted); v = total vertices across the returned feature geometries
async def list_features(
    building_id: uuid.UUID,
    level: Optional[int] = None,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    features = await InteriorService.get_features(building_id, session, level=level)
    # O(v) time, O(v) space — v = total vertices across the features feature geometries returned
    return [_feature_to_dict(f) for f in features]


@router.post("/buildings/{building_id}/interior/features", status_code=201)
# O(log n + v) time, O(v) space — n = rows in buildings and interior_features (lookup + insert); v = vertices in the submitted geometry
async def create_feature(
    building_id: uuid.UUID,
    data: InteriorFeatureCreateRequest,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    feature = await InteriorService.create_feature(building_id, data, session)
    return _feature_to_dict(feature)


@router.delete("/interior/features/{feature_id}", status_code=204)
# O(log n) time, O(1) space — n = interior features in the database (primary-key delete)
async def delete_feature(
    feature_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    deleted = await InteriorService.delete_feature(feature_id, session)
    if not deleted:
        raise HTTPException(status_code=404, detail="Feature not found")
    return Response(status_code=204)


# ── Summary ─────────────────────────────────────────────────────

@router.get("/buildings/{building_id}/interior/summary")
# O(log n + m) time, O(1) space — n = buildings in the database; m = interior rows of this building counted by the 4 COUNT queries (indexed by building_id)
async def get_summary(
    building_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    summary = await InteriorService.get_summary(building_id, session)
    return summary


# ── Extraction trigger ──────────────────────────────────────────

@router.post("/interior/sources/{source_id}/extract")
# O(log n) time, O(1) space — n = interior sources in the database (primary-key lookup + update)
async def trigger_extraction(
    source_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    source = await InteriorService.update_source_status(source_id, "processing", session)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"status": "queued", "source_id": str(source_id)}
