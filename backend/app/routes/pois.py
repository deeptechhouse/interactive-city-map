"""POI listing, detail, and creation endpoints."""

import json
import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.elements import WKTElement
from geoalchemy2.functions import ST_AsGeoJSON, ST_MakeEnvelope, ST_Intersects
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import POI, City

router = APIRouter(tags=["pois"])


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


def _poi_to_dict(row) -> dict:
    """Convert a POI row (with GeoJSON geometry) to a response dict."""
    poi = row[0] if hasattr(row, "__getitem__") else row
    geom_geojson = row[1] if hasattr(row, "__getitem__") and len(row) > 1 else None

    return {
        "id": str(poi.id),
        "city_id": str(poi.city_id),
        "building_id": str(poi.building_id) if poi.building_id else None,
        "name": poi.name,
        "category": poi.category,
        "subcategory": poi.subcategory,
        "address": poi.address,
        "phone": poi.phone,
        "website": poi.website,
        "hours": poi.hours,
        "description": poi.description,
        "event_facilities": poi.event_facilities,
        "unit_count": poi.unit_count,
        "source": poi.source,
        "source_id": poi.source_id,
        "verified": poi.verified,
        "metadata": poi.metadata_,
        "geometry": json.loads(geom_geojson) if geom_geojson else None,
        "created_at": poi.created_at.isoformat() if poi.created_at else None,
        "updated_at": poi.updated_at.isoformat() if poi.updated_at else None,
    }


@router.get("/cities/{slug}/pois")
async def list_pois(
    slug: str,
    category: Optional[str] = Query(None, description="Filter by category"),
    bbox: Optional[str] = Query(None, description="minlon,minlat,maxlon,maxlat"),
    session: AsyncSession = Depends(get_async_session),
):
    """Return POIs for a city, optionally filtered by category and bounding box."""
    city_stmt = select(City.id).where(City.slug == slug)
    city_result = await session.execute(city_stmt)
    city_id = city_result.scalar_one_or_none()
    if not city_id:
        raise HTTPException(status_code=404, detail=f"City '{slug}' not found")

    stmt = select(POI, ST_AsGeoJSON(POI.geom).label("geom_geojson")).where(POI.city_id == city_id)

    if category:
        stmt = stmt.where(POI.category == category)

    if bbox:
        min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)
        envelope = ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)
        stmt = stmt.where(ST_Intersects(POI.geom, envelope))

    result = await session.execute(stmt)
    rows = result.all()
    return [_poi_to_dict(row) for row in rows]


@router.get("/pois/{poi_id}")
async def get_poi(
    poi_id: uuid.UUID,
    session: AsyncSession = Depends(get_async_session),
):
    """Return a single POI by ID."""
    stmt = select(POI, ST_AsGeoJSON(POI.geom).label("geom_geojson")).where(POI.id == poi_id)
    result = await session.execute(stmt)
    row = result.first()
    if not row:
        raise HTTPException(status_code=404, detail="POI not found")
    return _poi_to_dict(row)


@router.post("/pois", status_code=201)
async def create_poi(
    name: str,
    category: str,
    city_id: uuid.UUID,
    lat: float,
    lon: float,
    building_id: Optional[uuid.UUID] = None,
    subcategory: Optional[str] = None,
    address: Optional[str] = None,
    phone: Optional[str] = None,
    website: Optional[str] = None,
    description: Optional[str] = None,
    session: AsyncSession = Depends(get_async_session),
):
    """Create a new manually-curated POI."""
    # Validate city exists
    city_stmt = select(City.id).where(City.id == city_id)
    city_result = await session.execute(city_stmt)
    if not city_result.scalar_one_or_none():
        raise HTTPException(status_code=404, detail="City not found")

    geom = WKTElement(f"POINT({lon} {lat})", srid=4326)

    poi = POI(
        city_id=city_id,
        building_id=building_id,
        name=name,
        category=category,
        subcategory=subcategory,
        address=address,
        phone=phone,
        website=website,
        description=description,
        geom=geom,
        source="manual",
        verified=False,
    )
    session.add(poi)
    await session.commit()
    await session.refresh(poi)

    # Re-fetch with geometry
    return await get_poi(poi.id, session)
