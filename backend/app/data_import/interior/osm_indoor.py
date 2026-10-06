"""Imports indoor mapping data from OpenStreetMap via Overpass API.

PURPOSE
    Turn OSM ``indoor=*`` ways inside one city's bbox into InteriorRoom rows,
    each attached to the building whose footprint contains the room centroid.

FLOW
    import_to_db() → fetch_indoor_data() (one Overpass call)
        → _parse_rooms()        index nodes, build valid room polygons
        → _match_buildings()    ONE containment query per 1000 rooms
        → InteriorRoom rows, one commit.

TRAP (fixed 2026-10-06, Big O audit): the old loop ran one
``ST_Contains`` query per way — W database round trips for W rooms. The
containment test now runs as a single join against a VALUES list of
centroids (chunked), so a city's import is a handful of round trips. Like
the old ``LIMIT 1``, a centroid inside two overlapping footprints takes one
of them arbitrarily (``DISTINCT ON``).
"""

from __future__ import annotations

from dataclasses import dataclass

import httpx
from geoalchemy2.functions import ST_Contains
from geoalchemy2.shape import from_shape
from shapely.geometry import Polygon as ShapelyPolygon
from sqlalchemy import Integer, Text, column, func, select, values
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.interior_room import InteriorRoom

# ADJUSTABLE: centroids per containment query. Larger = fewer round trips but a
# bigger statement; 1000 keeps each statement well under 100 KB of WKT.
MATCH_CHUNK = 1000


@dataclass(frozen=True)
class _RoomCandidate:
    """A valid indoor polygon waiting for its building (pure data)."""

    poly: ShapelyPolygon
    room_type: str
    name: str | None
    level: int


class OSMIndoorImporter:
    """Imports indoor mapping data from OpenStreetMap via Overpass API."""

    OVERPASS_URL = "https://overpass-api.de/api/interpreter"

    # O(1) time, O(1) space
    def __init__(self, session: Session, city_bounds: tuple[float, float, float, float]):
        """
        Args:
            session: Sync SQLAlchemy session.
            city_bounds: (south, west, north, east) for the Overpass bbox.
        """
        self._session = session
        self._bounds = city_bounds

    # O(n) time, O(n) space — n = Overpass response size
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

    # O(n + W log B) time, O(n) space — n = Overpass elements; W = indoor rooms; B = buildings (GiST lookups)
    def import_to_db(self) -> dict:
        """Fetch OSM indoor data and create InteriorRoom records.

        Returns:
            dict with counts: rooms_imported, buildings_matched.
        """
        candidates = self._parse_rooms(self.fetch_indoor_data())
        building_ids = self._match_buildings(candidates)

        stats = {"rooms_imported": 0, "buildings_matched": 0}
        # O(W) time, O(W) space — W = indoor rooms (session.add only queues, one commit at the end)
        for idx, room in enumerate(candidates):
            building_id = building_ids.get(idx)
            if building_id is None:
                continue
            stats["buildings_matched"] += 1
            self._session.add(
                InteriorRoom(
                    building_id=building_id,
                    level=room.level,
                    room_type=room.room_type,
                    name=room.name,
                    area_sqm=room.poly.area * 111_000 * 111_000,  # rough deg² to m²
                    geom=from_shape(room.poly, srid=4326),
                )
            )
            stats["rooms_imported"] += 1

        self._session.commit()
        return stats

    # O(n) time, O(n) space — n = Overpass elements (node refs included)
    @staticmethod
    def _parse_rooms(data: dict) -> list[_RoomCandidate]:
        """Index nodes, then keep each indoor way that forms a valid polygon."""
        nodes: dict[int, tuple[float, float]] = {}
        ways: dict[int, dict] = {}
        # O(n) time, O(n) space — n = Overpass elements
        for elem in data.get("elements", []):
            if elem["type"] == "node":
                nodes[elem["id"]] = (elem["lon"], elem["lat"])
            elif elem["type"] == "way":
                ways[elem["id"]] = elem

        out: list[_RoomCandidate] = []
        # O(n) time, O(n) space — n = node refs across all ways (each dict lookup is constant)
        for way in ways.values():
            tags = way.get("tags", {})
            indoor_type = tags.get("indoor")
            if not indoor_type:
                continue

            # O(r) time, O(r) space — r = node refs of this way (sums to n)
            # bigo-lint: disable=BIGO006 — amortised: every node ref is read once across all ways
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

            level_str = tags.get("level", "0")
            out.append(
                _RoomCandidate(
                    poly=poly,
                    room_type=indoor_type,
                    name=tags.get("name") or tags.get("ref"),
                    level=int(level_str) if level_str.lstrip("-").isdigit() else 0,
                )
            )
        return out

    # O(W log B) time, O(W) space — W = room candidates; B = buildings (each containment probe uses the GiST index)
    def _match_buildings(self, candidates: list[_RoomCandidate]) -> dict[int, object]:
        """Candidate index → id of a building containing that room's centroid."""
        found: dict[int, object] = {}
        # O(W log B) time, O(W) space — W = room candidates in chunks of MATCH_CHUNK; B = buildings
        for start in range(0, len(candidates), MATCH_CHUNK):
            chunk = candidates[start : start + MATCH_CHUNK]
            centroids = values(column("idx", Integer), column("wkt", Text), name="centroids").data(
                # O(c) time, O(c) space — c = rooms in this chunk (sums to W)
                # bigo-lint: disable=BIGO006 — amortised: each candidate is in exactly one chunk
                [(start + k, room.poly.centroid.wkt) for k, room in enumerate(chunk)]
            )
            stmt = (
                select(centroids.c.idx, Building.id)
                .select_from(centroids)
                .join(
                    Building,
                    ST_Contains(Building.geom, func.ST_GeomFromText(centroids.c.wkt, 4326)),
                )
                .distinct(
                    centroids.c.idx
                )  # Postgres DISTINCT ON — one building per room, like LIMIT 1
                .order_by(centroids.c.idx)
            )
            # O(c) time, O(c) space — c = matched rows in this chunk
            # bigo-lint: disable=BIGO006 — amortised: at most one row per candidate across all chunks
            for idx, building_id in self._session.execute(stmt):
                found[idx] = building_id
        return found
