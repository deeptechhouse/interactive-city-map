"""Combined search endpoint across buildings, POIs, and zoning."""

import json
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Query
from geoalchemy2.functions import ST_AsGeoJSON, ST_MakeEnvelope, ST_Intersects
from sqlalchemy import select, func, or_, literal
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import Building, POI, ZoningDistrict, City

router = APIRouter(tags=["search"])


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


@router.get("/cities/{slug}/search")
async def search(
    slug: str,
    q: Optional[str] = Query(None, description="Full-text search query"),
    category: Optional[str] = Query(None, description="POI category filter"),
    zoning: Optional[str] = Query(None, description="Zoning code filter"),
    bbox: Optional[str] = Query(None, description="minlon,minlat,maxlon,maxlat"),
    limit: int = Query(50, ge=1, le=200),
    session: AsyncSession = Depends(get_async_session),
):
    """Combined search across buildings, POIs, and zoning districts.

    Results are returned as a unified list with a 'type' field indicating
    the source entity (building, poi, zoning_district).
    """
    city_stmt = select(City.id).where(City.slug == slug)
    city_result = await session.execute(city_stmt)
    city_id = city_result.scalar_one_or_none()
    if not city_id:
        raise HTTPException(status_code=404, detail=f"City '{slug}' not found")

    results = []

    # Parse bbox once if provided
    envelope = None
    if bbox:
        min_lon, min_lat, max_lon, max_lat = _parse_bbox(bbox)
        envelope = ST_MakeEnvelope(min_lon, min_lat, max_lon, max_lat, 4326)

    # ---------- Search buildings ----------
    if not category:  # buildings don't have category
        bldg_stmt = select(
            Building, ST_AsGeoJSON(Building.geom).label("geom_geojson")
        ).where(Building.city_id == city_id).where(Building.is_hidden.is_(False))

        if q:
            search_filter = or_(
                Building.name.ilike(f"%{q}%"),
                Building.address.ilike(f"%{q}%"),
                Building.owner_name.ilike(f"%{q}%"),
            )
            bldg_stmt = bldg_stmt.where(search_filter)

        if zoning:
            bldg_stmt = bldg_stmt.where(Building.zoning_code == zoning)

        if envelope is not None:
            bldg_stmt = bldg_stmt.where(ST_Intersects(Building.geom, envelope))

        bldg_stmt = bldg_stmt.limit(limit)
        bldg_result = await session.execute(bldg_stmt)
        for row in bldg_result.all():
            building = row[0]
            geom_json = row[1]
            results.append(
                {
                    "type": "building",
                    "id": str(building.id),
                    "name": building.name or building.address,
                    "address": building.address,
                    "zoning_code": building.zoning_code,
                    "geometry": json.loads(geom_json) if geom_json else None,
                }
            )

    # ---------- Search POIs ----------
    if not zoning:  # POIs don't have zoning
        poi_stmt = select(
            POI, ST_AsGeoJSON(POI.geom).label("geom_geojson")
        ).where(POI.city_id == city_id)

        if q:
            # Use PostgreSQL full-text search on the generated tsvector column
            poi_stmt = poi_stmt.where(
                POI.search_vector.op("@@")(func.plainto_tsquery("english", q))
            )

        if category:
            poi_stmt = poi_stmt.where(POI.category == category)

        if envelope is not None:
            poi_stmt = poi_stmt.where(ST_Intersects(POI.geom, envelope))

        poi_stmt = poi_stmt.limit(limit)
        poi_result = await session.execute(poi_stmt)
        for row in poi_result.all():
            poi = row[0]
            geom_json = row[1]
            results.append(
                {
                    "type": "poi",
                    "id": str(poi.id),
                    "name": poi.name,
                    "category": poi.category,
                    "address": poi.address,
                    "geometry": json.loads(geom_json) if geom_json else None,
                }
            )

    # ---------- Search zoning districts ----------
    if not category and zoning:
        zone_stmt = select(
            ZoningDistrict, ST_AsGeoJSON(ZoningDistrict.geom).label("geom_geojson")
        ).where(ZoningDistrict.city_id == city_id)

        if zoning:
            zone_stmt = zone_stmt.where(ZoningDistrict.zone_code == zoning)

        if envelope is not None:
            zone_stmt = zone_stmt.where(ST_Intersects(ZoningDistrict.geom, envelope))

        zone_stmt = zone_stmt.limit(limit)
        zone_result = await session.execute(zone_stmt)
        for row in zone_result.all():
            district = row[0]
            geom_json = row[1]
            results.append(
                {
                    "type": "zoning_district",
                    "id": str(district.id),
                    "name": district.zone_name or district.zone_code,
                    "zone_code": district.zone_code,
                    "zone_class": district.zone_class,
                    "geometry": json.loads(geom_json) if geom_json else None,
                }
            )

    return {
        "city_slug": slug,
        "query": q,
        "filters": {"category": category, "zoning": zoning, "bbox": bbox},
        "count": len(results),
        "results": results[:limit],
    }
