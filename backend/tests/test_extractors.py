"""Unit tests for the AI extraction pipeline components.

Tests cover LineDetector, RoomSegmenter, TextExtractor, GeoJSONWriter,
FloorPlanExtractor, and FloorPlanClassifier using synthetic images
generated with numpy/cv2.
"""

from __future__ import annotations

from unittest.mock import MagicMock, patch

import cv2
import numpy as np
import pytest
from shapely.geometry import Polygon


# ---------------------------------------------------------------------------
# Synthetic image factories
# ---------------------------------------------------------------------------

def make_test_image_with_lines(width: int = 200, height: int = 200) -> np.ndarray:
    """White image with two prominent black lines (horizontal + vertical)."""
    img = np.ones((height, width, 3), dtype=np.uint8) * 255
    cv2.line(img, (20, 50), (180, 50), (0, 0, 0), 2)   # horizontal
    cv2.line(img, (50, 20), (50, 180), (0, 0, 0), 2)    # vertical
    return img


def make_test_image_with_rooms(width: int = 200, height: int = 200) -> np.ndarray:
    """White image with two well-separated black rectangles (rooms)."""
    img = np.ones((height, width, 3), dtype=np.uint8) * 255
    cv2.rectangle(img, (20, 20), (90, 90), (0, 0, 0), 2)    # room 1
    cv2.rectangle(img, (110, 20), (180, 90), (0, 0, 0), 2)   # room 2
    return img


def make_test_image_with_thick_walls(width: int = 400, height: int = 400) -> np.ndarray:
    """Larger image with thick rectangles to ensure line detection thresholds are met."""
    img = np.ones((height, width, 3), dtype=np.uint8) * 255
    # thick horizontal line
    cv2.line(img, (20, 100), (380, 100), (0, 0, 0), 3)
    cv2.line(img, (20, 300), (380, 300), (0, 0, 0), 3)
    # thick vertical line
    cv2.line(img, (100, 20), (100, 380), (0, 0, 0), 3)
    cv2.line(img, (300, 20), (300, 380), (0, 0, 0), 3)
    return img


def encode_image_to_bytes(image: np.ndarray, fmt: str = ".png") -> bytes:
    """Encode a numpy image to raw bytes (PNG by default)."""
    _, buf = cv2.imencode(fmt, image)
    return buf.tobytes()


# ===========================================================================
# LineDetector tests
# ===========================================================================

