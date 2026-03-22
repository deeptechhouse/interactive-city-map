"""Service layer for floor-plan upload and retrieval."""

import uuid
from typing import Optional

from fastapi import UploadFile
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage import StorageAdapter
from app.config import settings
from app.models import FloorPlan


async def upload_floor_plan(
    building_id: uuid.UUID,
    level: int,
    level_name: Optional[str],
    file: UploadFile,
    session: AsyncSession,
    storage: StorageAdapter,
) -> FloorPlan:
    """Save a floor-plan image to object storage and create the DB record.

    Args:
        building_id: UUID of the parent building.
        level: Integer floor level (0 = ground, negative = basement).
        level_name: Optional human-readable name for the level.
        file: The uploaded file (image or PDF).
        session: Async SQLAlchemy session.
        storage: Storage adapter instance.

    Returns:
        The newly created FloorPlan ORM object.
    """
    file_data = await file.read()
    content_type = file.content_type or "application/octet-stream"
    ext = file.filename.rsplit(".", 1)[-1] if file.filename and "." in file.filename else "bin"
    key = f"floor-plans/{building_id}/{level}.{ext}"

    raster_url = storage.upload_file(
        bucket=settings.s3_bucket_name,
        key=key,
        file_data=file_data,
        content_type=content_type,
    )

    floor_plan = FloorPlan(
        building_id=building_id,
        level=level,
        level_name=level_name,
        raster_url=raster_url,
        source="upload",
    )
    session.add(floor_plan)
    await session.commit()
    await session.refresh(floor_plan)
    return floor_plan


async def get_floor_plans(building_id: uuid.UUID, session: AsyncSession) -> list[FloorPlan]:
    """Return all floor plans for a building, ordered by level."""
    stmt = (
        select(FloorPlan)
        .where(FloorPlan.building_id == building_id)
        .order_by(FloorPlan.level)
    )
    result = await session.execute(stmt)
    return list(result.scalars().all())


async def get_floor_plan(floor_plan_id: uuid.UUID, session: AsyncSession) -> Optional[FloorPlan]:
    """Return a single floor plan by its ID."""
    stmt = select(FloorPlan).where(FloorPlan.id == floor_plan_id)
    result = await session.execute(stmt)
    return result.scalar_one_or_none()
