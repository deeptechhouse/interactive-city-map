"""Building listing, detail, and update endpoints."""

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_AsGeoJSON, ST_MakeEnvelope, ST_Intersects
from sqlalchemy import select, update
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import Building, City

router = APIRouter(tags=["buildings"])


def _parse_bbox(bbox: str) -> tuple[float, float, float, float]:
    """Parse a 'minlon,minlat,maxlon,maxlat' string into four floats."""
    try:
        parts = [float(x.strip()) for x in bbox.split(",")]
        if len(parts) != 4:
            raise ValueError
        return (parts[0], parts[1], parts[2], parts[3])
    except (ValueError, AttributeError):
        raise HTTPException(
            status_code=400,
            detail="bbox must be 4 comma-separated floats: minlon,minlat,maxlon,maxlat",
        )


def _building_to_dict(row) -> dict:
    """Convert a Building row (with GeoJSON geometry) to a response dict."""
    building = row[0] if hasattr(row, "__getitem__") else row
    geom_geojson = row[1] if hasattr(row, "__getitem__") and len(row) > 1 else None

    return {
        "id": str(building.id),
        "city_id": str(building.city_id),
        "parcel_pin": building.parcel_pin,
        "address": building.address,
        "name": building.name,
        "zoning_code": building.zoning_code,
        "zoning_desc": building.zoning_desc,
        "year_built": building.year_built,
        "floors": building.floors,
        "sq_ft": building.sq_ft,
        "owner_name": building.owner_name,
        "owner_type": building.owner_type,
        "property_class": building.property_class,
        "has_interior": building.has_interior,
        "is_hidden": building.is_hidden,
        "external_links": building.external_links,
        "metadata": building.metadata_,
        "geometry": json.loads(geom_geojson) if geom_geojson else None,
        "created_at": building.created_at.isoformat() if building.created_at else None,
        "updated_at": building.updated_at.isoformat() if building.updated_at else None,
    }


@router.get("/cities/{slug}/buildings")
async def list_buildings_by_bbox(
    slug: str,
    bbox: str = Query(..., description="minlon,minlat,maxlon,maxlat"),
    session: AsyncSession = Depends(get_async_session),
):
    """Return buildings within a bounding box for the given city."""
    min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)

    # Resolve city
    city_stmt = select(City.id).where(City.slug == slug)
    city_result = await session.execute(city_stmt)
    city_id = city_result.scalar_one_or_none()
    if not city_id:
        raise HTTPException(status_code=404, detail=f"City '{slug}' not found")

    envelope = ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
    stmt = (
        select(Building, ST_AsGeoJSON(Building.geom).label("geom_geojson"))
        .where(Building.city_id == city_id)
        .where(Building.is_hidden.is_(False))
        .where(ST_Intersects(Building.geom, envelope))
    )
    result = await session.execute(stmt)
    rows = result.all()
    return [_building_to_dict(row) for row in rows]


@router.get("/buildings/{building_id}")
async def get_building(
    building_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    """Return a single building by ID."""
    stmt = select(
        Building, ST_AsGeoJSON(Building.geom).label("geom_geojson")
    ).where(Building.id == building_id)
    result = await session.execute(stmt)
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="Building not found")
    return _building_to_dict(row)


@router.patch("/buildings/{building_id}")
async def update_building(
    building_id: uuid.UUID,
    is_hidden: Optional[bool] = None,
    external_links: Optional[dict] = None,
    session: AsyncSession = Depends(get_async_session),
):
    """Update a building's hidden status and/or external links."""
    # Verify exists
    exists_stmt = select(Building.id).where(Building.id == building_id)
    exists_result = await session.execute(exists_stmt)
    if not exists_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="Building not found")

    values: dict = {}
    if is_hidden is not None:
        values["is_hidden"] = is_hidden
    if external_links is not None:
        values["external_links"] = external_links

    if not values:
        raise HTTPException(status_code=400, detail="No update fields provided")

    stmt = update(Building).where(Building.id == building_id).values(**values)
    await session.execute(stmt)
    await session.commit()

    # Return updated building
    return await get_building(building_id, session)
