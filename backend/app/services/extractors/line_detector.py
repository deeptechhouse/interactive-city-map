"""Wall line detection for floor plan images using Hough Transform."""

from __future__ import annotations

import cv2
import numpy as np


class LineDetector:
    """Detects wall lines in floor plan images using Hough Transform.

    Applies adaptive thresholding, morphological cleanup, Canny edge
    detection, and probabilistic Hough line extraction.  Nearby collinear
    segments are merged to reduce fragmentation.
    """

    def __init__(self, min_line_length: int = 30, max_line_gap: int = 10) -> None:
        self._min_line_length = min_line_length
        self._max_line_gap = max_line_gap

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def detect(self, image: np.ndarray) -> list[tuple[int, int, int, int]]:
        """Detect lines in a floor plan image.

        Args:
            image: BGR numpy array from ``cv2.imread``.

        Returns:
            List of ``(x1, y1, x2, y2)`` line segments.
        """
        gray = cv2.cvtColor(image, cv2.COLOR_BGR2GRAY) if len(image.shape) == 3 else image

        # Adaptive threshold handles variable lighting across the scan
        binary = cv2.adaptiveThreshold(
            gray, 255, cv2.ADAPTIVE_THRESH_GAUSSIAN_C, cv2.THRESH_BINARY_INV, 11, 2
        )

        # Morphological close to bridge small gaps in wall lines
        kernel = np.ones((3, 3), np.uint8)
        binary = cv2.morphologyEx(binary, cv2.MORPH_CLOSE, kernel, iterations=1)

        # Canny edge detection feeds the Hough transform
        edges = cv2.Canny(binary, 50, 150, apertureSize=3)

        # Probabilistic Hough Line Transform
        lines_raw = cv2.HoughLinesP(
            edges,
            rho=1,
            theta=np.pi / 180,
            threshold=50,
            minLineLength=self._min_line_length,
            maxLineGap=self._max_line_gap,
        )

        if lines_raw is None:
            return []

        lines: list[tuple[int, int, int, int]] = [
            (int(seg[0][0]), int(seg[0][1]), int(seg[0][2]), int(seg[0][3]))
            for seg in lines_raw
        ]

        return self._merge_collinear(lines)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _merge_collinear(
        self,
        lines: list[tuple[int, int, int, int]],
        angle_thresh: float = 5.0,
        dist_thresh: float = 10.0,
    ) -> list[tuple[int, int, int, int]]:
        """Merge lines that are approximately collinear and close together.

        Groups segments whose angles differ by less than *angle_thresh*
        degrees and whose midpoints are within a distance proportional
        to *dist_thresh* plus half the longer segment length.  Each
        group is collapsed to a single bounding segment.
        """
        if not lines:
            return []

        merged: list[tuple[int, int, int, int]] = []
        used: set[int] = set()

        for i, (x1, y1, x2, y2) in enumerate(lines):
            if i in used:
                continue

            angle_i = np.degrees(np.arctan2(y2 - y1, x2 - x1)) % 180
            group: list[tuple[int, int, int, int]] = [(x1, y1, x2, y2)]
            used.add(i)

            for j, (x3, y3, x4, y4) in enumerate(lines):
                if j in used:
                    continue

                angle_j = np.degrees(np.arctan2(y4 - y3, x4 - x3)) % 180

                angle_diff = abs(angle_i - angle_j)
                if angle_diff > angle_thresh and abs(angle_diff - 180) > angle_thresh:
                    continue

                # Distance between midpoints
                mid_i = ((x1 + x2) / 2, (y1 + y2) / 2)
                mid_j = ((x3 + x4) / 2, (y3 + y4) / 2)
                dist = np.sqrt((mid_i[0] - mid_j[0]) ** 2 + (mid_i[1] - mid_j[1]) ** 2)

                max_half_len = max(
                    np.sqrt((x2 - x1) ** 2 + (y2 - y1) ** 2),
                    np.sqrt((x4 - x3) ** 2 + (y4 - y3) ** 2),
                ) / 2

                if dist < dist_thresh + max_half_len:
                    group.append((x3, y3, x4, y4))
                    used.add(j)

            # Collapse group to a single bounding segment
            all_pts = [(seg[0], seg[1]) for seg in group] + [(seg[2], seg[3]) for seg in group]
            if abs(angle_i) < 45 or abs(angle_i - 180) < 45:
                # Mostly horizontal -- sort by x
                all_pts.sort(key=lambda p: p[0])
            else:
                # Mostly vertical -- sort by y
                all_pts.sort(key=lambda p: p[1])
            merged.append((all_pts[0][0], all_pts[0][1], all_pts[-1][0], all_pts[-1][1]))

        return merged