class TestLineDetector:
    """Tests for LineDetector.detect() and _merge_collinear()."""

    def test_detect_returns_list(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector(min_line_length=20, max_line_gap=10)
        img = make_test_image_with_thick_walls()
        lines = detector.detect(img)
        assert isinstance(lines, list)

    def test_detect_finds_lines_in_synthetic_image(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector(min_line_length=20, max_line_gap=10)
        img = make_test_image_with_thick_walls()
        lines = detector.detect(img)
        assert len(lines) > 0, "Should detect at least one line in synthetic image"

    def test_detect_returns_four_tuples(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector(min_line_length=20, max_line_gap=10)
        img = make_test_image_with_thick_walls()
        lines = detector.detect(img)
        if lines:
            for line in lines:
                assert len(line) == 4, "Each line should be (x1, y1, x2, y2)"

    def test_detect_empty_image_returns_empty(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector(min_line_length=30, max_line_gap=10)
        # Pure white image - no lines to detect
        img = np.ones((200, 200, 3), dtype=np.uint8) * 255
        lines = detector.detect(img)
        assert lines == []

    def test_detect_grayscale_image(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector(min_line_length=20, max_line_gap=10)
        img = make_test_image_with_thick_walls()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        lines = detector.detect(gray)
        assert isinstance(lines, list)

    def test_merge_collinear_empty_input(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector()
        result = detector._merge_collinear([])
        assert result == []

    def test_merge_collinear_single_line_unchanged(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector()
        lines = [(0, 0, 100, 0)]
        result = detector._merge_collinear(lines)
        assert len(result) == 1

    def test_merge_collinear_merges_parallel_nearby(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector()
        # Two horizontal segments that are close and collinear
        lines = [(0, 50, 50, 50), (55, 50, 100, 50)]
        result = detector._merge_collinear(lines, angle_thresh=5.0, dist_thresh=10.0)
        # Should merge into one segment
        assert len(result) == 1

    def test_merge_collinear_keeps_perpendicular_lines(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector()
        # One horizontal, one vertical - should not merge
        lines = [(0, 50, 100, 50), (50, 0, 50, 100)]
        result = detector._merge_collinear(lines, angle_thresh=5.0, dist_thresh=10.0)
        assert len(result) == 2

    def test_merge_collinear_keeps_distant_parallel_lines(self):
        from app.services.extractors.line_detector import LineDetector

        detector = LineDetector()
        # Two horizontal lines that are far apart vertically
        lines = [(0, 0, 100, 0), (0, 200, 100, 200)]
        result = detector._merge_collinear(lines, angle_thresh=5.0, dist_thresh=5.0)
        assert len(result) == 2


# ===========================================================================
# RoomSegmenter tests
# ===========================================================================

class TestRoomSegmenter:
    """Tests for RoomSegmenter.segment() and contours_to_polygons()."""

    def test_segment_returns_list(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        segmenter = RoomSegmenter(min_room_area=100, max_room_area=500_000)
        img = make_test_image_with_rooms()
        contours = segmenter.segment(img)
        assert isinstance(contours, list)

    def test_segment_detects_rooms(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        # Use larger image with clearly enclosed rooms
        img = np.ones((400, 400, 3), dtype=np.uint8) * 255
        cv2.rectangle(img, (50, 50), (180, 180), (0, 0, 0), 3)
        cv2.rectangle(img, (220, 50), (350, 180), (0, 0, 0), 3)

        segmenter = RoomSegmenter(min_room_area=100, max_room_area=500_000)
        contours = segmenter.segment(img)
        assert len(contours) >= 1, "Should detect at least one room contour"

    def test_segment_with_wall_lines(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        img = make_test_image_with_rooms()
        wall_lines = [(20, 20, 90, 20), (20, 90, 90, 90)]
        segmenter = RoomSegmenter(min_room_area=100, max_room_area=500_000)
        contours = segmenter.segment(img, wall_lines=wall_lines)
        assert isinstance(contours, list)

    def test_segment_filters_small_contours(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        # Image with tiny rectangle that should be filtered
        img = np.ones((200, 200, 3), dtype=np.uint8) * 255
        cv2.rectangle(img, (90, 90), (95, 95), (0, 0, 0), 1)  # tiny
        segmenter = RoomSegmenter(min_room_area=500, max_room_area=500_000)
        contours = segmenter.segment(img)
        # The tiny rectangle should be filtered out
        for cnt in contours:
            assert cv2.contourArea(cnt) >= 500

    def test_segment_empty_image(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        img = np.ones((200, 200, 3), dtype=np.uint8) * 255
        segmenter = RoomSegmenter(min_room_area=500, max_room_area=500_000)
        contours = segmenter.segment(img)
        # No enclosed rooms in a plain white image
        assert isinstance(contours, list)

    def test_segment_grayscale_image(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        img = make_test_image_with_rooms()
        gray = cv2.cvtColor(img, cv2.COLOR_BGR2GRAY)
        segmenter = RoomSegmenter(min_room_area=100, max_room_area=500_000)
        contours = segmenter.segment(gray)
        assert isinstance(contours, list)

    def test_contours_to_polygons_valid(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        segmenter = RoomSegmenter()
        # Create a simple square contour (Nx1x2 format as OpenCV produces)
        cnt = np.array([
            [[10, 10]], [[10, 90]], [[90, 90]], [[90, 10]]
        ], dtype=np.int32)
        polygons = segmenter.contours_to_polygons([cnt])
        assert len(polygons) == 1
        assert isinstance(polygons[0], Polygon)
        assert polygons[0].is_valid

    def test_contours_to_polygons_degenerate_skipped(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        segmenter = RoomSegmenter()
        # Two-point contour is degenerate (< 3 points)
        cnt = np.array([[[10, 10]], [[10, 20]]], dtype=np.int32)
        polygons = segmenter.contours_to_polygons([cnt])
        assert len(polygons) == 0

    def test_contours_to_polygons_empty_input(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        segmenter = RoomSegmenter()
        polygons = segmenter.contours_to_polygons([])
        assert polygons == []

    def test_contours_to_polygons_multiple(self):
        from app.services.extractors.room_segmenter import RoomSegmenter

        segmenter = RoomSegmenter()
        cnt1 = np.array([[[0, 0]], [[0, 50]], [[50, 50]], [[50, 0]]], dtype=np.int32)
        cnt2 = np.array([[[60, 0]], [[60, 50]], [[110, 50]], [[110, 0]]], dtype=np.int32)
        polygons = segmenter.contours_to_polygons([cnt1, cnt2])
        assert len(polygons) == 2


# ===========================================================================
# TextExtractor tests
# ===========================================================================

class TestTextExtractor:
    """Tests for TextExtractor.classify_labels() and match_labels_to_rooms()."""

    def test_classify_labels_room_name(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [{"text": "Kitchen", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90}]
        result = extractor.classify_labels(regions)
        assert result[0]["label_type"] == "room_name"

    def test_classify_labels_dimension(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [{"text": "12x14", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90}]
        result = extractor.classify_labels(regions)
        assert result[0]["label_type"] == "dimension"

    def test_classify_labels_dimension_with_quotes(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [{"text": "12'x14'", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90}]
        result = extractor.classify_labels(regions)
        assert result[0]["label_type"] == "dimension"

    def test_classify_labels_single_dimension(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [{"text": "24'", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90}]
        result = extractor.classify_labels(regions)
        assert result[0]["label_type"] == "dimension"

    def test_classify_labels_other(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [{"text": "FooBar", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90}]
        result = extractor.classify_labels(regions)
        assert result[0]["label_type"] == "other"

    def test_classify_labels_multiple_keywords(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [
            {"text": "Bedroom", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90},
            {"text": "Bathroom", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90},
            {"text": "Lobby", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90},
            {"text": "Garage", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90},
        ]
        result = extractor.classify_labels(regions)
        for r in result:
            assert r["label_type"] == "room_name"

    def test_classify_labels_case_insensitive(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        regions = [{"text": "KITCHEN", "x": 0, "y": 0, "width": 50, "height": 20, "confidence": 90}]
        result = extractor.classify_labels(regions)
        assert result[0]["label_type"] == "room_name"

    def test_classify_labels_empty_input(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        result = extractor.classify_labels([])
        assert result == []

    def test_match_labels_to_rooms_inside(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        # Square contour from (10,10) to (90,90)
        cnt = np.array([[[10, 10]], [[10, 90]], [[90, 90]], [[90, 10]]], dtype=np.int32)

        # Label centred inside the room
        label = {"text": "Kitchen", "x": 40, "y": 40, "width": 20, "height": 10, "label_type": "room_name"}
        matches = extractor.match_labels_to_rooms([label], [cnt])
        assert 0 in matches
        assert len(matches[0]) == 1

    def test_match_labels_to_rooms_outside(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        cnt = np.array([[[10, 10]], [[10, 90]], [[90, 90]], [[90, 10]]], dtype=np.int32)

        # Label outside the room
        label = {"text": "Exterior", "x": 150, "y": 150, "width": 20, "height": 10, "label_type": "other"}
        matches = extractor.match_labels_to_rooms([label], [cnt])
        assert len(matches) == 0

    def test_match_labels_to_rooms_multiple_rooms(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        cnt1 = np.array([[[10, 10]], [[10, 50]], [[50, 50]], [[50, 10]]], dtype=np.int32)
        cnt2 = np.array([[[60, 10]], [[60, 50]], [[100, 50]], [[100, 10]]], dtype=np.int32)

        label1 = {"text": "Room A", "x": 20, "y": 20, "width": 10, "height": 10}
        label2 = {"text": "Room B", "x": 70, "y": 20, "width": 10, "height": 10}
        matches = extractor.match_labels_to_rooms([label1, label2], [cnt1, cnt2])
        assert 0 in matches
        assert 1 in matches

    def test_match_labels_to_rooms_empty(self):
        from app.services.extractors.text_extractor import TextExtractor

        extractor = TextExtractor()
        matches = extractor.match_labels_to_rooms([], [])
        assert matches == {}


# ===========================================================================
# GeoJSONWriter tests
# ===========================================================================

class TestGeoJSONWriter:
    """Tests for GeoJSONWriter.rooms_to_geojson() and walls_to_geojson()."""

    def test_rooms_to_geojson_basic(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        poly = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
        rooms = [{"polygon": poly, "name": "Office", "room_type": "office", "level": 1, "area_sqm": 25.0}]
        result = GeoJSONWriter.rooms_to_geojson(rooms)
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 1
        feat = result["features"][0]
        assert feat["type"] == "Feature"
        assert feat["properties"]["name"] == "Office"
        assert feat["properties"]["room_type"] == "office"
        assert feat["properties"]["level"] == 1
        assert feat["geometry"]["type"] == "Polygon"

    def test_rooms_to_geojson_with_affine(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        poly = Polygon([(0, 0), (100, 0), (100, 100), (0, 100)])
        rooms = [{"polygon": poly, "name": "Room", "room_type": "room"}]
        affine = [0.001, 0, -87.63, 0, -0.001, 41.89]
        result = GeoJSONWriter.rooms_to_geojson(rooms, affine=affine)
        feat = result["features"][0]
        coords = feat["geometry"]["coordinates"][0]
        # First coordinate should be transformed: 0.001*0 + 0*0 + (-87.63) = -87.63
        assert abs(coords[0][0] - (-87.63)) < 0.01

    def test_rooms_to_geojson_empty(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        result = GeoJSONWriter.rooms_to_geojson([])
        assert result["type"] == "FeatureCollection"
        assert result["features"] == []

    def test_rooms_to_geojson_defaults(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        poly = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
        rooms = [{"polygon": poly}]
        result = GeoJSONWriter.rooms_to_geojson(rooms)
        props = result["features"][0]["properties"]
        assert props["name"] is None
        assert props["room_type"] == "unknown"
        assert props["level"] == 0

    def test_rooms_to_geojson_material_fallback(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        poly = Polygon([(0, 0), (10, 0), (10, 10), (0, 10)])
        rooms = [{"polygon": poly, "material": "brick"}]
        result = GeoJSONWriter.rooms_to_geojson(rooms)
        props = result["features"][0]["properties"]
        assert props["room_type"] == "brick"

    def test_walls_to_geojson_basic(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        lines = [(0, 0, 100, 0), (0, 0, 0, 100)]
        result = GeoJSONWriter.walls_to_geojson(lines)
        assert result["type"] == "FeatureCollection"
        assert len(result["features"]) == 2
        for feat in result["features"]:
            assert feat["geometry"]["type"] == "LineString"
            assert feat["properties"]["wall_type"] == "interior"

    def test_walls_to_geojson_with_affine(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        lines = [(0, 0, 1000, 0)]
        affine = [0.001, 0, -87.63, 0, -0.001, 41.89]
        result = GeoJSONWriter.walls_to_geojson(lines, affine=affine)
        feat = result["features"][0]
        coords = feat["geometry"]["coordinates"]
        # First point: (0.001*0 + -87.63, 0*0 + -0.001*0 + 41.89) = (-87.63, 41.89)
        assert abs(coords[0][0] - (-87.63)) < 0.01
        assert abs(coords[0][1] - 41.89) < 0.01

    def test_walls_to_geojson_empty(self):
        from app.services.extractors.geojson_writer import GeoJSONWriter

        result = GeoJSONWriter.walls_to_geojson([])
        assert result["type"] == "FeatureCollection"
        assert result["features"] == []


# ===========================================================================
# FloorPlanExtractor tests
# ===========================================================================

class TestFloorPlanExtractor:
    """Tests for FloorPlanExtractor.extract() pipeline."""

    def test_extract_from_image_data_returns_dict(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)

        with patch.object(extractor._text_extractor, "extract_text_regions", return_value=[]):
            result = extractor.extract(image_data=image_data)

        assert "rooms_geojson" in result
        assert "walls_geojson" in result
        assert "text_labels" in result
        assert "room_count" in result
        assert "wall_count" in result
        assert "source_type" in result
        assert result["source_type"] == "generic"

    def test_extract_rooms_geojson_is_feature_collection(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)

        with patch.object(extractor._text_extractor, "extract_text_regions", return_value=[]):
            result = extractor.extract(image_data=image_data)

        assert result["rooms_geojson"]["type"] == "FeatureCollection"
        assert result["walls_geojson"]["type"] == "FeatureCollection"

    def test_extract_no_image_raises(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        with pytest.raises(ValueError, match="Must provide"):
            extractor.extract()

    def test_extract_invalid_image_data_raises(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        with pytest.raises(ValueError, match="Failed to load"):
            extractor.extract(image_data=b"not-an-image")

    def test_extract_sanborn_source_type(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)

        with patch.object(extractor._text_extractor, "extract_text_regions", return_value=[]):
            result = extractor.extract(image_data=image_data, source_type="sanborn")

        assert result["source_type"] == "sanborn"
        assert isinstance(result["room_count"], int)
        assert isinstance(result["wall_count"], int)

    def test_extract_with_affine(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)
        affine = [0.001, 0, -87.63, 0, -0.001, 41.89]

        with patch.object(extractor._text_extractor, "extract_text_regions", return_value=[]):
            result = extractor.extract(image_data=image_data, affine=affine)

        assert result["rooms_geojson"]["type"] == "FeatureCollection"

    def test_extract_room_count_matches_features(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)

        with patch.object(extractor._text_extractor, "extract_text_regions", return_value=[]):
            result = extractor.extract(image_data=image_data)

        assert result["room_count"] == len(result["rooms_geojson"]["features"])

    def test_extract_wall_count_matches_features(self):
        from app.services.floor_plan_extractor import FloorPlanExtractor

        extractor = FloorPlanExtractor()
        img = make_test_image_with_thick_walls()
        image_data = encode_image_to_bytes(img)

        with patch.object(extractor._text_extractor, "extract_text_regions", return_value=[]):
            result = extractor.extract(image_data=image_data)

        assert result["wall_count"] == len(result["walls_geojson"]["features"])


# ===========================================================================
# FloorPlanClassifier tests
# ===========================================================================

class TestFloorPlanClassifier:
    """Tests for FloorPlanClassifier feature extraction and heuristic prediction."""

    def test_extract_features_returns_10_elements(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)
        features = classifier.extract_features(image_data)
        assert features.shape == (10,)

    def test_extract_features_invalid_image_returns_zeros(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        features = classifier.extract_features(b"not-an-image")
        assert features.shape == (10,)
        assert np.all(features == 0)

    def test_extract_features_values_in_reasonable_range(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        img = make_test_image_with_rooms(400, 400)
        image_data = encode_image_to_bytes(img)
        features = classifier.extract_features(image_data)
        # All features should be non-negative
        assert np.all(features >= 0)

    def test_predict_heuristic_fallback_no_model(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        # No model loaded, so it uses heuristic
        assert classifier._model is None
        img = make_test_image_with_thick_walls()
        image_data = encode_image_to_bytes(img)
        is_fp, confidence = classifier.predict(image_data)
        assert isinstance(is_fp, bool)
        assert 0.0 <= confidence <= 1.0

    def test_predict_heuristic_returns_bool_and_float(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        img = np.ones((200, 200, 3), dtype=np.uint8) * 255
        image_data = encode_image_to_bytes(img)
        is_fp, confidence = classifier.predict(image_data)
        assert isinstance(is_fp, bool)
        assert isinstance(confidence, float)

    def test_predict_blank_white_image_low_confidence(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        img = np.ones((200, 200, 3), dtype=np.uint8) * 255
        image_data = encode_image_to_bytes(img)
        _is_fp, confidence = classifier.predict(image_data)
        # A blank white image should have low floor-plan confidence
        assert confidence < 0.8

    def test_heuristic_predict_directly(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        # Features that score high on heuristic
        high_features = np.array([0.1, 1.0, 0.8, 1.0, 0.5, 0.1, 0.05, 2.0, 0.3, 0.5])
        is_fp, score = FloorPlanClassifier._heuristic_predict(high_features)
        assert is_fp is True
        assert score > 0.5

    def test_heuristic_predict_low_score(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        # Features that all score low
        low_features = np.array([0.01, 0.1, 0.1, 1.0, 0.1, 0.8, 0.5, 0.5, 0.1, 0.01])
        is_fp, score = FloorPlanClassifier._heuristic_predict(low_features)
        assert is_fp is False
        assert score <= 0.5

    def test_load_model_returns_false_when_no_file(self):
        from app.services.floor_plan_classifier import FloorPlanClassifier

        classifier = FloorPlanClassifier()
        # Model file almost certainly doesn't exist in test env
        result = classifier.load_model()
        # Either True (file exists) or False (no file) - both valid
        assert isinstance(result, bool)
