"""City listing and detail endpoints."""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import City

router = APIRouter(prefix="/cities", tags=["cities"])


def _city_to_dict(row) -> dict:
    """Convert a City row (with optional GeoJSON strings) to a response dict."""
    city = row[0] if hasattr(row, "__getitem__") else row
    bounds_geojson = row[1] if hasattr(row, "__getitem__") and len(row) > 1 else None
    center_geojson = row[2] if hasattr(row, "__getitem__") and len(row) > 2 else None

    return {
        "id": str(city.id),
        "name": city.name,
        "slug": city.slug,
        "state": city.state,
        "default_zoom": city.default_zoom,
        "layer_config": city.layer_config,
        "data_sources": city.data_sources,
        "bounds": bounds_geojson,
        "center": center_geojson,
        "created_at": city.created_at.isoformat() if city.created_at else None,
        "updated_at": city.updated_at.isoformat() if city.updated_at else None,
    }


@router.get("")
async def list_cities(session: AsyncSession = Depends(get_async_session)):
    """Return all cities with their bounds and center as GeoJSON."""
    stmt = select(
        City,
        ST_AsGeoJSON(City.bounds).label("bounds_geojson"),
        ST_AsGeoJSON(City.center).label("center_geojson"),
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [_city_to_dict(row) for row in rows]


@router.get("/{slug}")
async def get_city(slug: str, session: AsyncSession = Depends(get_async_session)):
    """Return city detail including layer configuration."""
    stmt = select(
        City,
        ST_AsGeoJSON(City.bounds).label("bounds_geojson"),
        ST_AsGeoJSON(City.center).label("center_geojson"),
    ).where(City.slug == slug)
    result = await session.execute(stmt)
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail=f"City '{slug}' not found")
    return _city_to_dict(row)
