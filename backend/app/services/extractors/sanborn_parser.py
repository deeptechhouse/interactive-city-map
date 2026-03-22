"""Specialised parser for Sanborn fire insurance maps.

Sanborn maps use a well-known colour-coding convention:
    - Pink / red  -> brick buildings
    - Yellow      -> frame (wood) buildings
    - Blue / gray -> stone buildings
    - Green       -> iron / fireproof construction
    - Hatching    -> various material / use indicators

This module detects building materials via HSV colour analysis and
hatching via FFT frequency peaks, then delegates room segmentation,
wall detection, and OCR to the sibling extractor classes.
"""

from __future__ import annotations

import cv2
import numpy as np

from app.services.extractors.line_detector import LineDetector
from app.services.extractors.room_segmenter import RoomSegmenter
from app.services.extractors.text_extractor import TextExtractor


class SanbornParser:
    """Full extraction pipeline tuned for Sanborn fire insurance maps."""

    # HSV colour ranges for Sanborn building materials (approximate)
    COLOR_RANGES: dict[str, dict[str, np.ndarray]] = {
        "brick": {"lower": np.array([0, 50, 50]), "upper": np.array([10, 255, 200])},
        "frame": {"lower": np.array([20, 50, 100]), "upper": np.array([35, 255, 255])},
        "stone": {"lower": np.array([100, 20, 80]), "upper": np.array([130, 100, 200])},
        "fireproof": {"lower": np.array([35, 50, 50]), "upper": np.array([85, 255, 200])},
    }

    # ------------------------------------------------------------------
    # Material detection
    # ------------------------------------------------------------------

    def detect_material(
        self,
        image: np.ndarray,
        building_mask: np.ndarray | None = None,
    ) -> str:
        """Detect building material from Sanborn colour coding.

        Args:
            image: BGR image of the Sanborn map region.
            building_mask: Optional binary mask confining the analysis
                to a single building footprint.

        Returns:
            Material string: ``"brick"``, ``"frame"``, ``"stone"``,
            ``"fireproof"``, or ``"unknown"``.
        """
        hsv = cv2.cvtColor(image, cv2.COLOR_BGR2HSV)

        if building_mask is not None:
            hsv = cv2.bitwise_and(hsv, hsv, mask=building_mask)

        total_pixels = (
            np.count_nonzero(building_mask) if building_mask is not None
            else image.shape[0] * image.shape[1]
        )
        if total_pixels == 0:
            return "unknown"

        best_match = "unknown"
        best_ratio = 0.0

        for material, ranges in self.COLOR_RANGES.items():
            mask = cv2.inRange(hsv, ranges["lower"], ranges["upper"])
            if building_mask is not None:
                mask = cv2.bitwise_and(mask, building_mask)
            ratio = np.count_nonzero(mask) / total_pixels
            if ratio > best_ratio and ratio > 0.1:
                best_ratio = ratio
                best_match = material

        return best_match

    # ------------------------------------------------------------------
    # Hatching detection
    # ------------------------------------------------------------------

    def detect_hatching(self, image: np.ndarray) -> bool:
        """Detect whether a region contains hatching patterns.

        Uses a 2-D FFT and checks for high-frequency magnitude peaks
        along the horizontal and vertical axes -- a signature of
        regularly-spaced parallel lines.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

        f_transform = np.fft.fft2(gray.astype(float))
        f_shift = np.fft.fftshift(f_transform)
        magnitude = np.log1p(np.abs(f_shift))

        h, w = magnitude.shape
        center_y, center_x = h // 2, w // 2

        margin = min(h, w) // 4
        strip_h = magnitude[center_y, center_x + margin:]
        strip_v = magnitude[center_y + margin:, center_x]

        threshold = np.mean(magnitude) * 2
        has_peaks_h = bool(np.any(strip_h > threshold))
        has_peaks_v = bool(np.any(strip_v > threshold))

        return has_peaks_h or has_peaks_v

    # ------------------------------------------------------------------
    # Full extraction pipeline
    # ------------------------------------------------------------------

    def extract_sanborn_rooms(self, image: np.ndarray) -> list[dict]:
        """Run the full Sanborn extraction pipeline.

        Returns:
            List of dicts with keys:
                ``polygon`` (Shapely Polygon), ``material``, ``name``,
                ``level``, ``area_px``.
        """
        # 1. Detect wall lines (tuned for Sanborn map scale)
        line_detector = LineDetector(min_line_length=20, max_line_gap=8)
        lines = line_detector.detect(image)

        # 2. Segment rooms
        segmenter = RoomSegmenter(min_room_area=200)
        contours = segmenter.segment(image, lines)
        polygons = segmenter.contours_to_polygons(contours)

        # 3. Extract and classify text labels
        text_ext = TextExtractor()
        text_regions = text_ext.extract_text_regions(image)
        text_regions = text_ext.classify_labels(text_regions)
        label_matches = text_ext.match_labels_to_rooms(text_regions, contours)

        # 4. Build per-room results with material detection
        results: list[dict] = []
        for i, (poly, cnt) in enumerate(zip(polygons, contours)):
            mask = np.zeros(image.shape[:2], dtype=np.uint8)
            cv2.drawContours(mask, [cnt], 0, 255, -1)
            material = self.detect_material(image, mask)

            room_labels = label_matches.get(i, [])
            room_name: str | None = None
            for label in room_labels:
                if label.get("label_type") == "room_name":
                    room_name = label["text"]
                    break

            results.append({
                "polygon": poly,
                "material": material,
                "name": room_name,
                "level": 0,  # Sanborn maps are typically ground floor
                "area_px": poly.area,
            })

        return results
