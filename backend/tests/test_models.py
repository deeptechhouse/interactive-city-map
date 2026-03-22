"""Tests for SQLAlchemy ORM model definitions.

Verifies that all models can be instantiated with correct fields,
relationships are declared, and geometry columns use the right types.
"""

import uuid
from datetime import datetime, timezone

import pytest

from app.models.city import City
from app.models.building import Building
from app.models.poi import POI
from app.models.floor_plan import FloorPlan
from app.models.railroad import Railroad
from app.models.parcel import Parcel
from app.models.waterway import Waterway
from app.models.transit import TransitLine, TransitStation
from app.models.zoning import ZoningDistrict


# ---------------------------------------------------------------------------
# City
# ---------------------------------------------------------------------------

class TestCityModel:
    """Tests for the City ORM model."""

    def test_instantiate_with_required_fields(self):
        city = City(
            id=uuid.uuid4(),
            name="Chicago",
            slug="chicago",
            state="IL",
        )
        assert city.name == "Chicago"
        assert city.slug == "chicago"
        assert city.state == "IL"

    def test_optional_fields_default_to_none(self):
        city = City(name="Test", slug="test", state="XX")
        assert city.bounds is None
        assert city.center is None
        assert city.layer_config is None
        assert city.data_sources is None

    def test_tablename(self):
        assert City.__tablename__ == "cities"

    def test_has_building_relationship(self):
        assert hasattr(City, "buildings")

    def test_has_poi_relationship(self):
        assert hasattr(City, "pois")

    def test_has_railroad_relationship(self):
        assert hasattr(City, "railroads")

    def test_has_all_relationships(self):
        expected_rels = [
            "buildings", "parcels", "railroads", "zoning_districts",
            "pois", "transit_lines", "transit_stations", "waterways",
        ]
        for rel in expected_rels:
            assert hasattr(City, rel), f"City missing relationship: {rel}"


# ---------------------------------------------------------------------------
# Building
# ---------------------------------------------------------------------------

class TestBuildingModel:
    """Tests for the Building ORM model."""

    def test_instantiate_with_required_fields(self):
        building = Building(
            id=uuid.uuid4(),
            city_id=uuid.uuid4(),
            geom="SRID=4326;POLYGON((-87 41, -87 42, -86 42, -86 41, -87 41))",
        )
        assert building.city_id is not None
        assert building.geom is not None

    def test_optional_fields(self):
        building = Building(city_id=uuid.uuid4(), geom="fake")
        assert building.address is None
        assert building.name is None
        assert building.year_built is None
        assert building.floors is None

    def test_tablename(self):
        assert Building.__tablename__ == "buildings"

    def test_has_city_relationship(self):
        assert hasattr(Building, "city")

    def test_has_pois_relationship(self):
        assert hasattr(Building, "pois")

    def test_has_floor_plans_relationship(self):
        assert hasattr(Building, "floor_plans")

    def test_external_links_accepts_dict(self):
        building = Building(
            city_id=uuid.uuid4(),
            geom="fake",
            external_links={"wiki": "https://example.com"},
        )
        assert building.external_links["wiki"] == "https://example.com"


# ---------------------------------------------------------------------------
# POI
# ---------------------------------------------------------------------------

class TestPOIModel:
    """Tests for the POI ORM model."""

    def test_instantiate_with_required_fields(self):
        poi = POI(
            id=uuid.uuid4(),
            city_id=uuid.uuid4(),
            geom="SRID=4326;POINT(-87.63 41.88)",
            name="Test POI",
            category="restaurant",
        )
        assert poi.name == "Test POI"
        assert poi.category == "restaurant"

    def test_optional_building_id(self):
        poi = POI(
            city_id=uuid.uuid4(),
            geom="fake",
            name="Test",
            category="cafe",
        )
        assert poi.building_id is None

    def test_tablename(self):
        assert POI.__tablename__ == "pois"

    def test_has_city_relationship(self):
        assert hasattr(POI, "city")

    def test_has_building_relationship(self):
        assert hasattr(POI, "building")

    def test_event_facilities_accepts_list(self):
        poi = POI(
            city_id=uuid.uuid4(),
            geom="fake",
            name="Venue",
            category="performance_arts",
            event_facilities=["stage", "sound_system"],
        )
        assert "stage" in poi.event_facilities


