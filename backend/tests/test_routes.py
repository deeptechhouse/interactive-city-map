"""Tests for FastAPI route endpoints.

Uses the synchronous TestClient. Database calls are mocked at the dependency
level so tests run without a live PostgreSQL+PostGIS instance.
"""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app
from app.database import get_async_session
from tests.conftest import (
    BUILDING_ID,
    CITY_ID,
    POI_ID,
    RAILROAD_ID,
    FLOOR_PLAN_ID,
    NOW,
    MockResult,
    AttrDict,
)


# ---------------------------------------------------------------------------
# Helpers
# ---------------------------------------------------------------------------

def _override_session(mock_session):
    """Override the FastAPI get_async_session dependency with a mock."""

    async def _fake():
        yield mock_session

    app.dependency_overrides[get_async_session] = _fake


def _cleanup():
    app.dependency_overrides.clear()


# ---------------------------------------------------------------------------
# Health
# ---------------------------------------------------------------------------

class TestHealthEndpoint:
    """Tests for GET /health."""

    def test_health_returns_200(self, test_client):
        resp = test_client.get("/health")
        assert resp.status_code == 200
        data = resp.json()
        assert data["status"] == "ok"


# ---------------------------------------------------------------------------
# Cities
# ---------------------------------------------------------------------------

