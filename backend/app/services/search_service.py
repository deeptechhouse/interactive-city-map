import json

from geoalchemy2.functions import ST_AsGeoJSON, ST_Intersects, ST_MakeEnvelope
from sqlalchemy import select, func, literal, union_all, Float, cast, Text
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.building import Building
from app.models.poi import POI
from app.models.city import City
from app.schemas.search import SearchRequest, SearchResponse, SearchResultItem


class SearchService:
    """Service layer for combined building + POI search using FTS, trigram, and spatial filters."""

    @staticmethod
    async def search(
        session: AsyncSession,
        city_slug: str,
        query: str,
        category: str | None = None,
        zoning: str | None = None,
        bbox: list[float] | None = None,
        has_interior: bool | None = None,
    ) -> SearchResponse:
        """Execute a combined search across buildings and POIs.

        Uses PostgreSQL full-text search (tsvector) for POIs and trigram similarity
        for buildings. Results are ranked by relevance and optionally filtered by
        category, zoning code, and bounding box.

        Args:
            session: Async database session.
            city_slug: City slug to scope the search.
            query: Free-text search query.
            category: Optional POI category filter.
            zoning: Optional building zoning code filter.
            bbox: Optional [west, south, east, north] bounding box filter.

        Returns:
            SearchResponse with combined, ranked results.
        """
        ts_query = func.plainto_tsquery("english", query)

        # --- POI subquery: full-text search ---
        poi_stmt = (
            select(
                POI.id,
                literal("poi").label("result_type"),
                POI.name,
                POI.address,
                POI.category.label("category"),
                literal(None).label("zoning_code"),
                ST_AsGeoJSON(POI.geom).label("geom_geojson"),
                func.ts_rank(POI.search_vector, ts_query).label("rank"),
            )
            .join(City, POI.city_id == City.id)
            .where(
                City.slug == city_slug,
                POI.search_vector.op("@@")(ts_query),
            )
        )

        if category is not None:
            poi_stmt = poi_stmt.where(POI.category == category)

        if bbox is not None:
            west, south, east, north = bbox
            envelope = ST_MakeEnvelope(west, south, east, north, 4326)
            poi_stmt = poi_stmt.where(ST_Intersects(POI.geom, envelope))

        # --- Building subquery: trigram similarity on name + address ---
        building_rank = func.greatest(
            func.coalesce(func.similarity(Building.name, query), 0.0),
            func.coalesce(func.similarity(Building.address, query), 0.0),
        ).label("rank")

        building_stmt = (
            select(
                Building.id,
                literal("building").label("result_type"),
                Building.name,
                Building.address,
                literal(None).label("category"),
                Building.zoning_code.label("zoning_code"),
                ST_AsGeoJSON(Building.geom).label("geom_geojson"),
                building_rank,
            )
            .join(City, Building.city_id == City.id)
            .where(
                City.slug == city_slug,
                Building.is_hidden == False,  # noqa: E712
                func.greatest(
                    func.coalesce(func.similarity(Building.name, query), 0.0),
                    func.coalesce(func.similarity(Building.address, query), 0.0),
                ) > 0.1,
            )
        )

        if zoning is not None:
            building_stmt = building_stmt.where(Building.zoning_code == zoning)

        if has_interior is True:
            building_stmt = building_stmt.where(Building.has_interior == True)  # noqa: E712

        if bbox is not None:
            west, south, east, north = bbox
            envelope = ST_MakeEnvelope(west, south, east, north, 4326)
            building_stmt = building_stmt.where(ST_Intersects(Building.geom, envelope))

        # --- Combine and order by rank ---
        combined = union_all(poi_stmt, building_stmt).subquery()
        final_stmt = (
            select(combined)
            .order_by(combined.c.rank.desc())
            .limit(100)
        )

        result = await session.execute(final_stmt)
        rows = result.all()

        items = []
        for row in rows:
            geom_json = None
            if row.geom_geojson:
                geom_json = json.loads(row.geom_geojson) if isinstance(row.geom_geojson, str) else row.geom_geojson

            items.append(
                SearchResultItem(
                    id=row.id,
                    result_type=row.result_type,
                    name=row.name,
                    address=row.address,
                    category=row.category,
                    zoning_code=row.zoning_code,
                    geom=geom_json,
                    rank=float(row.rank) if row.rank is not None else None,
                )
            )

        return SearchResponse(results=items, total=len(items), query=query)
