"""Wall line detection for floor plan images using Hough Transform."""

from __future__ import annotations

import cv2
import numpy as np
import shapely  # vectorised geometry constructors (points, box)
from shapely import STRtree  # R-tree: O(log n + k) "what overlaps this box" queries


class LineDetector:
    """Detects wall lines in floor plan images using Hough Transform.

    Applies adaptive thresholding, morphological cleanup, Canny edge
    detection, and probabilistic Hough line extraction.  Nearby collinear
    segments are merged to reduce fragmentation.
    """

    # O(1) time, O(1) space
    def __init__(self, min_line_length: int = 30, max_line_gap: int = 10) -> None:
        self._min_line_length = min_line_length
        self._max_line_gap = max_line_gap

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    # O(P + L log L + K) time, O(P + L) space — P = image pixels; L = Hough segments; K = merge candidate pairs
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

        # O(L) time, O(L) space — L = Hough segments
        lines: list[tuple[int, int, int, int]] = [
            (int(seg[0][0]), int(seg[0][1]), int(seg[0][2]), int(seg[0][3]))
            for seg in lines_raw
        ]

        return self._merge_collinear(lines)

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    # O(L log L + K) time, O(L + K) space — L = segments; K = candidate pairs the two tree queries return
    def _merge_collinear(
        self,
        lines: list[tuple[int, int, int, int]],
        angle_thresh: float = 5.0,
        dist_thresh: float = 10.0,
    ) -> list[tuple[int, int, int, int]]:
        """Merge lines that are approximately collinear and close together.

        Groups segments whose angles differ by less than *angle_thresh*
        degrees and whose midpoints are closer than *dist_thresh* plus the two
        half-lengths — i.e. near-parallel segments whose ends come within about
        *dist_thresh* px of each other.  Each group is collapsed to a single
        bounding segment.

        Greedy, in input order: segment i (if not yet used) absorbs every
        unused j that passes the test against i — direct neighbours only, not
        a transitive closure.

        BEHAVIOUR CHANGE (2026-10-06): the threshold used to be
        ``dist_thresh + max(len_i, len_j)/2``, so two collinear 50 px walls
        with a 5 px gap (midpoints 52.5 px apart vs. a 35 px limit) never
        merged — tests/test_extractors.py::test_merge_collinear_merges_parallel_nearby
        had been failing on it. It now uses ``(len_i + len_j)/2``.

        TRAP (fixed 2026-10-06, Big O audit): this used to compare every
        segment with every other one — O(L²) — and HoughLinesP output is not
        capped, so a dense Sanborn sheet could spend minutes here. Because
        ``dist_thresh + h_i + h_j ≤ max(reach_i, reach_j)`` with
        ``reach = dist_thresh + len`` (h = len/2), every partner j satisfies
        ``dist < reach_i`` OR ``dist < reach_j``, so two R-trees find all of
        them without a full scan:
          * mid_tree   — j whose midpoint lies within reach_i of i's midpoint;
          * reach_tree — j whose own reach box contains i's midpoint.
        The exact test is then applied to those candidates, so the output is
        identical to a brute-force scan (tests/test_bigo_refactors.py checks this
        on random input).
        """
        if not lines:
            return []

        seg = np.asarray(lines, dtype=float)  # L × 4: x1, y1, x2, y2
        mids = (seg[:, :2] + seg[:, 2:]) / 2
        lengths = np.hypot(seg[:, 2] - seg[:, 0], seg[:, 3] - seg[:, 1])
        angles = np.degrees(np.arctan2(seg[:, 3] - seg[:, 1], seg[:, 2] - seg[:, 0])) % 180
        reach = dist_thresh + lengths  # ≥ dist_thresh + h_i + h_j whenever len_i is the longer one

        mid_tree = STRtree(shapely.points(mids))
        reach_tree = STRtree(
            shapely.box(
                mids[:, 0] - reach, mids[:, 1] - reach, mids[:, 0] + reach, mids[:, 1] + reach
            )
        )

        merged: list[tuple[int, int, int, int]] = []
        used = np.zeros(len(lines), dtype=bool)

        # O(L log L + K) time, O(K) space — L = segments; K = candidate pairs from the tree queries
        for i, (x1, y1, x2, y2) in enumerate(lines):
            if used[i]:
                continue
            used[i] = True
            group: list[tuple[int, int, int, int]] = [(x1, y1, x2, y2)]

            mx, my, r = mids[i, 0], mids[i, 1], reach[i]
            near = np.union1d(
                mid_tree.query(shapely.box(mx - r, my - r, mx + r, my + r)),
                reach_tree.query(shapely.points(mx, my)),
            )  # sorted ascending → groups keep the old input order

            # O(k) time, O(1) space — k = candidates for segment i (summed over i this is K)
            # bigo-lint: disable=BIGO006 — amortised: the k values sum to K across the outer loop
            for j in near:
                if used[j]:
                    continue
                angle_diff = abs(angles[i] - angles[j])
                if angle_diff > angle_thresh and abs(angle_diff - 180) > angle_thresh:
                    continue
                dist = np.hypot(mids[i, 0] - mids[j, 0], mids[i, 1] - mids[j, 1])
                if dist < dist_thresh + (lengths[i] + lengths[j]) / 2:
                    group.append(lines[j])
                    used[j] = True

            merged.append(self._collapse(group, angles[i]))

        return merged

    # O(g log g) time, O(g) space — g = segments in the group
    @staticmethod
    def _collapse(
        group: list[tuple[int, int, int, int]], angle: float
    ) -> tuple[int, int, int, int]:
        """Collapse a group to one segment spanning its extreme endpoints."""
        # O(g) time, O(g) space — g = segments in the group
        all_pts = [(s[0], s[1]) for s in group] + [(s[2], s[3]) for s in group]
        if abs(angle) < 45 or abs(angle - 180) < 45:
            all_pts.sort(key=lambda p: p[0])  # mostly horizontal — sort by x
        else:
            all_pts.sort(key=lambda p: p[1])  # mostly vertical — sort by y
        return (all_pts[0][0], all_pts[0][1], all_pts[-1][0], all_pts[-1][1])