class TestCitiesEndpoints:
    """Tests for /api/v1/cities routes."""

    def test_list_cities_returns_list(self):
        mock_session = AsyncMock()
        city = AttrDict(
            id=CITY_ID,
            name="Chicago",
            slug="chicago",
            state="IL",
            default_zoom=12,
            layer_config=None,
            data_sources=None,
            created_at=NOW,
            updated_at=NOW,
        )
        mock_session.execute = AsyncMock(
            return_value=MockResult(rows=[(city, None, None)])
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["slug"] == "chicago"
            assert data[0]["name"] == "Chicago"
        finally:
            _cleanup()

    def test_get_city_by_slug(self):
        mock_session = AsyncMock()
        city = AttrDict(
            id=CITY_ID,
            name="Chicago",
            slug="chicago",
            state="IL",
            default_zoom=12,
            layer_config={"buildings": True},
            data_sources=None,
            created_at=NOW,
            updated_at=NOW,
        )
        mock_session.execute = AsyncMock(
            return_value=MockResult(rows=[(city, None, None)])
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities/chicago")
            assert resp.status_code == 200
            data = resp.json()
            assert data["slug"] == "chicago"
            assert data["layer_config"] == {"buildings": True}
        finally:
            _cleanup()

    def test_get_city_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(rows=[]))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities/nonexistent")
            assert resp.status_code == 404
        finally:
            _cleanup()


# ---------------------------------------------------------------------------
# Buildings
# ---------------------------------------------------------------------------

class TestBuildingsEndpoints:
    """Tests for /api/v1/buildings and /api/v1/cities/{slug}/buildings routes."""

    def _make_building(self):
        return AttrDict(
            id=BUILDING_ID,
            city_id=CITY_ID,
            parcel_pin="17-03-222-001",
            address="233 S Wacker Dr",
            name="Willis Tower",
            zoning_code="DC",
            zoning_desc="Downtown Core",
            year_built=1973,
            floors=110,
            sq_ft=4477800,
            owner_name="Test Owner",
            owner_type="corporate",
            property_class="commercial",
            has_interior=True,
            is_hidden=False,
            external_links=None,
            metadata=None,
            created_at=NOW,
            updated_at=NOW,
        )

    def test_list_buildings_by_bbox(self):
        mock_session = AsyncMock()
        building = self._make_building()
        geojson = '{"type":"Polygon","coordinates":[[[-87.63,41.88],[-87.63,41.89],[-87.62,41.89],[-87.62,41.88],[-87.63,41.88]]]}'

        # First call: resolve city -> returns city_id
        # Second call: fetch buildings -> returns rows
        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=CITY_ID),
                MockResult(rows=[(building, geojson)]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(
                "/api/v1/cities/chicago/buildings",
                params={"bbox": "-87.7,41.8,-87.6,41.9"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["name"] == "Willis Tower"
            assert data[0]["geometry"]["type"] == "Polygon"
        finally:
            _cleanup()

    def test_list_buildings_city_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(
                "/api/v1/cities/nonexistent/buildings",
                params={"bbox": "-87.7,41.8,-87.6,41.9"},
            )
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_list_buildings_bad_bbox(self):
        mock_session = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(
                "/api/v1/cities/chicago/buildings",
                params={"bbox": "not,valid"},
            )
            assert resp.status_code == 400
        finally:
            _cleanup()

    def test_get_building_by_id(self):
        mock_session = AsyncMock()
        building = self._make_building()
        geojson = '{"type":"Polygon","coordinates":[[]]}'
        mock_session.execute = AsyncMock(
            return_value=MockResult(rows=[(building, geojson)])
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}")
            assert resp.status_code == 200
            data = resp.json()
            assert data["id"] == str(BUILDING_ID)
        finally:
            _cleanup()

    def test_get_building_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(rows=[]))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{uuid.uuid4()}")
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_patch_building_hidden(self):
        mock_session = AsyncMock()
        building = self._make_building()
        building.is_hidden = True
        geojson = '{"type":"Polygon","coordinates":[[]]}'

        mock_session.execute = AsyncMock(
            side_effect=[
                # exists check
                MockResult(scalar=BUILDING_ID),
                # update execute
                MockResult(),
                # re-fetch
                MockResult(rows=[(building, geojson)]),
            ]
        )
        mock_session.commit = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.patch(
                f"/api/v1/buildings/{BUILDING_ID}",
                params={"is_hidden": True},
            )
            assert resp.status_code == 200
            assert resp.json()["is_hidden"] is True
        finally:
            _cleanup()

    def test_patch_building_no_fields(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=BUILDING_ID))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.patch(f"/api/v1/buildings/{BUILDING_ID}")
            assert resp.status_code == 400
        finally:
            _cleanup()


# ---------------------------------------------------------------------------
# POIs
# ---------------------------------------------------------------------------

class TestPOIEndpoints:
    """Tests for POI routes."""

    def _make_poi(self):
        return AttrDict(
            id=POI_ID,
            city_id=CITY_ID,
            building_id=None,
            name="Test Cafe",
            category="cafe",
            subcategory=None,
            address="100 Main St",
            phone=None,
            website=None,
            hours=None,
            description=None,
            event_facilities=None,
            unit_count=None,
            source="manual",
            source_id=None,
            verified=False,
            metadata=None,
            created_at=NOW,
            updated_at=NOW,
        )

    def test_list_pois(self):
        mock_session = AsyncMock()
        poi = self._make_poi()
        geojson = '{"type":"Point","coordinates":[-87.63,41.88]}'

        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=CITY_ID),
                MockResult(rows=[(poi, geojson)]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities/chicago/pois")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["name"] == "Test Cafe"
        finally:
            _cleanup()

    def test_list_pois_city_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities/nonexistent/pois")
            assert resp.status_code == 404
        finally:
            _cleanup()

    def test_get_poi_by_id(self):
        mock_session = AsyncMock()
        poi = self._make_poi()
        geojson = '{"type":"Point","coordinates":[-87.63,41.88]}'
        mock_session.execute = AsyncMock(
            return_value=MockResult(rows=[(poi, geojson)])
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/pois/{POI_ID}")
            assert resp.status_code == 200
            assert resp.json()["id"] == str(POI_ID)
        finally:
            _cleanup()

    def test_create_poi(self):
        mock_session = AsyncMock()
        poi = self._make_poi()
        geojson = '{"type":"Point","coordinates":[-87.63,41.88]}'

        mock_session.execute = AsyncMock(
            side_effect=[
                # city exists check
                MockResult(scalar=CITY_ID),
                # re-fetch after create
                MockResult(rows=[(poi, geojson)]),
            ]
        )
        mock_session.add = MagicMock()
        mock_session.commit = AsyncMock()
        mock_session.refresh = AsyncMock()
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.post(
                "/api/v1/pois",
                params={
                    "name": "Test Cafe",
                    "category": "cafe",
                    "city_id": str(CITY_ID),
                    "lat": 41.88,
                    "lon": -87.63,
                },
            )
            assert resp.status_code == 201
            data = resp.json()
            assert data["name"] == "Test Cafe"
        finally:
            _cleanup()


# ---------------------------------------------------------------------------
# Search
# ---------------------------------------------------------------------------

class TestSearchEndpoint:
    """Tests for GET /api/v1/cities/{slug}/search."""

    def test_search_returns_results(self):
        mock_session = AsyncMock()

        building = AttrDict(
            id=BUILDING_ID,
            name="Willis Tower",
            address="233 S Wacker Dr",
            zoning_code="DC",
            is_hidden=False,
            metadata=None,
        )
        geojson = '{"type":"Polygon","coordinates":[[]]}'

        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=CITY_ID),  # city lookup
                MockResult(rows=[(building, geojson)]),  # building search
                MockResult(rows=[]),  # POI search
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(
                "/api/v1/cities/chicago/search",
                params={"q": "Willis"},
            )
            assert resp.status_code == 200
            data = resp.json()
            assert "results" in data
            assert "count" in data
            assert data["query"] == "Willis"
        finally:
            _cleanup()

    def test_search_city_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(
                "/api/v1/cities/nonexistent/search",
                params={"q": "test"},
            )
            assert resp.status_code == 404
        finally:
            _cleanup()


# ---------------------------------------------------------------------------
# Railroads
# ---------------------------------------------------------------------------

class TestRailroadEndpoints:
    """Tests for railroad routes."""

    def test_list_railroads(self):
        mock_session = AsyncMock()
        rr = AttrDict(
            id=RAILROAD_ID,
            city_id=CITY_ID,
            name="BNSF Racetrack",
            owner="BNSF",
            status="active",
            track_class="1",
            trackage_rights=["Metra"],
            source="fra",
            metadata=None,
        )
        geojson = '{"type":"MultiLineString","coordinates":[[[-87.63,41.88],[-87.62,41.89]]]}'

        mock_session.execute = AsyncMock(
            side_effect=[
                MockResult(scalar=CITY_ID),
                MockResult(rows=[(rr, geojson)]),
            ]
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities/chicago/railroads")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
            assert len(data) == 1
            assert data[0]["name"] == "BNSF Racetrack"
            assert data[0]["owner"] == "BNSF"
        finally:
            _cleanup()

    def test_list_railroads_city_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get("/api/v1/cities/nonexistent/railroads")
            assert resp.status_code == 404
        finally:
            _cleanup()


# ---------------------------------------------------------------------------
# Floor Plans
# ---------------------------------------------------------------------------

class TestFloorPlanEndpoints:
    """Tests for floor plan routes."""

    def test_list_floor_plans(self):
        mock_session = AsyncMock()
        fp = AttrDict(
            id=FLOOR_PLAN_ID,
            building_id=BUILDING_ID,
            level=0,
            level_name="Ground Floor",
            geojson=None,
            raster_url="http://localhost:9000/test/0.png",
            source="upload",
            created_at=NOW,
            updated_at=NOW,
        )

        # The floor_plan_service.get_floor_plans function uses session.execute
        mock_session.execute = AsyncMock(
            return_value=MockResult(rows=[fp])
        )
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/buildings/{BUILDING_ID}/floor-plans")
            assert resp.status_code == 200
            data = resp.json()
            assert isinstance(data, list)
        finally:
            _cleanup()

    def test_get_floor_plan_not_found(self):
        mock_session = AsyncMock()
        mock_session.execute = AsyncMock(return_value=MockResult(scalar=None))
        _override_session(mock_session)

        try:
            client = TestClient(app)
            resp = client.get(f"/api/v1/floor-plans/{uuid.uuid4()}")
            assert resp.status_code == 404
        finally:
            _cleanup()