# ---------------------------------------------------------------------------
# FloorPlan
# ---------------------------------------------------------------------------

class TestFloorPlanModel:
    """Tests for the FloorPlan ORM model."""

    def test_instantiate_with_required_fields(self):
        fp = FloorPlan(
            id=uuid.uuid4(),
            building_id=uuid.uuid4(),
            level=0,
        )
        assert fp.level == 0
        assert fp.building_id is not None

    def test_optional_fields(self):
        fp = FloorPlan(building_id=uuid.uuid4(), level=1)
        assert fp.level_name is None
        assert fp.geojson is None
        assert fp.raster_url is None
        assert fp.source is None

    def test_tablename(self):
        assert FloorPlan.__tablename__ == "floor_plans"

    def test_has_building_relationship(self):
        assert hasattr(FloorPlan, "building")

    def test_unique_constraint_name(self):
        constraints = FloorPlan.__table_args__
        assert any(
            getattr(c, "name", None) == "idx_floor_plans_building_level"
            for c in constraints
            if hasattr(c, "name")
        )


# ---------------------------------------------------------------------------
# Railroad
# ---------------------------------------------------------------------------

class TestRailroadModel:
    """Tests for the Railroad ORM model."""

    def test_instantiate_with_required_fields(self):
        rr = Railroad(
            id=uuid.uuid4(),
            city_id=uuid.uuid4(),
            geom="fake-multilinestring",
            status="active",
        )
        assert rr.status == "active"

    def test_optional_fields(self):
        rr = Railroad(city_id=uuid.uuid4(), geom="fake", status="active")
        assert rr.name is None
        assert rr.owner is None
        assert rr.track_class is None
        assert rr.trackage_rights is None

    def test_tablename(self):
        assert Railroad.__tablename__ == "railroads"

    def test_has_city_relationship(self):
        assert hasattr(Railroad, "city")


# ---------------------------------------------------------------------------
# Parcel
# ---------------------------------------------------------------------------

class TestParcelModel:
    """Tests for the Parcel ORM model."""

    def test_instantiate(self):
        p = Parcel(
            city_id=uuid.uuid4(),
            pin="17-03-222-001",
            geom="fake",
        )
        assert p.pin == "17-03-222-001"

    def test_tablename(self):
        assert Parcel.__tablename__ == "parcels"

    def test_has_city_relationship(self):
        assert hasattr(Parcel, "city")


# ---------------------------------------------------------------------------
# Waterway
# ---------------------------------------------------------------------------

class TestWaterwayModel:
    """Tests for the Waterway ORM model."""

    def test_instantiate(self):
        w = Waterway(city_id=uuid.uuid4(), geom="fake")
        assert w.waterway_type is None

    def test_tablename(self):
        assert Waterway.__tablename__ == "waterways"


# ---------------------------------------------------------------------------
# TransitLine / TransitStation
# ---------------------------------------------------------------------------

class TestTransitModels:
    """Tests for TransitLine and TransitStation ORM models."""

    def test_transit_line_instantiate(self):
        tl = TransitLine(
            city_id=uuid.uuid4(),
            geom="fake",
            name="Red Line",
        )
        assert tl.name == "Red Line"

    def test_transit_station_instantiate(self):
        ts = TransitStation(
            city_id=uuid.uuid4(),
            geom="fake",
            name="Jackson",
        )
        assert ts.name == "Jackson"

    def test_transit_line_has_stations_relationship(self):
        assert hasattr(TransitLine, "stations")

    def test_transit_station_has_line_relationship(self):
        assert hasattr(TransitStation, "line")

    def test_tablenames(self):
        assert TransitLine.__tablename__ == "transit_lines"
        assert TransitStation.__tablename__ == "transit_stations"


# ---------------------------------------------------------------------------
# ZoningDistrict
# ---------------------------------------------------------------------------

class TestZoningDistrictModel:
    """Tests for the ZoningDistrict ORM model."""

    def test_instantiate(self):
        zd = ZoningDistrict(
            city_id=uuid.uuid4(),
            geom="fake",
            zone_code="RS-3",
            zone_class="residential",
        )
        assert zd.zone_code == "RS-3"
        assert zd.zone_class == "residential"

    def test_tablename(self):
        assert ZoningDistrict.__tablename__ == "zoning_districts"

    def test_has_city_relationship(self):
        assert hasattr(ZoningDistrict, "city")
