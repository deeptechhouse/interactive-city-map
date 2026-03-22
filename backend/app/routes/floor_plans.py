"""Floor plan upload, listing, and detail endpoints."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, File, Form, HTTPException, UploadFile
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage import StorageAdapter, get_storage_adapter
from app.database import get_async_session
from app.models import Building, FloorPlan
from app.services import floor_plan_service

router = APIRouter(tags=["floor_plans"])


def _floor_plan_to_dict(fp: FloorPlan) -> dict:
    """Convert a FloorPlan ORM object to a response dict."""
    return {
        "id": str(fp.id),
        "building_id": str(fp.building_id),
        "level": fp.level,
        "level_name": fp.level_name,
        "geojson": fp.geojson,
        "raster_url": fp.raster_url,
        "source": fp.source,
        "created_at": fp.created_at.isoformat() if fp.created_at else None,
        "updated_at": fp.updated_at.isoformat() if fp.updated_at else None,
    }


@router.get("/buildings/{building_id}/floor-plans")
async def list_floor_plans(
    building_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    """Return all floor plans for the given building."""
    plans = await floor_plan_service.get_floor_plans(building_id, session)
    return [_floor_plan_to_dict(fp) for fp in plans]


@router.post("/buildings/{building_id}/floor-plans", status_code=201)
async def upload_floor_plan(
    building_id: uuid.UUID,
    level: int = Form(...),
    level_name: Optional[str] = Form(None),
    file: UploadFile = File(...),
    session: AsyncSession = Depends(get_async_session),
    storage: StorageAdapter = Depends(get_storage_adapter),
):
    """Upload a floor plan image for a building level."""
    # Verify building exists
    from sqlalchemy import select

    stmt = select(Building.id).where(Building.id == building_id)
    result = await session.execute(stmt)
    if not result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Building not found")

    fp = await floor_plan_service.upload_floor_plan(
        building_id=building_id,
        level=level,
        level_name=level_name,
        file=file,
        session=session,
        storage=storage,
    )
    return _floor_plan_to_dict(fp)


@router.get("/floor-plans/{floor_plan_id}")
async def get_floor_plan(
    floor_plan_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    """Return a single floor plan by ID."""
    fp = await floor_plan_service.get_floor_plan(floor_plan_id, session)
    if not fp:
        raise HTTPException(status_code=404, detail="Floor plan not found")
    return _floor_plan_to_dict(fp)
