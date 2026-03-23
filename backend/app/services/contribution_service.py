"""Service for community contributions: voting, reporting, and moderation."""

import uuid

from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.models.interior_source import InteriorSource


class ContributionService:
    """Handles community votes, reports, and admin moderation actions."""

    @staticmethod
    async def vote(
        source_id: uuid.UUID, vote: str, session: AsyncSession
    ) -> InteriorSource | None:
        """Adjust source confidence by ±0.05 based on community vote."""
        stmt = select(InteriorSource).where(InteriorSource.id == source_id)
        result = await session.execute(stmt)
        source = result.scalar_one_or_none()
        if not source:
            return None

        delta = 0.05 if vote == "up" else -0.05
        current = source.confidence or 0.0
        source.confidence = max(0.0, min(1.0, current + delta))
        await session.commit()
        await session.refresh(source)
        return source

    @staticmethod
    async def report(
        source_id: uuid.UUID, reason: str, session: AsyncSession
    ) -> InteriorSource | None:
        """Flag a source as reported with a reason stored in raw_data."""
        stmt = select(InteriorSource).where(InteriorSource.id == source_id)
        result = await session.execute(stmt)
        source = result.scalar_one_or_none()
        if not source:
            return None

        source.status = "reported"
        raw = source.raw_data or {}
        raw["report_reason"] = reason
        source.raw_data = raw
        await session.commit()
        await session.refresh(source)
        return source

    @staticmethod
    async def moderate(
        source_id: uuid.UUID, action: str, session: AsyncSession
    ) -> InteriorSource | None:
        """Apply a moderation action: approve, reject, or takedown."""
        stmt = select(InteriorSource).where(InteriorSource.id == source_id)
        result = await session.execute(stmt)
        source = result.scalar_one_or_none()
        if not source:
            return None

        if action == "approve":
            source.status = "verified"
            await session.commit()
            await session.refresh(source)
            return source
        elif action == "reject":
            source.status = "rejected"
            await session.commit()
            await session.refresh(source)
            return source
        elif action == "takedown":
            await session.delete(source)
            await session.commit()
            return None
        else:
            return source
