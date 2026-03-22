"""Georeferencing service: transforms floor plan pixel coordinates to world coordinates."""

import numpy as np
from shapely import minimum_rotated_rectangle
from shapely.geometry import Polygon


def _solve_affine(src_points: np.ndarray, dst_points: np.ndarray) -> list[float]:
    """Solve for 6-parameter affine transform via least-squares.

    Given N source points (pixel) and N destination points (world),
    finds [a, b, c, d, e, f] such that:
        world_x = a * px_x + b * px_y + c
        world_y = d * px_x + e * px_y + f
    """
    n = len(src_points)
    # Build system: for each point, two equations
    A = np.zeros((2 * n, 6))
    b = np.zeros(2 * n)
    for i in range(n):
        sx, sy = src_points[i]
        dx, dy = dst_points[i]
        A[2 * i] = [sx, sy, 1, 0, 0, 0]
        A[2 * i + 1] = [0, 0, 0, sx, sy, 1]
        b[2 * i] = dx
        b[2 * i + 1] = dy

    result, _, _, _ = np.linalg.lstsq(A, b, rcond=None)
    return result.tolist()


def _order_corners(corners: list[tuple[float, float]]) -> list[tuple[float, float]]:
    """Order 4 polygon corners as TL, TR, BR, BL.

    In lon/lat space: higher y (lat) = north = top.
    TL = max y, min x; TR = max y, max x; BR = min y, max x; BL = min y, min x.
    """
    pts = sorted(corners, key=lambda p: (-p[1], p[0]))  # sort by y desc, then x asc
    top = sorted(pts[:2], key=lambda p: p[0])  # top-left, top-right
    bottom = sorted(pts[2:], key=lambda p: p[0])  # bottom-left, bottom-right
    tl, tr = top[0], top[1]
    bl, br = bottom[0], bottom[1]
    return [tl, tr, br, bl]


class GeoreferencingService:
    """Transforms floor plan pixel coordinates to world coordinates."""

    @staticmethod
    def auto_fit(building_polygon: Polygon, image_width: int, image_height: int) -> list[float]:
        """Auto-fit a floor plan image to a building polygon using the OMBR.

        Returns a 6-float affine transform [a, b, c, d, e, f] where:
            world_x = a * pixel_x + b * pixel_y + c
            world_y = d * pixel_x + e * pixel_y + f
        """
        ombr = minimum_rotated_rectangle(building_polygon)
        corners = list(ombr.exterior.coords)[:4]
        ordered = _order_corners(corners)

        src = np.array(
            [[0, 0], [image_width, 0], [image_width, image_height], [0, image_height]],
            dtype=float,
        )
        dst = np.array(ordered, dtype=float)
        return _solve_affine(src, dst)

    @staticmethod
    def from_control_points(
        pixel_points: list[tuple[float, float]],
        world_points: list[tuple[float, float]],
    ) -> list[float]:
        """Compute affine transform from 3+ user-provided ground control points.

        Args:
            pixel_points: (px_x, px_y) coordinates in the image.
            world_points: (lon, lat) coordinates in WGS84.

        Returns:
            6-float affine [a, b, c, d, e, f].

        Raises:
            ValueError: If fewer than 3 control points.
        """
        if len(pixel_points) < 3 or len(world_points) < 3:
            raise ValueError("At least 3 control points required")
        return _solve_affine(np.array(pixel_points, dtype=float), np.array(world_points, dtype=float))

    @staticmethod
    def pixel_to_world(affine: list[float], px_x: float, px_y: float) -> tuple[float, float]:
        """Convert pixel coordinates to world coordinates."""
        a, b, c, d, e, f = affine
        return (a * px_x + b * px_y + c, d * px_x + e * px_y + f)

    @staticmethod
    def world_to_pixel(affine: list[float], world_x: float, world_y: float) -> tuple[float, float]:
        """Convert world coordinates to pixel coordinates (inverse affine)."""
        a, b, c, d, e, f = affine
        det = a * e - b * d
        if abs(det) < 1e-12:
            raise ValueError("Singular affine transform, cannot invert")
        px_x = (e * (world_x - c) - b * (world_y - f)) / det
        px_y = (-d * (world_x - c) + a * (world_y - f)) / det
        return (px_x, px_y)

    @staticmethod
    def affine_to_raster_bounds(affine: list[float], width: int, height: int) -> Polygon:
        """Convert affine + image dimensions to a world-coordinate polygon."""
        p2w = GeoreferencingService.pixel_to_world
        tl = p2w(affine, 0, 0)
        tr = p2w(affine, width, 0)
        br = p2w(affine, width, height)
        bl = p2w(affine, 0, height)
        return Polygon([tl, tr, br, bl, tl])
