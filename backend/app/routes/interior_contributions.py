"""Contribution and moderation endpoints for interior map data."""

import uuid
from typing import Optional

from fastapi import APIRouter, Depends, HTTPException, Response
from pydantic import BaseModel
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.database import get_async_session
from app.models import Building, InteriorSource
from app.services.contribution_service import ContributionService
from app.services.interior_source_service import InteriorSourceService

router = APIRouter(tags=["interior_contributions"])


# ── Helpers ─────────────────────────────────────────────────────


def _source_to_dict(s: InteriorSource) -> dict:
    return {
        "id": s.id,
        "building_id": s.building_id,
        "city_id": s.city_id,
        "source_type": s.source_type,
        "source_url": s.source_url,
        "source_date": s.source_date,
        "fetch_date": s.fetch_date,
        "raw_data": s.raw_data,
        "raster_url": s.raster_url,
        "geojson": s.geojson,
        "confidence": s.confidence,
        "status": s.status,
        "created_at": s.created_at,
        "updated_at": s.updated_at,
    }


async def _require_building(building_id: uuid.UUID, session: AsyncSession) -> Building:
    stmt = select(Building).where(Building.id == building_id)
    result = await session.execute(stmt)
    building = result.scalar_one_or_none()
    if not building:
        raise HTTPException(status_code=404, detail="Building not found")
    return building


# ── Request schemas ─────────────────────────────────────────────


class VoteRequest(BaseModel):
    vote: str  # "up" or "down"


class ReportRequest(BaseModel):
    reason: str


class ModerationActionRequest(BaseModel):
    action: str  # "approve", "reject", or "takedown"


# ── Community contribution endpoints ────────────────────────────


@router.post("/buildings/{building_id}/interior/contributions/verify/{source_id}")
async def vote_on_source(
    building_id: uuid.UUID,
    source_id: uuid.UUID,
    data: VoteRequest,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    if data.vote not in ("up", "down"):
        raise HTTPException(status_code=400, detail="Vote must be 'up' or 'down'")
    source = await ContributionService.vote(source_id, data.vote, session)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return _source_to_dict(source)


@router.post("/buildings/{building_id}/interior/contributions/report/{source_id}")
async def report_source(
    building_id: uuid.UUID,
    source_id: uuid.UUID,
    data: ReportRequest,
    session: AsyncSession = Depends(get_async_session),
):
    await _require_building(building_id, session)
    source = await ContributionService.report(source_id, data.reason, session)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return {"status": "reported", "source_id": str(source_id)}


# ── Admin moderation endpoints ──────────────────────────────────


@router.get("/admin/interior/moderation")
async def list_moderation_queue(
    status: str = "reported",
    limit: int = 50,
    session: AsyncSession = Depends(get_async_session),
):
    sources = await InteriorSourceService.get_sources_by_status(status, session)
    return [_source_to_dict(s) for s in sources[:limit]]


@router.patch("/admin/interior/moderation/{source_id}")
async def moderate_source(
    source_id: uuid.UUID,
    data: ModerationActionRequest,
    session: AsyncSession = Depends(get_async_session),
):
    if data.action not in ("approve", "reject", "takedown"):
        raise HTTPException(
            status_code=400, detail="Action must be 'approve', 'reject', or 'takedown'"
        )

    if data.action == "takedown":
        result = await ContributionService.moderate(source_id, data.action, session)
        # moderate returns None for takedown (source deleted)
        return Response(status_code=204)

    source = await ContributionService.moderate(source_id, data.action, session)
    if not source:
        raise HTTPException(status_code=404, detail="Source not found")
    return _source_to_dict(source)
