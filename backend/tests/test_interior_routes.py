"""Integration tests for interior API route endpoints.

Uses the synchronous TestClient. Database calls are mocked at the dependency
level so tests run without a live PostgreSQL+PostGIS instance.
"""

import uuid
from unittest.mock import AsyncMock, MagicMock

import pytest
from fastapi.testclient import TestClient

from app.database import get_async_session
from app.main import app
from tests.conftest import (
    BUILDING_ID,
    CITY_ID,
    FLOOR_PLAN_ID,
    NOW,
    AttrDict,
    MockResult,
    make_mock_session,
)


# ---------------------------------------------------------------------------
# Fixed UUIDs
# ---------------------------------------------------------------------------
SOURCE_ID = uuid.UUID("00000000-0000-4000-8000-000000000010")
ROOM_ID = uuid.UUID("00000000-0000-4000-8000-000000000011")
WALL_ID = uuid.UUID("00000000-0000-4000-8000-000000000012")
FEATURE_ID = uuid.UUID("00000000-0000-4000-8000-000000000013")


# ---------------------------------------------------------------------------
# Sample object factories
# ---------------------------------------------------------------------------

def make_sample_building(**overrides):
    defaults = dict(
        id=BUILDING_ID,
        city_id=CITY_ID,
        parcel_pin="17-03-222-001",
        geom="fake-geom",
        address="233 S Wacker Dr",
        name="Willis Tower",
        zoning_code="DC",
        zoning_desc="Downtown Core",
        year_built=1973,
        floors=110,
        sq_ft=4477800,
        owner_name="Blackstone Group",
        owner_type="corporate",
        property_class="commercial",
        has_interior=True,
        is_hidden=False,
        external_links=None,
        metadata_=None,
        metadata=None,
        created_at=NOW,
        updated_at=NOW,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


def make_sample_source(**overrides):
    defaults = dict(
        id=SOURCE_ID,
        building_id=BUILDING_ID,
        city_id=CITY_ID,
        source_type="upload",
        source_url=None,
        source_date=None,
        fetch_date=NOW,
        raw_data=None,
        raster_url="http://localhost:9000/test.png",
        geojson=None,
        confidence=0.3,
        status="raw",
        created_at=NOW,
        updated_at=NOW,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


def make_sample_room(**overrides):
    defaults = dict(
        id=ROOM_ID,
        building_id=BUILDING_ID,
        floor_plan_id=None,
        source_id=SOURCE_ID,
        level=0,
        room_type="office",
        name="Main Office",
        area_sqm=25.0,
        capacity=10,
        metadata_=None,
        geom=None,
        created_at=NOW,
        updated_at=NOW,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


def make_sample_wall(**overrides):
    defaults = dict(
        id=WALL_ID,
        building_id=BUILDING_ID,
        floor_plan_id=None,
        source_id=SOURCE_ID,
        level=0,
        wall_type="interior",
        material="drywall",
        thickness_m=0.15,
        geom=None,
        created_at=NOW,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


def make_sample_feature(**overrides):
    defaults = dict(
        id=FEATURE_ID,
        building_id=BUILDING_ID,
        floor_plan_id=None,
        source_id=SOURCE_ID,
        level=0,
        feature_type="door",
        name="Main Entrance",
        metadata_=None,
        geom=None,
        created_at=NOW,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


# ---------------------------------------------------------------------------
# Helper: override session dependency
# ---------------------------------------------------------------------------

def _override_session(mock_session):
    async def _fake():
        yield mock_session
    app.dependency_overrides[get_async_session] = _fake


def _cleanup():
    app.dependency_overrides.clear()


# ===========================================================================
# Source route tests
# ===========================================================================

class TestInteriorSourceRoutes:
    """Tests for /buildings/{id}/interior/sources and /interior/sources/{id}/* routes."""

    def test_list_sources(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        source = make_sample_source()
        # First execute: _require_building; Second execute: get_sources
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=building),
                MockResult(rows=[source]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/sources")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["id"] == str(SOURCE_ID)
            assert data[0]["source_type"] == "upload"
        finally:
            _cleanup()

    def test_list_sources_building_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/sources")
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_list_sources_empty(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=building),
                MockResult(rows=[]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/sources")
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            _cleanup()

    def test_create_source(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        created_source = make_sample_source(source_type="sanborn", confidence=0.0, status="raw")

        mock_session.execute = AsyncMock(return_value=MockResult(scalar=building))
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()

        async def fake_refresh(obj):
            for k, v in vars(created_source).items():
                setattr(obj, k, v)

        mock_session.refresh = fake_refresh
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.post(
                f"/api/v1/buildings/{BUILDING_ID}/interior/sources",
                json={"source_type": "sanborn", "confidence": 0.6},
            )
            assert resp.status_code == 201
            data = resp.json()
            assert data["building_id"] == str(BUILDING_ID)
        finally:
            _cleanup()

    def test_update_source_status(self):
        mock_session = AsyncMock()
        source = make_sample_source(status="raw")
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=source))
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.patch(
                f"/api/v1/interior/sources/{SOURCE_ID}/status",
                json={"status": "extracted"},
            )
            assert resp.status_code == 200
            assert source.status == "extracted"
        finally:
            _cleanup()

    def test_update_source_status_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.patch(
                f"/api/v1/interior/sources/{SOURCE_ID}/status",
                json={"status": "extracted"},
            )
            assert resp.status_code == 404
        finally:
            _cleanup()


# ===========================================================================
# Room route tests
# ===========================================================================

class TestInteriorRoomRoutes:
    """Tests for /buildings/{id}/interior/rooms and /interior/rooms/{id} routes."""

    def test_list_rooms(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        room = make_sample_room()
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=building),
                MockResult(rows=[room]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/rooms")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["name"] == "Main Office"
        finally:
            _cleanup()

    def test_list_rooms_with_level_param(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=building),
                MockResult(rows=[]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(
                f"/api/v1/buildings/{BUILDING_ID}/interior/rooms",
                params={"level": 2},
            )
            assert resp.status_code == 200
            assert resp.json() == []
        finally:
            _cleanup()

    def test_list_rooms_building_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/rooms")
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_delete_room_success(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.delete(f"/api/v1/interior/rooms/{ROOM_ID}")
            assert resp.status_code == 204
        finally:
            _cleanup()

    def test_delete_room_not_found(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = 0
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.delete(f"/api/v1/interior/rooms/{ROOM_ID}")
            assert resp.status_code == 404
        finally:
            _cleanup()


# ===========================================================================
# Wall route tests
# ===========================================================================

class TestInteriorWallRoutes:
    """Tests for /buildings/{id}/interior/walls and /interior/walls/{id} routes."""

    def test_list_walls(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        wall = make_sample_wall()
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=building),
                MockResult(rows=[wall]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/walls")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["wall_type"] == "interior"
        finally:
            _cleanup()

    def test_list_walls_building_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/walls")
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_delete_wall_success(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.delete(f"/api/v1/interior/walls/{WALL_ID}")
            assert resp.status_code == 204
        finally:
            _cleanup()

    def test_delete_wall_not_found(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = 0
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.delete(f"/api/v1/interior/walls/{WALL_ID}")
            assert resp.status_code == 404
        finally:
            _cleanup()


# ===========================================================================
# Feature route tests
# ===========================================================================

class TestInteriorFeatureRoutes:
    """Tests for /buildings/{id}/interior/features and /interior/features/{id} routes."""

    def test_list_features(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        feature = make_sample_feature()
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=building),
                MockResult(rows=[feature]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/features")
            assert resp.status_code == 200
            data = resp.json()
            assert len(data) == 1
            assert data[0]["feature_type"] == "door"
        finally:
            _cleanup()

    def test_list_features_building_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/features")
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_delete_feature_success(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = 1
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.delete(f"/api/v1/interior/features/{FEATURE_ID}")
            assert resp.status_code == 204
        finally:
            _cleanup()

    def test_delete_feature_not_found(self):
        mock_session = AsyncMock()
        mock_result = MagicMock()
        mock_result.rowcount = 0
        mock_session.execute = AsyncMock(return_value=mock_result)
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.delete(f"/api/v1/interior/features/{FEATURE_ID}")
            assert resp.status_code == 404
        finally:
            _cleanup()


# ===========================================================================
# Summary route tests
# ===========================================================================

class TestInteriorSummaryRoutes:
    """Tests for /buildings/{id}/interior/summary."""

    def test_get_summary(self):
        mock_session = AsyncMock()
        building = make_sample_building()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=building))
        mock_session.scalar = AsyncMock(side_effect=[2, 5, 3, 1])
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/summary")
            assert resp.status_code == 200
            data = resp.json()
            assert data["building_id"] == str(BUILDING_ID)
            assert data["source_count"] == 2
            assert data["room_count"] == 5
            assert data["wall_count"] == 3
            assert data["feature_count"] == 1
            assert data["has_extracted_data"] is True
        finally:
            _cleanup()

    def test_get_summary_building_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/interior/summary")
            assert resp.status_code == 404
        finally:
            _cleanup()


# ===========================================================================
# Extraction trigger route tests
# ===========================================================================

class TestExtractionRoutes:
    """Tests for /interior/sources/{id}/extract."""

    def test_trigger_extraction(self):
        mock_session = AsyncMock()
        source = make_sample_source(status="raw")
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=source))
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.post(f"/api/v1/interior/sources/{SOURCE_ID}/extract")
            assert resp.status_code == 200
            data = resp.json()
            assert data["status"] == "queued"
            assert data["source_id"] == str(SOURCE_ID)
            assert source.status == "processing"
        finally:
            _cleanup()

    def test_trigger_extraction_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.post(f"/api/v1/interior/sources/{SOURCE_ID}/extract")
            assert resp.status_code == 404
        finally:
            _cleanup()
