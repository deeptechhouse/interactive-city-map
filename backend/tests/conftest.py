"""Shared pytest fixtures for the Interactive City Map backend test suite."""

import uuid
from datetime import datetime, timezone
from unittest.mock import AsyncMock, MagicMock, patch

import pytest
from fastapi.testclient import TestClient

from app.main import app


# ---------------------------------------------------------------------------
# Fixed UUIDs for deterministic test data
# ---------------------------------------------------------------------------
CITY_ID = uuid.UUID("00000000-0000-4000-8000-000000000001")
BUILDING_ID = uuid.UUID("00000000-0000-4000-8000-000000000002")
POI_ID = uuid.UUID("00000000-0000-4000-8000-000000000003")
RAILROAD_ID = uuid.UUID("00000000-0000-4000-8000-000000000004")
FLOOR_PLAN_ID = uuid.UUID("00000000-0000-4000-8000-000000000005")

NOW = datetime(2026, 1, 15, 12, 0, 0, tzinfo=timezone.utc)


# ---------------------------------------------------------------------------
# Mock async session
# ---------------------------------------------------------------------------
class MockResult:
    """Mimics a SQLAlchemy result with .all(), .first(), .scalar_one_or_none(), .scalars()."""

    def __init__(self, rows=None, scalar=None):
        self._rows = rows or []
        self._scalar = scalar

    def all(self):
        return self._rows

    def first(self):
        return self._rows[0] if self._rows else None

    def scalar_one_or_none(self):
        return self._scalar

    def scalars(self):
        return self

    def __iter__(self):
        return iter(self._rows)


def make_mock_session():
    """Create an AsyncMock that behaves like an AsyncSession."""
    session = AsyncMock()
    session.execute = AsyncMock()
    session.commit = AsyncMock()
    session.refresh = AsyncMock()
    session.add = MagicMock()
    return session


@pytest.fixture
def mock_session():
    """Provide a fresh mock async session for each test."""
    return make_mock_session()


# ---------------------------------------------------------------------------
# Sample domain objects (plain attribute containers, no DB required)
# ---------------------------------------------------------------------------
class AttrDict:
    """Simple object that allows attribute access for arbitrary data."""

    def __init__(self, **kwargs):
        for k, v in kwargs.items():
            setattr(self, k, v)


@pytest.fixture
def sample_city():
    """Return a City-like object with test data."""
    return AttrDict(
        id=CITY_ID,
        name="Chicago",
        slug="chicago",
        state="IL",
        bounds=None,
        center=None,
        default_zoom=12,
        layer_config={"buildings": True},
        data_sources={"parcels": "cook-county"},
        created_at=NOW,
        updated_at=NOW,
        buildings=[],
        parcels=[],
        railroads=[],
        zoning_districts=[],
        pois=[],
        transit_lines=[],
        transit_stations=[],
        waterways=[],
    )


@pytest.fixture
def sample_building():
    """Return a Building-like object with test data."""
    return AttrDict(
        id=BUILDING_ID,
        city_id=CITY_ID,
        parcel_pin="17-03-222-001",
        geom="fake-geom",
        _geom_geojson='{"type":"Polygon","coordinates":[[[-87.63,41.88],[-87.63,41.89],[-87.62,41.89],[-87.62,41.88],[-87.63,41.88]]]}',
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
        external_links={"wiki": "https://en.wikipedia.org/wiki/Willis_Tower"},
        metadata_={"architect": "SOM"},
        created_at=NOW,
        updated_at=NOW,
        pois=[],
        floor_plans=[],
        city=None,
        metadata={"architect": "SOM"},
    )


@pytest.fixture
def sample_poi():
    """Return a POI-like object with test data."""
    return AttrDict(
        id=POI_ID,
        city_id=CITY_ID,
        building_id=BUILDING_ID,
        geom="fake-geom",
        name="Skydeck Chicago",
        category="museum",
        subcategory="observation_deck",
        address="233 S Wacker Dr",
        phone="312-875-9447",
        website="https://theskydeck.com",
        hours={"mon": "10-20"},
        description="Observation deck on the 103rd floor",
        event_facilities=None,
        unit_count=None,
        source="manual",
        source_id=None,
        verified=True,
        metadata_=None,
        search_vector=None,
        created_at=NOW,
        updated_at=NOW,
        city=None,
        building=None,
        metadata=None,
    )


@pytest.fixture
def sample_railroad():
    """Return a Railroad-like object with test data."""
    return AttrDict(
        id=RAILROAD_ID,
        city_id=CITY_ID,
        geom="fake-geom",
        name="BNSF Racetrack",
        owner="BNSF",
        status="active",
        track_class="1",
        trackage_rights=["Metra"],
        source="fra",
        metadata_=None,
        city=None,
        metadata=None,
    )


@pytest.fixture
def sample_floor_plan():
    """Return a FloorPlan-like object with test data."""
    return AttrDict(
        id=FLOOR_PLAN_ID,
        building_id=BUILDING_ID,
        level=0,
        level_name="Ground Floor",
        geojson=None,
        raster_url="http://localhost:9000/citymap-tiles/floor-plans/test/0.png",
        raster_bounds=None,
        source="upload",
        created_at=NOW,
        updated_at=NOW,
        building=None,
    )


# ---------------------------------------------------------------------------
# FastAPI TestClient (sync, for route-level integration tests)
# ---------------------------------------------------------------------------
@pytest.fixture
def test_client():
    """Return a synchronous TestClient wrapping the FastAPI app."""
    return TestClient(app)
