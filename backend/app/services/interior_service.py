"""CRUD service for interior map data (rooms, walls, features, sources)."""

import uuid

from geoalchemy2.shape import from_shape
from shapely.geometry import shape
from sqlalchemy import delete, func, select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interior_feature import InteriorFeature
from app.models.interior_room import InteriorRoom
from app.models.interior_source import InteriorSource
from app.models.interior_wall import InteriorWall
from app.schemas.interior import (
    InteriorFeatureCreateRequest,
    InteriorRoomCreateRequest,
    InteriorSourceCreateRequest,
    InteriorSummaryResponse,
    InteriorWallCreateRequest,
)


class InteriorService:
    """Static async methods for interior data CRUD."""

    # ── Sources ─────────────────────────────────────────────────

    @staticmethod
    async def get_sources(building_id: uuid.UUID, session: AsyncSession) -> list[InteriorSource]:
        stmt = (
            select(InteriorSource)
            .where(InteriorSource.building_id == building_id)
            .order_by(InteriorSource.created_at.desc())
        )
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def create_source(
        building_id: uuid.UUID,
        city_id: uuid.UUID,
        data: InteriorSourceCreateRequest,
        session: AsyncSession,
    ) -> InteriorSource:
        source = InteriorSource(
            building_id=building_id,
            city_id=city_id,
            source_type=data.source_type,
            source_url=data.source_url,
            source_date=data.source_date,
            raster_url=data.raster_url,
            confidence=data.confidence or 0.0,
            status="raw",
        )
        session.add(source)
        await session.commit()
        await session.refresh(source)
        return source

    @staticmethod
    async def update_source_status(
        source_id: uuid.UUID, status: str, session: AsyncSession
    ) -> InteriorSource | None:
        stmt = select(InteriorSource).where(InteriorSource.id == source_id)
        result = await session.execute(stmt)
        source = result.scalar_one_or_none()
        if not source:
            return None
        source.status = status
        await session.commit()
        await session.refresh(source)
        return source

    # ── Rooms ───────────────────────────────────────────────────

    @staticmethod
    async def get_rooms(
        building_id: uuid.UUID, session: AsyncSession, level: int | None = None
    ) -> list[InteriorRoom]:
        stmt = select(InteriorRoom).where(InteriorRoom.building_id == building_id)
        if level is not None:
            stmt = stmt.where(InteriorRoom.level == level)
        stmt = stmt.order_by(InteriorRoom.level, InteriorRoom.name)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def create_room(
        building_id: uuid.UUID, data: InteriorRoomCreateRequest, session: AsyncSession
    ) -> InteriorRoom:
        geom_shape = shape(data.geom)
        room = InteriorRoom(
            building_id=building_id,
            level=data.level,
            room_type=data.room_type,
            name=data.name,
            area_sqm=data.area_sqm,
            capacity=data.capacity,
            geom=from_shape(geom_shape, srid=4326),
        )
        session.add(room)
        await session.commit()
        await session.refresh(room)
        return room

    @staticmethod
    async def delete_room(room_id: uuid.UUID, session: AsyncSession) -> bool:
        stmt = delete(InteriorRoom).where(InteriorRoom.id == room_id)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0

    # ── Walls ───────────────────────────────────────────────────

    @staticmethod
    async def get_walls(
        building_id: uuid.UUID, session: AsyncSession, level: int | None = None
    ) -> list[InteriorWall]:
        stmt = select(InteriorWall).where(InteriorWall.building_id == building_id)
        if level is not None:
            stmt = stmt.where(InteriorWall.level == level)
        stmt = stmt.order_by(InteriorWall.level)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def create_wall(
        building_id: uuid.UUID, data: InteriorWallCreateRequest, session: AsyncSession
    ) -> InteriorWall:
        geom_shape = shape(data.geom)
        wall = InteriorWall(
            building_id=building_id,
            level=data.level,
            wall_type=data.wall_type or "interior",
            material=data.material,
            thickness_m=data.thickness_m,
            geom=from_shape(geom_shape, srid=4326),
        )
        session.add(wall)
        await session.commit()
        await session.refresh(wall)
        return wall

    @staticmethod
    async def delete_wall(wall_id: uuid.UUID, session: AsyncSession) -> bool:
        stmt = delete(InteriorWall).where(InteriorWall.id == wall_id)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0

    # ── Features ────────────────────────────────────────────────

    @staticmethod
    async def get_features(
        building_id: uuid.UUID, session: AsyncSession, level: int | None = None
    ) -> list[InteriorFeature]:
        stmt = select(InteriorFeature).where(InteriorFeature.building_id == building_id)
        if level is not None:
            stmt = stmt.where(InteriorFeature.level == level)
        stmt = stmt.order_by(InteriorFeature.level, InteriorFeature.feature_type)
        result = await session.execute(stmt)
        return list(result.scalars().all())

    @staticmethod
    async def create_feature(
        building_id: uuid.UUID, data: InteriorFeatureCreateRequest, session: AsyncSession
    ) -> InteriorFeature:
        geom_shape = shape(data.geom)
        feature = InteriorFeature(
            building_id=building_id,
            level=data.level,
            feature_type=data.feature_type,
            name=data.name,
            geom=from_shape(geom_shape, srid=4326),
        )
        session.add(feature)
        await session.commit()
        await session.refresh(feature)
        return feature

    @staticmethod
    async def delete_feature(feature_id: uuid.UUID, session: AsyncSession) -> bool:
        stmt = delete(InteriorFeature).where(InteriorFeature.id == feature_id)
        result = await session.execute(stmt)
        await session.commit()
        return result.rowcount > 0

    # ── Summary ─────────────────────────────────────────────────

    @staticmethod
    async def get_summary(building_id: uuid.UUID, session: AsyncSession) -> InteriorSummaryResponse:
        source_count = await session.scalar(
            select(func.count()).where(InteriorSource.building_id == building_id)
        )
        room_count = await session.scalar(
            select(func.count()).where(InteriorRoom.building_id == building_id)
        )
        wall_count = await session.scalar(
            select(func.count()).where(InteriorWall.building_id == building_id)
        )
        feature_count = await session.scalar(
            select(func.count()).where(InteriorFeature.building_id == building_id)
        )
        return InteriorSummaryResponse(
            building_id=building_id,
            source_count=source_count or 0,
            room_count=room_count or 0,
            wall_count=wall_count or 0,
            feature_count=feature_count or 0,
            has_extracted_data=(room_count or 0) > 0 or (wall_count or 0) > 0,
        )
