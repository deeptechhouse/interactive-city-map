"""Unit tests for ContributionService: voting, reporting, and moderation."""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest

from tests.conftest import AttrDict, MockResult, make_mock_session


# ---------------------------------------------------------------------------
# Fixed UUIDs
# ---------------------------------------------------------------------------
SOURCE_ID = uuid.UUID("00000000-0000-4000-8000-000000000020")


# ---------------------------------------------------------------------------
# Sample factory
# ---------------------------------------------------------------------------

def make_sample_source(**overrides):
    defaults = dict(
        id=SOURCE_ID,
        building_id=uuid.UUID("00000000-0000-4000-8000-000000000002"),
        city_id=uuid.UUID("00000000-0000-4000-8000-000000000001"),
        source_type="upload",
        source_url=None,
        source_date=None,
        fetch_date=None,
        raw_data=None,
        raster_url="http://localhost:9000/test.png",
        geojson=None,
        confidence=0.5,
        status="raw",
        created_at=None,
        updated_at=None,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


# ===========================================================================
# Vote tests
# ===========================================================================

class TestContributionServiceVote:
    """Tests for ContributionService.vote()."""

    @pytest.mark.asyncio
    async def test_upvote_increases_confidence(self):
        session = make_mock_session()
        source = make_sample_source(confidence=0.5)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "up", session)
        assert result is not None
        assert abs(source.confidence - 0.55) < 1e-9
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_downvote_decreases_confidence(self):
        session = make_mock_session()
        source = make_sample_source(confidence=0.5)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "down", session)
        assert result is not None
        assert abs(source.confidence - 0.45) < 1e-9

    @pytest.mark.asyncio
    async def test_upvote_clamped_at_1(self):
        session = make_mock_session()
        source = make_sample_source(confidence=0.98)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "up", session)
        assert result is not None
        assert source.confidence <= 1.0

    @pytest.mark.asyncio
    async def test_downvote_clamped_at_0(self):
        session = make_mock_session()
        source = make_sample_source(confidence=0.02)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "down", session)
        assert result is not None
        assert source.confidence >= 0.0

    @pytest.mark.asyncio
    async def test_vote_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "up", session)
        assert result is None
        session.commit.assert_not_called()

    @pytest.mark.asyncio
    async def test_upvote_from_zero(self):
        session = make_mock_session()
        source = make_sample_source(confidence=0.0)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "up", session)
        assert abs(source.confidence - 0.05) < 1e-9

    @pytest.mark.asyncio
    async def test_downvote_from_zero_stays_zero(self):
        session = make_mock_session()
        source = make_sample_source(confidence=0.0)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "down", session)
        assert source.confidence == 0.0

    @pytest.mark.asyncio
    async def test_vote_with_none_confidence_treated_as_zero(self):
        session = make_mock_session()
        source = make_sample_source(confidence=None)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.vote(SOURCE_ID, "up", session)
        assert abs(source.confidence - 0.05) < 1e-9


# ===========================================================================
# Report tests
# ===========================================================================

class TestContributionServiceReport:
    """Tests for ContributionService.report()."""

    @pytest.mark.asyncio
    async def test_report_sets_status(self):
        session = make_mock_session()
        source = make_sample_source(status="raw")
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.report(SOURCE_ID, "Inaccurate data", session)
        assert result is not None
        assert source.status == "reported"

    @pytest.mark.asyncio
    async def test_report_stores_reason(self):
        session = make_mock_session()
        source = make_sample_source(status="raw", raw_data=None)
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.report(SOURCE_ID, "Spam content", session)
        assert source.raw_data["report_reason"] == "Spam content"
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_report_preserves_existing_raw_data(self):
        session = make_mock_session()
        source = make_sample_source(raw_data={"existing_key": "value"})
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.report(SOURCE_ID, "Bad data", session)
        assert source.raw_data["existing_key"] == "value"
        assert source.raw_data["report_reason"] == "Bad data"

    @pytest.mark.asyncio
    async def test_report_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.report(SOURCE_ID, "reason", session)
        assert result is None
        session.commit.assert_not_called()


# ===========================================================================
# Moderate tests
# ===========================================================================

class TestContributionServiceModerate:
    """Tests for ContributionService.moderate()."""

    @pytest.mark.asyncio
    async def test_moderate_approve(self):
        session = make_mock_session()
        source = make_sample_source(status="reported")
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.moderate(SOURCE_ID, "approve", session)
        assert result is not None
        assert source.status == "verified"
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_moderate_reject(self):
        session = make_mock_session()
        source = make_sample_source(status="reported")
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.moderate(SOURCE_ID, "reject", session)
        assert result is not None
        assert source.status == "rejected"
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_moderate_takedown(self):
        session = make_mock_session()
        source = make_sample_source(status="reported")
        session.execute.return_value = MockResult(scalar=source)
        session.delete = AsyncMock()
        from app.services.contribution_service import ContributionService

        result = await ContributionService.moderate(SOURCE_ID, "takedown", session)
        assert result is None
        session.delete.assert_called_once_with(source)
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_moderate_unknown_action_returns_unchanged(self):
        session = make_mock_session()
        source = make_sample_source(status="reported")
        session.execute.return_value = MockResult(scalar=source)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.moderate(SOURCE_ID, "unknown_action", session)
        assert result is not None
        assert source.status == "reported"  # unchanged

    @pytest.mark.asyncio
    async def test_moderate_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)
        from app.services.contribution_service import ContributionService

        result = await ContributionService.moderate(SOURCE_ID, "approve", session)
        assert result is None
        session.commit.assert_not_called()
