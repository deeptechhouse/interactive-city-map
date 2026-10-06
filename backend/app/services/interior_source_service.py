"""Service for interior source management and confidence scoring."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interior_source import InteriorSource


class InteriorSourceService:
    """Manages interior data sources with confidence scoring."""

    _BASE_CONFIDENCE = {
        "sanborn": 0.6,
        "venue_scrape": 0.4,
        "upload": 0.3,
        "osm": 0.7,
        "county_records": 0.5,
    }

    @staticmethod
    # O(1) time, O(1) space
    def compute_confidence(source: InteriorSource) -> float:
        """Compute confidence score for a source based on type and data completeness."""
        base = InteriorSourceService._BASE_CONFIDENCE.get(source.source_type, 0.3)
        boost = 0.0
        if source.raster_url:
            boost += 0.1
        if source.geojson:
            boost += 0.15
        if source.source_url:
            boost += 0.05
        return min(base + boost, 1.0)

    @staticmethod
    # O(log N + k) time, O(k) space — N = interior_sources rows; k = matching sources
    async def get_sources_by_type(
        building_id: uuid.UUID, source_type: str, session: AsyncSession
    ) -> list[InteriorSource]:
        stmt = select(InteriorSource).where(
            InteriorSource.building_id == building_id,
            InteriorSource.source_type == source_type,
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    # O(log N + k) time, O(k) space — N = interior_sources rows; k = sources returned (≤ limit when given)
    async def get_sources_by_status(
        status: str,
        session: AsyncSession,
        city_id: uuid.UUID | None = None,
        limit: int | None = None,
    ) -> list[InteriorSource]:
        """``limit`` is applied in SQL so a page never loads the whole status bucket."""
        stmt = select(InteriorSource).where(InteriorSource.status == status)
        if city_id is not None:
            stmt = stmt.where(InteriorSource.city_id == city_id)
        if limit is not None:
            stmt = stmt.limit(max(limit, 0))
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    # O(log N) time, O(1) space — N = interior_sources rows, primary-key lookup
    async def mark_extracted(
        source_id: uuid.UUID, geojson_data: dict, session: AsyncSession
    ) -> InteriorSource | None:
        stmt = select(InteriorSource).where(InteriorSource.id == source_id)
        result = await session.execute(stmt)
        source = result.scalar_one_or_none()
        if not source:
            return None
        source.status = "extracted"
        source.geojson = geojson_data
        source.confidence = InteriorSourceService.compute_confidence(source)
        await session.commit()
        await session.refresh(source)
        return source
