"""Crops georeferenced Sanborn map sheets to individual building footprints."""

import io
import uuid

from PIL import Image
from shapely.geometry import Polygon, box

from app.adapters.storage import StorageAdapter
from app.config import settings


class SanbornCropper:
    """Crops georeferenced Sanborn map sheets to individual building footprints."""

    BUFFER_METERS = 5

    def __init__(self, storage: StorageAdapter):
        self._storage = storage

    def crop_building(
        self,
        building_id: uuid.UUID,
        building_polygon: Polygon,
        sheet_image_path: str,
        sheet_bounds: tuple[float, float, float, float],
        year: int,
    ) -> dict | None:
        """Crop a Sanborn sheet to the area around a building footprint.

        Args:
            building_id: UUID of the building.
            building_polygon: Shapely Polygon of the building footprint.
            sheet_image_path: Local filesystem path to the Sanborn sheet image.
            sheet_bounds: Geographic bounds (west, south, east, north).
            year: Year of the Sanborn map.

        Returns:
            dict with raster_url, thumbnail_url, bounds — or None if no intersection.
        """
        sheet_box = box(*sheet_bounds)
        if not building_polygon.intersects(sheet_box):
            return None

        buffer_deg = self.BUFFER_METERS / 111_000  # rough meters to degrees
        bldg_bounds = building_polygon.buffer(buffer_deg).bounds

        crop_west = max(bldg_bounds[0], sheet_bounds[0])
        crop_south = max(bldg_bounds[1], sheet_bounds[1])
        crop_east = min(bldg_bounds[2], sheet_bounds[2])
        crop_north = min(bldg_bounds[3], sheet_bounds[3])

        if crop_west >= crop_east or crop_south >= crop_north:
            return None

        img = Image.open(sheet_image_path)
        img_w, img_h = img.size
        sw, ss, se, sn = sheet_bounds
        sheet_w = se - sw
        sheet_h = sn - ss

        px_left = max(0, int((crop_west - sw) / sheet_w * img_w))
        px_right = min(img_w, int((crop_east - sw) / sheet_w * img_w))
        px_top = max(0, int((sn - crop_north) / sheet_h * img_h))
        px_bottom = min(img_h, int((sn - crop_south) / sheet_h * img_h))

        if px_right - px_left < 10 or px_bottom - px_top < 10:
            return None

        cropped = img.crop((px_left, px_top, px_right, px_bottom))

        # Upload cropped image
        buf = io.BytesIO()
        cropped.save(buf, format="PNG")
        key = f"interior/sanborn/{building_id}/{year}.png"
        raster_url = self._storage.upload_file(
            bucket=settings.s3_bucket_name, key=key, file_data=buf.getvalue(), content_type="image/png"
        )

        # Thumbnail
        thumb = cropped.copy()
        ratio = 300 / thumb.width if thumb.width > 300 else 1
        if ratio < 1:
            thumb = thumb.resize((300, int(thumb.height * ratio)), Image.LANCZOS)
        thumb_buf = io.BytesIO()
        thumb.save(thumb_buf, format="PNG")
        thumb_key = f"interior/sanborn/{building_id}/{year}_thumb.png"
        thumbnail_url = self._storage.upload_file(
            bucket=settings.s3_bucket_name, key=thumb_key, file_data=thumb_buf.getvalue(), content_type="image/png"
        )

        return {
            "raster_url": raster_url,
            "thumbnail_url": thumbnail_url,
            "bounds": (crop_west, crop_south, crop_east, crop_north),
        }
