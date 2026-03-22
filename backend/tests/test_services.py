"""Tests for service-layer business logic.

All database interactions are mocked — these are pure unit tests.
"""

import json
import uuid
from unittest.mock import AsyncMock, MagicMock, patch

import pytest

from tests.conftest import (
    BUILDING_ID,
    CITY_ID,
    FLOOR_PLAN_ID,
    POI_ID,
    MockResult,
    make_mock_session,
    AttrDict,
)
from app.services.building_service import BuildingService
from app.services.poi_service import POIService
from app.services.search_service import SearchService
from app.services.geocoding_service import GeocodingResult, GeocodingService


# ===========================================================================
# BuildingService
# ===========================================================================

class TestBuildingService:
    """Unit tests for BuildingService methods."""

    @pytest.mark.asyncio
    async def test_get_by_id_found(self, sample_building):
        session = make_mock_session()
        geojson_str = sample_building._geom_geojson
        session.execute.return_value = MockResult(rows=[(sample_building, geojson_str)])

        result = await BuildingService.get_by_id(session, BUILDING_ID)

        assert result is not None
        assert result.id == BUILDING_ID
        assert result.name == "Willis Tower"
        assert result.geom is not None
        assert result.geom["type"] == "Polygon"

    @pytest.mark.asyncio
    async def test_get_by_id_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])

        result = await BuildingService.get_by_id(session, uuid.uuid4())
        assert result is None

    @pytest.mark.asyncio
    async def test_get_by_bbox_returns_list(self, sample_building):
        session = make_mock_session()
        geojson_str = sample_building._geom_geojson
        session.execute.return_value = MockResult(rows=[(sample_building, geojson_str)])

        result = await BuildingService.get_by_bbox(
            session, "chicago", [-87.7, 41.8, -87.6, 41.9]
        )

        assert result.total == 1
        assert len(result.buildings) == 1
        assert result.buildings[0].name == "Willis Tower"

    @pytest.mark.asyncio
    async def test_get_by_bbox_empty(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])

        result = await BuildingService.get_by_bbox(
            session, "chicago", [-87.7, 41.8, -87.6, 41.9]
        )
        assert result.total == 0
        assert result.buildings == []

    @pytest.mark.asyncio
    async def test_update_hidden(self, sample_building):
        session = make_mock_session()
        # First execute: find building
        session.execute.side_effect = [
            MockResult(scalar=sample_building),
            # Second execute: re-fetch with geom
            MockResult(rows=[(sample_building, sample_building._geom_geojson)]),
        ]

        result = await BuildingService.update_hidden(session, BUILDING_ID, True)
        assert result is not None
        session.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_hidden_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)

        result = await BuildingService.update_hidden(session, uuid.uuid4(), True)
        assert result is None

    @pytest.mark.asyncio
    async def test_update_external_links(self, sample_building):
        session = make_mock_session()
        session.execute.side_effect = [
            MockResult(scalar=sample_building),
            MockResult(rows=[(sample_building, sample_building._geom_geojson)]),
        ]
        links = {"wiki": "https://example.com", "yelp": "https://yelp.com/biz/test"}

        result = await BuildingService.update_external_links(session, BUILDING_ID, links)
        assert result is not None
        session.commit.assert_awaited_once()

    @pytest.mark.asyncio
    async def test_update_external_links_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)

        result = await BuildingService.update_external_links(
            session, uuid.uuid4(), {"test": "val"}
        )
        assert result is None


# ===========================================================================
# POIService
# ===========================================================================

class TestPOIService:
    """Unit tests for POIService methods."""

    @pytest.mark.asyncio
    async def test_get_by_bbox_returns_pois(self, sample_poi):
        session = make_mock_session()
        geojson_str = '{"type":"Point","coordinates":[-87.63,41.88]}'
        session.execute.return_value = MockResult(rows=[(sample_poi, geojson_str)])

        result = await POIService.get_by_bbox(
            session, "chicago", [-87.7, 41.8, -87.6, 41.9]
        )

        assert result.total == 1
        assert result.pois[0].name == "Skydeck Chicago"
        assert result.pois[0].category == "museum"

    @pytest.mark.asyncio
    async def test_get_by_bbox_with_category_filter(self, sample_poi):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])

        result = await POIService.get_by_bbox(
            session, "chicago", [-87.7, 41.8, -87.6, 41.9], category="restaurant"
        )
        assert result.total == 0

    @pytest.mark.asyncio
    async def test_get_by_building(self, sample_poi):
        session = make_mock_session()
        geojson_str = '{"type":"Point","coordinates":[-87.63,41.88]}'
        session.execute.return_value = MockResult(rows=[(sample_poi, geojson_str)])

        result = await POIService.get_by_building(session, BUILDING_ID)
        assert result.total == 1
        assert result.pois[0].building_id == BUILDING_ID

    @pytest.mark.asyncio
    async def test_model_to_response_with_string_geojson(self, sample_poi):
        geojson_str = '{"type":"Point","coordinates":[-87.63,41.88]}'
        resp = POIService._model_to_response(sample_poi, geojson_str)
        assert resp.geom["type"] == "Point"
        assert resp.geom["coordinates"] == [-87.63, 41.88]

    @pytest.mark.asyncio
    async def test_model_to_response_with_none_geojson(self, sample_poi):
        resp = POIService._model_to_response(sample_poi, None)
        assert resp.geom is None


# ===========================================================================
# GeocodingResult
# ===========================================================================

class TestGeocodingResult:
    """Unit tests for the GeocodingResult value object."""

    def test_properties(self):
        result = GeocodingResult(
            latitude=41.88,
            longitude=-87.63,
            formatted_address="233 S Wacker Dr, Chicago, IL",
            confidence=0.95,
        )
        assert result.latitude == 41.88
        assert result.longitude == -87.63
        assert result.formatted_address == "233 S Wacker Dr, Chicago, IL"
        assert result.confidence == 0.95

    def test_to_geojson_point(self):
        result = GeocodingResult(
            latitude=41.88,
            longitude=-87.63,
            formatted_address="test",
        )
        point = result.to_geojson_point()
        assert point["type"] == "Point"
        assert point["coordinates"] == [-87.63, 41.88]

    def test_raw_returns_copy(self):
        raw_data = {"foo": "bar"}
        result = GeocodingResult(
            latitude=0, longitude=0, formatted_address="test", raw=raw_data
        )
        returned_raw = result.raw
        returned_raw["baz"] = "qux"
        # Original should not be mutated
        assert "baz" not in result.raw

    def test_default_raw_is_empty_dict(self):
        result = GeocodingResult(latitude=0, longitude=0, formatted_address="test")
        assert result.raw == {}

    def test_default_confidence_is_none(self):
        result = GeocodingResult(latitude=0, longitude=0, formatted_address="test")
        assert result.confidence is None


class TestGeocodingService:
    """Tests for the placeholder GeocodingService."""

    @pytest.mark.asyncio
    async def test_geocode_raises_not_implemented(self):
        svc = GeocodingService()
        with pytest.raises(NotImplementedError):
            await svc.geocode("123 Main St")

    @pytest.mark.asyncio
    async def test_reverse_geocode_raises_not_implemented(self):
        svc = GeocodingService()
        with pytest.raises(NotImplementedError):
            await svc.reverse_geocode(41.88, -87.63)
