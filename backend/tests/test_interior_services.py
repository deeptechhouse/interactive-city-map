"""Unit tests for interior services: InteriorService, InteriorSourceService, GeoreferencingService."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from shapely.geometry import box

from tests.conftest import BUILDING_ID, CITY_ID, FLOOR_PLAN_ID, NOW, AttrDict, MockResult, make_mock_session


# ---------------------------------------------------------------------------
# Fixed UUIDs for interior test data
# ---------------------------------------------------------------------------
SOURCE_ID = uuid.UUID("00000000-0000-4000-8000-000000000010")
ROOM_ID = uuid.UUID("00000000-0000-4000-8000-000000000011")
WALL_ID = uuid.UUID("00000000-0000-4000-8000-000000000012")
FEATURE_ID = uuid.UUID("00000000-0000-4000-8000-000000000013")


# ---------------------------------------------------------------------------
# Sample object factories
# ---------------------------------------------------------------------------

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
        geom="fake-geom",
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
        geom="fake-geom",
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
        geom="fake-geom",
        created_at=NOW,
    )
    defaults.update(overrides)
    return AttrDict(**defaults)


# ===========================================================================
# InteriorService tests
# ===========================================================================

class TestInteriorServiceSources:
    """Tests for InteriorService source CRUD methods."""

    @pytest.mark.asyncio
    async def test_get_sources_returns_list(self):
        session = make_mock_session()
        source = make_sample_source()
        session.execute.return_value = MockResult(rows=[source])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_sources(BUILDING_ID, session)
        assert len(result) == 1
        assert result[0].id == SOURCE_ID
        session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_sources_empty(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_sources(BUILDING_ID, session)
        assert result == []

    @pytest.mark.asyncio
    async def test_create_source(self):
        session = make_mock_session()
        from app.schemas.interior import InteriorSourceCreateRequest
        from app.services.interior_service import InteriorService

        data = InteriorSourceCreateRequest(source_type="upload", confidence=0.5)

        async def fake_refresh(obj):
            obj.id = SOURCE_ID

        session.refresh = fake_refresh
        result = await InteriorService.create_source(BUILDING_ID, CITY_ID, data, session)
        session.add.assert_called_once()
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_create_source_defaults_confidence_to_zero(self):
        session = make_mock_session()
        from app.schemas.interior import InteriorSourceCreateRequest
        from app.services.interior_service import InteriorService

        data = InteriorSourceCreateRequest(source_type="osm")

        async def fake_refresh(obj):
            obj.id = SOURCE_ID

        session.refresh = fake_refresh
        result = await InteriorService.create_source(BUILDING_ID, CITY_ID, data, session)
        added_obj = session.add.call_args[0][0]
        assert added_obj.confidence == 0.0

    @pytest.mark.asyncio
    async def test_update_source_status_success(self):
        session = make_mock_session()
        source = make_sample_source()
        session.execute.return_value = MockResult(scalar=source)
        from app.services.interior_service import InteriorService

        result = await InteriorService.update_source_status(SOURCE_ID, "extracted", session)
        assert result is not None
        assert source.status == "extracted"
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_update_source_status_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)
        from app.services.interior_service import InteriorService

        result = await InteriorService.update_source_status(SOURCE_ID, "extracted", session)
        assert result is None


class TestInteriorServiceRooms:
    """Tests for InteriorService room CRUD methods."""

    @pytest.mark.asyncio
    async def test_get_rooms_returns_list(self):
        session = make_mock_session()
        room = make_sample_room()
        session.execute.return_value = MockResult(rows=[room])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_rooms(BUILDING_ID, session)
        assert len(result) == 1
        assert result[0].name == "Main Office"

    @pytest.mark.asyncio
    async def test_get_rooms_with_level_filter(self):
        session = make_mock_session()
        room = make_sample_room(level=2)
        session.execute.return_value = MockResult(rows=[room])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_rooms(BUILDING_ID, session, level=2)
        assert len(result) == 1
        session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_rooms_empty(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_rooms(BUILDING_ID, session)
        assert result == []

    @pytest.mark.asyncio
    async def test_delete_room_success(self):
        session = make_mock_session()
        mock_result = MagicMock()
        mock_result.rowcount = 1
        session.execute.return_value = mock_result
        from app.services.interior_service import InteriorService

        result = await InteriorService.delete_room(ROOM_ID, session)
        assert result is True
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_room_not_found(self):
        session = make_mock_session()
        mock_result = MagicMock()
        mock_result.rowcount = 0
        session.execute.return_value = mock_result
        from app.services.interior_service import InteriorService

        result = await InteriorService.delete_room(ROOM_ID, session)
        assert result is False


class TestInteriorServiceWalls:
    """Tests for InteriorService wall CRUD methods."""

    @pytest.mark.asyncio
    async def test_get_walls_returns_list(self):
        session = make_mock_session()
        wall = make_sample_wall()
        session.execute.return_value = MockResult(rows=[wall])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_walls(BUILDING_ID, session)
        assert len(result) == 1
        assert result[0].wall_type == "interior"

    @pytest.mark.asyncio
    async def test_get_walls_with_level_filter(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_walls(BUILDING_ID, session, level=3)
        assert result == []
        session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_delete_wall_success(self):
        session = make_mock_session()
        mock_result = MagicMock()
        mock_result.rowcount = 1
        session.execute.return_value = mock_result
        from app.services.interior_service import InteriorService

        result = await InteriorService.delete_wall(WALL_ID, session)
        assert result is True

    @pytest.mark.asyncio
    async def test_delete_wall_not_found(self):
        session = make_mock_session()
        mock_result = MagicMock()
        mock_result.rowcount = 0
        session.execute.return_value = mock_result
        from app.services.interior_service import InteriorService

        result = await InteriorService.delete_wall(WALL_ID, session)
        assert result is False


class TestInteriorServiceFeatures:
    """Tests for InteriorService feature CRUD methods."""

    @pytest.mark.asyncio
    async def test_get_features_returns_list(self):
        session = make_mock_session()
        feature = make_sample_feature()
        session.execute.return_value = MockResult(rows=[feature])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_features(BUILDING_ID, session)
        assert len(result) == 1
        assert result[0].feature_type == "door"

    @pytest.mark.asyncio
    async def test_get_features_with_level_filter(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_features(BUILDING_ID, session, level=1)
        assert result == []

    @pytest.mark.asyncio
    async def test_delete_feature_success(self):
        session = make_mock_session()
        mock_result = MagicMock()
        mock_result.rowcount = 1
        session.execute.return_value = mock_result
        from app.services.interior_service import InteriorService

        result = await InteriorService.delete_feature(FEATURE_ID, session)
        assert result is True

    @pytest.mark.asyncio
    async def test_delete_feature_not_found(self):
        session = make_mock_session()
        mock_result = MagicMock()
        mock_result.rowcount = 0
        session.execute.return_value = mock_result
        from app.services.interior_service import InteriorService

        result = await InteriorService.delete_feature(FEATURE_ID, session)
        assert result is False


class TestInteriorServiceSummary:
    """Tests for InteriorService.get_summary."""

    @pytest.mark.asyncio
    async def test_get_summary_with_data(self):
        session = make_mock_session()
        session.scalar = AsyncMock(side_effect=[3, 10, 5, 2])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_summary(BUILDING_ID, session)
        assert result.source_count == 3
        assert result.room_count == 10
        assert result.wall_count == 5
        assert result.feature_count == 2
        assert result.has_extracted_data is True

    @pytest.mark.asyncio
    async def test_get_summary_empty_building(self):
        session = make_mock_session()
        session.scalar = AsyncMock(side_effect=[0, 0, 0, 0])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_summary(BUILDING_ID, session)
        assert result.source_count == 0
        assert result.room_count == 0
        assert result.wall_count == 0
        assert result.feature_count == 0
        assert result.has_extracted_data is False

    @pytest.mark.asyncio
    async def test_get_summary_walls_only_counts_as_extracted(self):
        session = make_mock_session()
        session.scalar = AsyncMock(side_effect=[1, 0, 3, 0])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_summary(BUILDING_ID, session)
        assert result.has_extracted_data is True

    @pytest.mark.asyncio
    async def test_get_summary_none_counts_treated_as_zero(self):
        session = make_mock_session()
        session.scalar = AsyncMock(side_effect=[None, None, None, None])
        from app.services.interior_service import InteriorService

        result = await InteriorService.get_summary(BUILDING_ID, session)
        assert result.source_count == 0
        assert result.room_count == 0
        assert result.has_extracted_data is False


# ===========================================================================
# InteriorSourceService tests
# ===========================================================================

class TestInteriorSourceService:
    """Tests for InteriorSourceService confidence scoring and queries."""

    def test_compute_confidence_upload_with_raster(self):
        from app.services.interior_source_service import InteriorSourceService

        source = make_sample_source(source_type="upload", raster_url="http://x", geojson=None, source_url=None)
        conf = InteriorSourceService.compute_confidence(source)
        assert conf == pytest.approx(0.4)  # base 0.3 + raster 0.1

    def test_compute_confidence_upload_bare(self):
        from app.services.interior_source_service import InteriorSourceService

        source = make_sample_source(source_type="upload", raster_url=None, geojson=None, source_url=None)
        conf = InteriorSourceService.compute_confidence(source)
        assert conf == pytest.approx(0.3)

    def test_compute_confidence_osm_full(self):
        from app.services.interior_source_service import InteriorSourceService

        source = make_sample_source(
            source_type="osm",
            raster_url="http://x",
            geojson={"type": "FeatureCollection"},
            source_url="http://y",
        )
        conf = InteriorSourceService.compute_confidence(source)
        # base 0.7 + raster 0.1 + geojson 0.15 + source_url 0.05 = 1.0
        assert conf == pytest.approx(1.0)

    def test_compute_confidence_clamped_to_1(self):
        from app.services.interior_source_service import InteriorSourceService

        source = make_sample_source(
            source_type="osm", raster_url="x", geojson={"a": 1}, source_url="y"
        )
        conf = InteriorSourceService.compute_confidence(source)
        assert conf <= 1.0

    def test_compute_confidence_sanborn(self):
        from app.services.interior_source_service import InteriorSourceService

        source = make_sample_source(source_type="sanborn", raster_url="http://x", geojson=None, source_url=None)
        conf = InteriorSourceService.compute_confidence(source)
        assert conf == pytest.approx(0.7)  # base 0.6 + raster 0.1

    def test_compute_confidence_unknown_type(self):
        from app.services.interior_source_service import InteriorSourceService

        source = make_sample_source(source_type="unknown", raster_url=None, geojson=None, source_url=None)
        conf = InteriorSourceService.compute_confidence(source)
        assert conf == pytest.approx(0.3)  # fallback base

    @pytest.mark.asyncio
    async def test_get_sources_by_type(self):
        session = make_mock_session()
        source = make_sample_source(source_type="osm")
        session.execute.return_value = MockResult(rows=[source])
        from app.services.interior_source_service import InteriorSourceService

        result = await InteriorSourceService.get_sources_by_type(BUILDING_ID, "osm", session)
        assert len(result) == 1
        session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_get_sources_by_status(self):
        session = make_mock_session()
        source = make_sample_source(status="extracted")
        session.execute.return_value = MockResult(rows=[source])
        from app.services.interior_source_service import InteriorSourceService

        result = await InteriorSourceService.get_sources_by_status("extracted", session)
        assert len(result) == 1

    @pytest.mark.asyncio
    async def test_get_sources_by_status_with_city_filter(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(rows=[])
        from app.services.interior_source_service import InteriorSourceService

        result = await InteriorSourceService.get_sources_by_status("raw", session, city_id=CITY_ID)
        assert result == []
        session.execute.assert_called_once()

    @pytest.mark.asyncio
    async def test_mark_extracted_success(self):
        session = make_mock_session()
        source = make_sample_source(status="raw", geojson=None, source_url="http://z")
        session.execute.return_value = MockResult(scalar=source)
        from app.services.interior_source_service import InteriorSourceService

        geojson_data = {"type": "FeatureCollection", "features": []}
        result = await InteriorSourceService.mark_extracted(SOURCE_ID, geojson_data, session)
        assert result is not None
        assert source.status == "extracted"
        assert source.geojson == geojson_data
        assert source.confidence > 0
        session.commit.assert_called_once()

    @pytest.mark.asyncio
    async def test_mark_extracted_not_found(self):
        session = make_mock_session()
        session.execute.return_value = MockResult(scalar=None)
        from app.services.interior_source_service import InteriorSourceService

        result = await InteriorSourceService.mark_extracted(SOURCE_ID, {}, session)
        assert result is None


# ===========================================================================
# GeoreferencingService tests
# ===========================================================================

class TestGeoreferencingService:
    """Tests for GeoreferencingService affine transforms."""

    def test_pixel_to_world_identity(self):
        from app.services.georeferencing_service import GeoreferencingService

        result = GeoreferencingService.pixel_to_world([1, 0, 0, 0, 1, 0], 100, 200)
        assert result == (100.0, 200.0)

    def test_pixel_to_world_translation(self):
        from app.services.georeferencing_service import GeoreferencingService

        result = GeoreferencingService.pixel_to_world([1, 0, 10, 0, 1, 20], 5, 5)
        assert abs(result[0] - 15.0) < 1e-9
        assert abs(result[1] - 25.0) < 1e-9

    def test_pixel_to_world_scaling(self):
        from app.services.georeferencing_service import GeoreferencingService

        result = GeoreferencingService.pixel_to_world([0.001, 0, 0, 0, -0.001, 0], 1000, 500)
        assert abs(result[0] - 1.0) < 1e-9
        assert abs(result[1] - (-0.5)) < 1e-9

    def test_world_to_pixel_inverse(self):
        from app.services.georeferencing_service import GeoreferencingService

        affine = [0.001, 0, -87.63, 0, -0.001, 41.89]
        wx, wy = GeoreferencingService.pixel_to_world(affine, 500, 300)
        px, py = GeoreferencingService.world_to_pixel(affine, wx, wy)
        assert abs(px - 500) < 1e-6
        assert abs(py - 300) < 1e-6

    def test_world_to_pixel_singular_raises(self):
        from app.services.georeferencing_service import GeoreferencingService

        with pytest.raises(ValueError, match="Singular"):
            GeoreferencingService.world_to_pixel([0, 0, 0, 0, 0, 0], 1, 1)

    def test_from_control_points_too_few(self):
        from app.services.georeferencing_service import GeoreferencingService

        with pytest.raises(ValueError, match="3 control points"):
            GeoreferencingService.from_control_points([(0, 0), (1, 1)], [(0, 0), (1, 1)])

    def test_from_control_points_exact_three(self):
        from app.services.georeferencing_service import GeoreferencingService

        pixel_pts = [(0, 0), (100, 0), (0, 100)]
        world_pts = [(0.0, 0.0), (1.0, 0.0), (0.0, 1.0)]
        affine = GeoreferencingService.from_control_points(pixel_pts, world_pts)
        assert len(affine) == 6
        wx, wy = GeoreferencingService.pixel_to_world(affine, 50, 50)
        assert abs(wx - 0.5) < 1e-6
        assert abs(wy - 0.5) < 1e-6

    def test_auto_fit_returns_six_params(self):
        from app.services.georeferencing_service import GeoreferencingService

        building = box(-87.63, 41.88, -87.62, 41.89)
        result = GeoreferencingService.auto_fit(building, 1000, 800)
        assert len(result) == 6
        assert all(isinstance(x, float) for x in result)

    def test_auto_fit_maps_corners_correctly(self):
        from app.services.georeferencing_service import GeoreferencingService

        building = box(-87.63, 41.88, -87.62, 41.89)
        affine = GeoreferencingService.auto_fit(building, 1000, 800)
        # Origin pixel (0,0) should map near the top-left corner of the building
        wx, wy = GeoreferencingService.pixel_to_world(affine, 0, 0)
        assert -87.64 < wx < -87.61
        assert 41.87 < wy < 41.90

    def test_affine_to_raster_bounds_returns_polygon(self):
        from app.services.georeferencing_service import GeoreferencingService

        affine = [0.00001, 0, -87.63, 0, -0.00001, 41.89]
        poly = GeoreferencingService.affine_to_raster_bounds(affine, 1000, 800)
        assert poly.is_valid
        assert poly.geom_type == "Polygon"
        assert poly.area > 0
