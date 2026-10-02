"""City listing, detail, and boundary-polygon endpoints.

    GET /cities                          every city row (bounds/center as GeoJSON)
    GET /cities/{slug}                   one city
    GET /cities/{slug}/boundaries/{layer}
        Real polygons (not tiles) for the Focus-areas panel in DATABASE mode — the
        union/intersection maths needs whole shapes. Static mode reads the same
        FeatureCollection from public/data/<slug>/<layer>.geojson (the static build's
        geojson_copy); frontend/src/cities/boundarySource.ts picks the URL.
"""

import uuid

from fastapi import APIRouter, Depends, HTTPException
from geoalchemy2.functions import ST_AsGeoJSON
from sqlalchemy import select, text
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import City

router = APIRouter(prefix="/cities", tags=["cities"])


# O(1) time, O(1) space — n = 1 city row
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
# O(n) time, O(n) space — n = cities (3)
async def list_cities(session: AsyncSession = Depends(get_async_session)):
    """Return all cities with their bounds and center as GeoJSON."""
    stmt = select(
        City,
        ST_AsGeoJSON(City.bounds).label("bounds_geojson"),
        ST_AsGeoJSON(City.center).label("center_geojson"),
    )
    result = await session.execute(stmt)
    rows = result.all()
    # O(n) time, O(n) space — n = cities
    return [_city_to_dict(row) for row in rows]


@router.get("/{slug}")
# O(1) time, O(1) space — n = 1 city (indexed slug lookup)
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


# Boundary layers the focus panel may request → the properties it reads. A fixed
# allow-list: the table and column names below go into SQL text, so they must never come
# from the request. ADJUSTABLE: add a layer here (and its id property) to expose it.
BOUNDARY_LAYERS: dict[str, tuple[str, ...]] = {
    "zip_codes": ("zip_code",),
    "police_precincts": ("precinct", "name"),
    "council_districts": ("district_number", "council_member", "name"),
    "neighborhoods": ("name",),
}


@router.get("/{slug}/boundaries/{layer}")
async def get_boundaries(slug: str, layer: str, session: AsyncSession = Depends(get_async_session)):
    """O(n) time, O(n) space — n = polygons of this layer in this city (dozens).

    One city's polygons for one boundary layer as a GeoJSON FeatureCollection. Rows are
    filtered by the city's id, so Detroit's precincts never appear on another city's panel.
    """
    columns = BOUNDARY_LAYERS.get(layer)
    if columns is None:
        raise HTTPException(status_code=404, detail=f"Unknown boundary layer '{layer}'")
    # O(c) time, O(c) space — c = properties (1–3)
    props = ", ".join(f"'{c}', t.{c}" for c in columns)
    sql = text(f"""
        SELECT json_build_object(
            'type', 'FeatureCollection',
            'features', COALESCE(json_agg(json_build_object(
                'type', 'Feature',
                'geometry', ST_AsGeoJSON(t.geom, 6)::json,
                'properties', json_build_object({props})
            )), '[]'::json)
        )
        FROM {layer} t JOIN cities c ON c.id = t.city_id
        WHERE c.slug = :slug
    """)
    city = (await session.execute(select(City.id).where(City.slug == slug))).first()
    if not city:
        raise HTTPException(status_code=404, detail=f"City '{slug}' not found")
    return (await session.execute(sql, {"slug": slug})).scalar_one()
