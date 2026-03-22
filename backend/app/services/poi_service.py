import json
import uuid
from typing import Any

from geoalchemy2 import WKTElement
from geoalchemy2.functions import ST_AsGeoJSON, ST_Intersects, ST_MakeEnvelope
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.poi import POI
from app.models.city import City
from app.schemas.poi import POIResponse, POIListResponse, POICreateRequest


class POIService:
    """Service layer for POI operations."""

    @staticmethod
    def _model_to_response(poi: POI, geom_geojson: str | None = None) -> POIResponse:
        """Convert a POI model instance to a POIResponse schema."""
        geom_json = None
        if geom_geojson:
            geom_json = json.loads(geom_geojson) if isinstance(geom_geojson, str) else geom_geojson

        return POIResponse(
            id=poi.id,
            city_id=poi.city_id,
            building_id=poi.building_id,
            geom=geom_json,
            name=poi.name,
            category=poi.category,
            subcategory=poi.subcategory,
            address=poi.address,
            phone=poi.phone,
            website=poi.website,
            hours=poi.hours,
            description=poi.description,
            event_facilities=poi.event_facilities,
            unit_count=poi.unit_count,
            source=poi.source,
            source_id=poi.source_id,
            verified=poi.verified,
            metadata=poi.metadata_,
            created_at=poi.created_at,
            updated_at=poi.updated_at,
        )

    @staticmethod
    async def get_by_bbox(
        session: AsyncSession,
        city_slug: str,
        bbox: list[float],
        category: str | None = None,
    ) -> POIListResponse:
        """Retrieve POIs within a bounding box, optionally filtered by category.

        Args:
            session: Async database session.
            city_slug: The city slug to filter by.
            bbox: [west, south, east, north] in WGS84.
            category: Optional category filter.

        Returns:
            POIListResponse with matching POIs.
        """
        west, south, east, north = bbox
        envelope = ST_MakeEnvelope(west, south, east, north, 4326)

        stmt = (
            select(
                POI,
                ST_AsGeoJSON(POI.geom).label("geom_geojson"),
            )
            .join(City, POI.city_id == City.id)
            .where(
                City.slug == city_slug,
                ST_Intersects(POI.geom, envelope),
            )
        )

        if category is not None:
            stmt = stmt.where(POI.category == category)

        result = await session.execute(stmt)
        rows = result.all()

        pois = []
        for poi, geom_geojson in rows:
            pois.append(POIService._model_to_response(poi, geom_geojson))

        return POIListResponse(pois=pois, total=len(pois))

    @staticmethod
    async def create_poi(session: AsyncSession, data: POICreateRequest) -> POIResponse:
        """Create a new POI from the request data.

        Args:
            session: Async database session.
            data: POI creation data including GeoJSON geometry.

        Returns:
            The created POI as a POIResponse.
        """
        # Convert GeoJSON geometry to WKT for insertion
        coords = data.geom.get("coordinates", [])
        if len(coords) >= 2:
            wkt = f"POINT({coords[0]} {coords[1]})"
        else:
            raise ValueError("Invalid GeoJSON Point: must have at least 2 coordinates")

        poi = POI(
            city_id=data.city_id,
            building_id=data.building_id,
            geom=WKTElement(wkt, srid=4326),
            name=data.name,
            category=data.category,
            subcategory=data.subcategory,
            address=data.address,
            phone=data.phone,
            website=data.website,
            hours=data.hours,
            description=data.description,
            event_facilities=data.event_facilities,
            unit_count=data.unit_count,
            source=data.source,
            source_id=data.source_id,
            metadata_=data.metadata,
        )

        session.add(poi)
        await session.commit()
        await session.refresh(poi)

        # Re-fetch with geometry as GeoJSON
        stmt = select(
            POI,
            ST_AsGeoJSON(POI.geom).label("geom_geojson"),
        ).where(POI.id == poi.id)
        result = await session.execute(stmt)
        row = result.first()
        poi_obj, geom_geojson = row
        return POIService._model_to_response(poi_obj, geom_geojson)

    @staticmethod
    async def get_by_building(
        session: AsyncSession,
        building_id: uuid.UUID,
    ) -> POIListResponse:
        """Retrieve all POIs associated with a specific building.

        Args:
            session: Async database session.
            building_id: The building UUID to filter by.

        Returns:
            POIListResponse with matching POIs.
        """
        stmt = select(
            POI,
            ST_AsGeoJSON(POI.geom).label("geom_geojson"),
        ).where(POI.building_id == building_id)

        result = await session.execute(stmt)
        rows = result.all()

        pois = []
        for poi, geom_geojson in rows:
            pois.append(POIService._model_to_response(poi, geom_geojson))

        return POIListResponse(pois=pois, total=len(pois))
