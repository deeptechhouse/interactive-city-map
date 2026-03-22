"""Orchestrates the full floor plan extraction pipeline.

Accepts a raster floor plan image (file path or raw bytes) and
produces vectorised GeoJSON for rooms, walls, and text labels.
Optionally persists results to the database.
"""

from __future__ import annotations

from typing import Any

import cv2
import numpy as np

from app.services.extractors.geojson_writer import GeoJSONWriter
from app.services.extractors.line_detector import LineDetector
from app.services.extractors.room_segmenter import RoomSegmenter
from app.services.extractors.sanborn_parser import SanbornParser
from app.services.extractors.text_extractor import TextExtractor


class FloorPlanExtractor:
    """Orchestrates the full floor plan extraction pipeline: image -> vectorised GeoJSON."""

    def __init__(self) -> None:
        self._line_detector = LineDetector()
        self._room_segmenter = RoomSegmenter()
        self._text_extractor = TextExtractor()
        self._sanborn_parser = SanbornParser()
        self._geojson_writer = GeoJSONWriter()

    # ------------------------------------------------------------------
    # Core extraction
    # ------------------------------------------------------------------

    def extract(
        self,
        image_path: str | None = None,
        image_data: bytes | None = None,
        source_type: str = "generic",
        affine: list[float] | None = None,
    ) -> dict[str, Any]:
        """Run the full extraction pipeline on a floor plan image.

        Provide either *image_path* (filesystem path) **or** *image_data*
        (raw bytes).

        Args:
            image_path: Path to an image file on disk.
            image_data: Raw image bytes (PNG, JPEG, etc.).
            source_type: ``"generic"``, ``"sanborn"``, or ``"venue_scrape"``.
            affine: Optional 6-float affine transform for georeferencing.

        Returns:
            Dict with keys:
                ``rooms_geojson``  — FeatureCollection of room polygons
                ``walls_geojson``  — FeatureCollection of wall linestrings
                ``text_labels``    — list of extracted text regions
                ``room_count``     — int
                ``wall_count``     — int
                ``source_type``    — str
        """
        image = self._load_image(image_path, image_data)

        if source_type == "sanborn":
            rooms_data, lines, text_labels = self._extract_sanborn(image)
        else:
            rooms_data, lines, text_labels = self._extract_generic(image)

        rooms_geojson = self._geojson_writer.rooms_to_geojson(rooms_data, affine)
        walls_geojson = self._geojson_writer.walls_to_geojson(lines, affine)

        return {
            "rooms_geojson": rooms_geojson,
            "walls_geojson": walls_geojson,
            "text_labels": text_labels,
            "room_count": len(rooms_data),
            "wall_count": len(lines),
            "source_type": source_type,
        }

    # ------------------------------------------------------------------
    # Extract + persist
    # ------------------------------------------------------------------

    def extract_and_store(
        self,
        source_id: Any,
        image_path: str | None = None,
        image_data: bytes | None = None,
        source_type: str = "generic",
        affine: list[float] | None = None,
        session: Any = None,
    ) -> dict[str, Any]:
        """Extract floor plan data and persist results to the database.

        Creates ``InteriorRoom`` and ``InteriorWall`` records from the
        extraction output and updates the associated ``InteriorSource``
        status to ``'extracted'``.

        When *session* is ``None`` the method behaves identically to
        :meth:`extract` (no database interaction).
        """
        result = self.extract(
            image_path=image_path,
            image_data=image_data,
            source_type=source_type,
            affine=affine,
        )

        if session is None:
            return result

        # Lazy imports — these models may not be available in all
        # runtime configurations (e.g. pure-CV testing).
        from geoalchemy2.shape import from_shape
        from shapely.geometry import shape
        from sqlalchemy import select, update

        from app.models.building import Building
        from app.models.interior_room import InteriorRoom
        from app.models.interior_source import InteriorSource
        from app.models.interior_wall import InteriorWall

        # Retrieve the source record
        stmt = select(InteriorSource).where(InteriorSource.id == source_id)
        source = session.execute(stmt).scalar_one_or_none()
        if source is None:
            return result

        building_id = source.building_id

        # Persist rooms
        for feature in result["rooms_geojson"].get("features", []):
            geom_shape = shape(feature["geometry"])
            props = feature["properties"]
            room = InteriorRoom(
                building_id=building_id,
                source_id=source_id,
                level=props.get("level", 0),
                room_type=props.get("room_type"),
                name=props.get("name"),
                area_sqm=props.get("area_sqm"),
                geom=from_shape(geom_shape, srid=4326),
            )
            session.add(room)

        # Persist walls
        for feature in result["walls_geojson"].get("features", []):
            geom_shape = shape(feature["geometry"])
            wall = InteriorWall(
                building_id=building_id,
                source_id=source_id,
                level=0,
                wall_type=feature["properties"].get("wall_type", "interior"),
                geom=from_shape(geom_shape, srid=4326),
            )
            session.add(wall)

        # Update source status
        source.status = "extracted"
        source.geojson = result["rooms_geojson"]

        # Flag the building as having interior data
        stmt = update(Building).where(Building.id == building_id).values(has_interior=True)
        session.execute(stmt)

        session.commit()
        return result

    # ------------------------------------------------------------------
    # Internal helpers
    # ------------------------------------------------------------------

    @staticmethod
    def _load_image(
        image_path: str | None,
        image_data: bytes | None,
    ) -> np.ndarray:
        """Load an image from file path or raw bytes."""
        if image_path:
            image = cv2.imread(image_path)
        elif image_data:
            nparr = np.frombuffer(image_data, np.uint8)
            image = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
        else:
            raise ValueError("Must provide image_path or image_data")

        if image is None:
            raise ValueError("Failed to load image")

        return image

    def _extract_sanborn(
        self,
        image: np.ndarray,
    ) -> tuple[list[dict], list[tuple[int, int, int, int]], list[dict]]:
        """Sanborn-specific extraction branch."""
        rooms_data = self._sanborn_parser.extract_sanborn_rooms(image)
        lines = self._line_detector.detect(image)
        text_labels = self._text_extractor.extract_text_regions(image)
        text_labels = self._text_extractor.classify_labels(text_labels)
        return rooms_data, lines, text_labels

    def _extract_generic(
        self,
        image: np.ndarray,
    ) -> tuple[list[dict], list[tuple[int, int, int, int]], list[dict]]:
        """Generic floor plan extraction branch."""
        lines = self._line_detector.detect(image)
        contours = self._room_segmenter.segment(image, lines)
        polygons = self._room_segmenter.contours_to_polygons(contours)

        text_labels = self._text_extractor.extract_text_regions(image)
        text_labels = self._text_extractor.classify_labels(text_labels)
        label_matches = self._text_extractor.match_labels_to_rooms(text_labels, contours)

        rooms_data: list[dict] = []
        for i, poly in enumerate(polygons):
            room_labels = label_matches.get(i, [])
            room_name: str | None = None
            room_type = "room"
            for label in room_labels:
                if label.get("label_type") == "room_name":
                    room_name = label["text"]
                    room_type = label["text"].lower().split()[0]
                    break

            rooms_data.append({
                "polygon": poly,
                "name": room_name,
                "room_type": room_type,
                "level": 0,
                "area_px": poly.area,
            })

        return rooms_data, lines, text_labels
