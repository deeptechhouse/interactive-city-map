"""Railroad metadata endpoints."""

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import Railroad, City

router = APIRouter(tags=["railroads"])


def _railroad_to_dict(row) -> dict:
    """Convert a Railroad row (with GeoJSON geometry) to a response dict."""
    rr = row[0] if hasattr(row, "__getitem__") else row
    geom_geojson = row[1] if hasattr(row, "__getitem__") and len(row) > 1 else None

    return {
        "id": str(rr.id),
        "city_id": str(rr.city_id),
        "name": rr.name,
        "owner": rr.owner,
        "status": rr.status,
        "track_class": rr.track_class,
        "trackage_rights": rr.trackage_rights,
        "source": rr.source,
        "metadata": rr.metadata,
        "geometry": json.loads(geom_geojson) if geom_geojson else None,
    }


@router.get("/cities/{slug}/railroads")
async def list_railroads(
    slug: str,
    owner: Optional[str] = Query(None, description="Filter by railroad owner"),
    status: Optional[str] = Query(None, description="Filter by status (active, abandoned, etc.)"),
    session: AsyncSession = Depends(get_async_session),
):
    """Return railroad segments for a city, optionally filtered by owner and status."""
    city_stmt = select(City.id).where(City.slug == slug)
    city_result = await session.execute(city_stmt)
    city_id = city_result.scalar_one_or_none()
    if not city_id:
        raise HTTPException(status_code=404, detail=f"City '{slug}' not found")

    stmt = select(
        Railroad, ST_AsGeoJSON(Railroad.geom).label("geom_geojson")
    ).where(Railroad.city_id == city_id)

    if owner:
        stmt = stmt.where(Railroad.owner == owner)
    if status:
        stmt = stmt.where(Railroad.status == status)

    result = await session.execute(stmt)
    rows = result.all()
    return [_railroad_to_dict(row) for row in rows]
