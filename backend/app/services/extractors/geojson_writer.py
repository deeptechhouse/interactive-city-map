"""Converts extracted floor plan elements to GeoJSON FeatureCollections.

Optionally applies a 6-parameter affine transform to convert pixel
coordinates into real-world (lon/lat or projected) coordinates.
"""

from __future__ import annotations

from shapely.geometry import LineString, Polygon as ShapelyPolygon, mapping


class GeoJSONWriter:
    """Serialises room polygons and wall linestrings to GeoJSON."""

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    @staticmethod
    def rooms_to_geojson(
        rooms: list[dict],
        affine: list[float] | None = None,
    ) -> dict:
        """Convert extracted rooms to a GeoJSON FeatureCollection.

        Args:
            rooms: List of room dicts.  Each must contain a ``polygon``
                key holding a Shapely ``Polygon``.  Optional keys:
                ``name``, ``room_type`` / ``material``, ``level``,
                ``area_sqm``, ``area_px``.
            affine: Optional 6-float affine transform
                ``[a, b, c, d, e, f]`` where::

                    world_x = a * px + b * py + c
                    world_y = d * px + e * py + f

        Returns:
            GeoJSON FeatureCollection dict.
        """
        features: list[dict] = []
        for room in rooms:
            poly = room["polygon"]
            if affine:
                poly = _transform_polygon(poly, affine)

            feature = {
                "type": "Feature",
                "geometry": mapping(poly),
                "properties": {
                    "name": room.get("name"),
                    "room_type": room.get("room_type") or room.get("material", "unknown"),
                    "level": room.get("level", 0),
                    "area_sqm": room.get("area_sqm"),
                    "area_px": room.get("area_px"),
                },
            }
            features.append(feature)

        return {"type": "FeatureCollection", "features": features}

    @staticmethod
    def walls_to_geojson(
        lines: list[tuple[int, int, int, int]],
        affine: list[float] | None = None,
    ) -> dict:
        """Convert wall line segments to a GeoJSON FeatureCollection of LineStrings.

        Args:
            lines: List of ``(x1, y1, x2, y2)`` segments in pixel coords.
            affine: Optional 6-float affine transform (same as *rooms_to_geojson*).

        Returns:
            GeoJSON FeatureCollection dict.
        """
        features: list[dict] = []
        for x1, y1, x2, y2 in lines:
            if affine:
                p1 = _pixel_to_world(affine, x1, y1)
                p2 = _pixel_to_world(affine, x2, y2)
                line = LineString([p1, p2])
            else:
                line = LineString([(x1, y1), (x2, y2)])

            features.append({
                "type": "Feature",
                "geometry": mapping(line),
                "properties": {"wall_type": "interior"},
            })

        return {"type": "FeatureCollection", "features": features}


# ------------------------------------------------------------------
# Module-level helpers
# ------------------------------------------------------------------

def _pixel_to_world(
    affine: list[float],
    px: float,
    py: float,
) -> tuple[float, float]:
    """Apply a 6-parameter affine transform to convert pixel -> world coords.

    The affine list is ``[a, b, c, d, e, f]`` such that::

        world_x = a * px + b * py + c
        world_y = d * px + e * py + f
    """
    a, b, c, d, e, f = affine
    wx = a * px + b * py + c
    wy = d * px + e * py + f
    return (wx, wy)


def _transform_polygon(
    poly: ShapelyPolygon,
    affine: list[float],
) -> ShapelyPolygon:
    """Apply an affine transform to every vertex of a Shapely Polygon."""
    transformed_coords = [
        _pixel_to_world(affine, x, y) for x, y in poly.exterior.coords
    ]
    return ShapelyPolygon(transformed_coords)
