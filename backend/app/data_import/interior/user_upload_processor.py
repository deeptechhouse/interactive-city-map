"""Processes user-uploaded floor plan images: validate, thumbnail, store, auto-georef."""

import io
import uuid

from PIL import Image
from sqlalchemy import select
from sqlalchemy.ext.asyncio import AsyncSession

from app.adapters.storage import StorageAdapter
from app.config import settings
from app.models.building import Building
from app.models.interior_source import InteriorSource
from app.services.georeferencing_service import GeoreferencingService


class UserUploadProcessor:
    """Full pipeline for user-uploaded floor plan images."""

    ALLOWED_MIME_TYPES = {"image/png", "image/jpeg", "image/svg+xml", "application/pdf"}
    MAX_FILE_SIZE = 50 * 1024 * 1024  # 50 MB
    MIN_DIMENSION = 200
    MAX_DIMENSION = 10000
    QUALITY_CONFIDENCE = {"professional": 0.80, "sketch": 0.40, "photo": 0.20}

    def __init__(self, storage: StorageAdapter):
        self._storage = storage

    def validate_file(self, file_data: bytes, content_type: str) -> tuple[bool, str]:
        """Validate uploaded file. Returns (is_valid, error_message)."""
        if not file_data:
            return False, "Empty file"
        if len(file_data) > self.MAX_FILE_SIZE:
            return False, f"File too large (max {self.MAX_FILE_SIZE // (1024 * 1024)}MB)"
        if content_type not in self.ALLOWED_MIME_TYPES:
            return False, f"Unsupported file type: {content_type}"
        if content_type in {"image/png", "image/jpeg"}:
            try:
                img = Image.open(io.BytesIO(file_data))
                w, h = img.size
                if w < self.MIN_DIMENSION or h < self.MIN_DIMENSION:
                    return False, f"Image too small (min {self.MIN_DIMENSION}px)"
                if w > self.MAX_DIMENSION or h > self.MAX_DIMENSION:
                    return False, f"Image too large (max {self.MAX_DIMENSION}px)"
            except Exception:
                return False, "Corrupt or unreadable image"
        return True, ""

    def generate_thumbnail(self, file_data: bytes, max_width: int = 300) -> bytes | None:
        """Generate PNG thumbnail. Returns None for non-raster formats."""
        try:
            img = Image.open(io.BytesIO(file_data))
            ratio = max_width / img.width
            if ratio < 1:
                new_size = (max_width, int(img.height * ratio))
                img = img.resize(new_size, Image.LANCZOS)
            buf = io.BytesIO()
            img.save(buf, format="PNG")
            return buf.getvalue()
        except Exception:
            return None

    async def process_upload(
        self,
        building_id: uuid.UUID,
        level: int,
        file_data: bytes,
        content_type: str,
        session: AsyncSession,
        source_type: str = "upload",
        quality: str = "professional",
    ) -> dict:
        """Full async upload pipeline: validate, thumbnail, store, auto-georef, DB record.

        Returns dict with: source_id, raster_url, thumbnail_url, confidence, affine.
        """
        is_valid, error = self.validate_file(file_data, content_type)
        if not is_valid:
            raise ValueError(error)

        # Thumbnail
        thumbnail_data = self.generate_thumbnail(file_data)

        # Store main file
        ext = {"image/png": "png", "image/jpeg": "jpg", "image/svg+xml": "svg", "application/pdf": "pdf"}[
            content_type
        ]
        file_key = f"interior/upload/{building_id}/{level}.{ext}"
        raster_url = self._storage.upload_file(
            bucket=settings.s3_bucket_name, key=file_key, file_data=file_data, content_type=content_type
        )

        # Store thumbnail
        thumbnail_url = None
        if thumbnail_data:
            thumb_key = f"interior/upload/{building_id}/{level}_thumb.png"
            thumbnail_url = self._storage.upload_file(
                bucket=settings.s3_bucket_name, key=thumb_key, file_data=thumbnail_data, content_type="image/png"
            )

        confidence = self.QUALITY_CONFIDENCE.get(quality, 0.30)

        # Auto-georef attempt
        affine = None
        if content_type in {"image/png", "image/jpeg"}:
            try:
                from geoalchemy2.shape import to_shape

                stmt = select(Building).where(Building.id == building_id)
                result = await session.execute(stmt)
                building = result.scalar_one_or_none()
                if building and building.geom:
                    building_poly = to_shape(building.geom)
                    img = Image.open(io.BytesIO(file_data))
                    affine = GeoreferencingService.auto_fit(building_poly, img.width, img.height)
            except Exception:
                pass  # Auto-georef is best-effort

        # Create InteriorSource record
        source_id = None
        stmt = select(Building.city_id).where(Building.id == building_id)
        result = await session.execute(stmt)
        city_id = result.scalar_one_or_none()

        if city_id:
            source = InteriorSource(
                building_id=building_id,
                city_id=city_id,
                source_type=source_type,
                raster_url=raster_url,
                confidence=confidence,
                status="raw",
            )
            session.add(source)
            await session.commit()
            await session.refresh(source)
            source_id = source.id

        return {
            "source_id": str(source_id) if source_id else None,
            "raster_url": raster_url,
            "thumbnail_url": thumbnail_url,
            "confidence": confidence,
            "affine": affine,
        }
