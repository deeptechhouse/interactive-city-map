"""Imports indoor mapping data from OpenStreetMap via Overpass API."""

import uuid

import httpx
from geoalchemy2.shape import from_shape
from geoalchemy2.functions import ST_Contains
from shapely.geometry import Polygon as ShapelyPolygon
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.interior_room import InteriorRoom


class OSMIndoorImporter:
    """Imports indoor mapping data from OpenStreetMap via Overpass API."""

    OVERPASS_URL = "https://overpass-api.de/api/interpreter"

    def __init__(self, session: Session, city_bounds: tuple[float, float, float, float]):
        """
        Args:
            session: Sync SQLAlchemy session.
            city_bounds: (south, west, north, east) for the Overpass bbox.
        """
        self._session = session
        self._bounds = city_bounds

    def fetch_indoor_data(self) -> dict:
        """Query Overpass for indoor=* tagged elements within city bounds."""
        s, w, n, e = self._bounds
        query = f"""
        [out:json][timeout:120];
        (
          way["indoor"]["indoor"!="yes"]({s},{w},{n},{e});
          relation["indoor"]({s},{w},{n},{e});
          way["building:part"]({s},{w},{n},{e});
        );
        out body;
        >;
        out skel qt;
        """
        response = httpx.post(self.OVERPASS_URL, data={"data": query}, timeout=180)
        response.raise_for_status()
        return response.json()

    def import_to_db(self) -> dict:
        """Fetch OSM indoor data and create InteriorRoom records.

        Returns:
            dict with counts: rooms_imported, buildings_matched.
        """
        data = self.fetch_indoor_data()

        nodes: dict[int, tuple[float, float]] = {}
        ways: dict[int, dict] = {}

        for elem in data.get("elements", []):
            if elem["type"] == "node":
                nodes[elem["id"]] = (elem["lon"], elem["lat"])
            elif elem["type"] == "way":
                ways[elem["id"]] = elem

        stats = {"rooms_imported": 0, "buildings_matched": 0}

        for way in ways.values():
            tags = way.get("tags", {})
            indoor_type = tags.get("indoor")
            if not indoor_type:
                continue

            coords = [nodes[nid] for nid in way.get("nodes", []) if nid in nodes]
            if len(coords) < 3:
                continue
            if coords[0] != coords[-1]:
                coords.append(coords[0])

            try:
                poly = ShapelyPolygon(coords)
                if not poly.is_valid or poly.is_empty:
                    continue
            except Exception:
                continue

            room_type = indoor_type
            name = tags.get("name") or tags.get("ref")
            level_str = tags.get("level", "0")
            level = int(level_str) if level_str.lstrip("-").isdigit() else 0

            # Match to a building by containment
            centroid_wkb = from_shape(poly.centroid, srid=4326)
            stmt = select(Building).where(ST_Contains(Building.geom, centroid_wkb)).limit(1)
            result = self._session.execute(stmt)
            building = result.scalar_one_or_none()
            if not building:
                continue

            stats["buildings_matched"] += 1

            room = InteriorRoom(
                building_id=building.id,
                level=level,
                room_type=room_type,
                name=name,
                area_sqm=poly.area * 111_000 * 111_000,  # rough deg² to m²
                geom=from_shape(poly, srid=4326),
            )
            self._session.add(room)
            stats["rooms_imported"] += 1

        self._session.commit()
        return stats
