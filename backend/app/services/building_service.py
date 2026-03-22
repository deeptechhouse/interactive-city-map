import json
import uuid
from typing import Any

from geoalchemy2.functions import ST_AsGeoJSON, ST_Intersects, ST_MakeEnvelope
from sqlalchemy import select, func
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.building import Building
from app.models.city import City
from app.schemas.building import BuildingResponse, BuildingListResponse


class BuildingService:
    """Service layer for building operations."""

    @staticmethod
    def _model_to_response(building: Building) -> BuildingResponse:
        """Convert a Building model instance to a BuildingResponse schema."""
        geom_json = None
        if building.geom is not None:
            # ST_AsGeoJSON returns a string; we need to parse it if it was loaded
            raw = building._geom_geojson if hasattr(building, "_geom_geojson") else None
            if raw:
                geom_json = json.loads(raw) if isinstance(raw, str) else raw

        return BuildingResponse(
            id=building.id,
            city_id=building.city_id,
            parcel_pin=building.parcel_pin,
            geom=geom_json,
            address=building.address,
            name=building.name,
            zoning_code=building.zoning_code,
            zoning_desc=building.zoning_desc,
            year_built=building.year_built,
            floors=building.floors,
            sq_ft=building.sq_ft,
            owner_name=building.owner_name,
            owner_type=building.owner_type,
            property_class=building.property_class,
            has_interior=building.has_interior,
            is_hidden=building.is_hidden,
            external_links=building.external_links,
            metadata=building.metadata_,
            created_at=building.created_at,
            updated_at=building.updated_at,
        )

    @staticmethod
    async def get_by_id(session: AsyncSession, building_id: uuid.UUID) -> BuildingResponse | None:
        """Retrieve a single building by its ID, with geometry as GeoJSON."""
        stmt = select(
            Building,
            ST_AsGeoJSON(Building.geom).label("geom_geojson"),
        ).where(Building.id == building_id)

        result = await session.execute(stmt)
        row = result.first()
        if row is None:
            return None

        building, geom_geojson = row
        building._geom_geojson = geom_geojson
        return BuildingService._model_to_response(building)

    @staticmethod
    async def get_by_bbox(
        session: AsyncSession,
        city_slug: str,
        bbox: list[float],
    ) -> BuildingListResponse:
        """Retrieve buildings within a bounding box for a given city.

        Args:
            session: Async database session.
            city_slug: The city slug to filter by.
            bbox: [west, south, east, north] in WGS84.

        Returns:
            BuildingListResponse with matching buildings.
        """
        west, south, east, north = bbox
        envelope = ST_MakeEnvelope(west, south, east, north, 4326)

        stmt = (
            select(
                Building,
                ST_AsGeoJSON(Building.geom).label("geom_geojson"),
            )
            .join(City, Building.city_id == City.id)
            .where(
                City.slug == city_slug,
                Building.is_hidden == False,  # noqa: E712
                ST_Intersects(Building.geom, envelope),
            )
        )

        result = await session.execute(stmt)
        rows = result.all()

        buildings = []
        for building, geom_geojson in rows:
            building._geom_geojson = geom_geojson
            buildings.append(BuildingService._model_to_response(building))

        return BuildingListResponse(buildings=buildings, total=len(buildings))

    @staticmethod
    async def update_hidden(
        session: AsyncSession,
        building_id: uuid.UUID,
        is_hidden: bool,
    ) -> BuildingResponse | None:
        """Update the is_hidden flag on a building."""
        stmt = select(Building).where(Building.id == building_id)
        result = await session.execute(stmt)
        building = result.scalar_one_or_none()
        if building is None:
            return None

        building.is_hidden = is_hidden
        await session.commit()
        await session.refresh(building)

        # Re-fetch with geometry
        return await BuildingService.get_by_id(session, building_id)

    @staticmethod
    async def update_external_links(
        session: AsyncSession,
        building_id: uuid.UUID,
        links: dict[str, Any],
    ) -> BuildingResponse | None:
        """Update the external_links JSONB on a building."""
        stmt = select(Building).where(Building.id == building_id)
        result = await session.execute(stmt)
        building = result.scalar_one_or_none()
        if building is None:
            return None

        building.external_links = links
        await session.commit()
        await session.refresh(building)

        return await BuildingService.get_by_id(session, building_id)
