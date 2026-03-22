"""Room polygon segmentation from floor plan images."""

from __future__ import annotations

import cv2
import numpy as np
from shapely.geometry import Polygon


class RoomSegmenter:
    """Segments floor plan images into room polygons using contour detection.

    Workflow:
    1. Binarize the image (Otsu threshold).
    2. Optionally reinforce wall boundaries from pre-detected line segments.
    3. Morphological closing + dilation to seal gaps in walls.
    4. Invert to get filled room regions.
    5. Extract and simplify contours.
    """

    def __init__(self, min_room_area: int = 500, max_room_area: int = 500_000) -> None:
        self._min_room_area = min_room_area  # pixels
        self._max_room_area = max_room_area

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def segment(
        self,
        image: np.ndarray,
        wall_lines: list[tuple[int, int, int, int]] | None = None,
    ) -> list[np.ndarray]:
        """Segment image into room contours.

        Args:
            image: BGR numpy array.
            wall_lines: Optional pre-detected wall lines to reinforce
                boundaries before segmentation.

        Returns:
            List of contour arrays (each is an Nx1x2 int array of
            polygon vertices suitable for ``cv2.drawContours``).
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

        # Threshold to isolate walls (dark lines on light background)
        _, binary = cv2.threshold(gray, 0, 255, cv2.THRESH_BINARY_INV + cv2.THRESH_OTSU)

        # Reinforce detected wall lines onto the binary mask
        if wall_lines:
            for x1, y1, x2, y2 in wall_lines:
                cv2.line(binary, (x1, y1), (x2, y2), 255, 2)

        # Close small gaps in wall segments
        kernel = np.ones((5, 5), np.uint8)
        closed = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=2)

        # Dilate walls slightly to guarantee closure
        dilated = cv2.dilate(closed, np.ones((3, 3), np.uint8), iterations=1)

        # Invert so rooms (enclosed white areas) become foreground
        inverted = cv2.bitwise_not(dilated)

        # Extract contours with hierarchy
        contours, _hierarchy = cv2.findContours(inverted, cv2.RETR_TREE, cv2.CHAIN_APPROX_SIMPLE)

        rooms: list[np.ndarray] = []
        for cnt in contours:
            area = cv2.contourArea(cnt)
            if not (self._min_room_area <= area <= self._max_room_area):
                continue
            # Simplify to reduce vertex count
            epsilon = 0.01 * cv2.arcLength(cnt, True)
            approx = cv2.approxPolyDP(cnt, epsilon, True)
            if len(approx) >= 3:
                rooms.append(approx)

        return rooms

    def contours_to_polygons(self, contours: list[np.ndarray]) -> list[Polygon]:
        """Convert OpenCV contours to Shapely Polygons.

        Invalid or degenerate polygons are silently skipped.
        """
        polygons: list[Polygon] = []
        for cnt in contours:
            pts = [(int(p[0][0]), int(p[0][1])) for p in cnt]
            if len(pts) < 3:
                continue
            try:
                poly = Polygon(pts)
                if poly.is_valid and not poly.is_empty:
                    polygons.append(poly)
            except Exception:
                continue
        return polygons
