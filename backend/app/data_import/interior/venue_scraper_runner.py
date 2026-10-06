"""Batch runner: queries POIs, creates scrape targets, runs crawl+classify pipeline.

FLOW
    run() → POIs with websites in the venue categories → new ScrapeTarget rows
        → _process_target() per target: crawl → download → classify → upload
        → InteriorSource row (+ auto-georef from the building footprint).

TRAP (fixed 2026-10-06, Big O audit): every floor plan found on a target
re-queried the SAME building twice (city_id, then geom). The building row is
now fetched once per target, on the first floor plan, via _building_info().
"""

from __future__ import annotations

import uuid
from datetime import datetime, timezone
from urllib.parse import urlparse

import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.adapters.storage import get_storage_adapter
from app.config import settings
from app.models.building import Building
from app.models.interior_source import InteriorSource
from app.models.poi import POI
from app.models.scrape_target import ScrapeTarget
from app.services.floor_plan_classifier import FloorPlanClassifier
from app.services.georeferencing_service import GeoreferencingService
from app.services.venue_scraper_service import VenueScraperService

VENUE_CATEGORIES = [
    "banquet_hall",
    "church",
    "hotel",
    "community_center",
    "theater",
    "concert_hall",
    "gymnasium",
    "convention_center",
    "museum",
]


class VenueScraperRunner:
    """Orchestrates venue website scraping for floor plan discovery."""

    # O(1) time, O(1) space
    def __init__(self, session: Session) -> None:
        self._session = session
        self._scraper = VenueScraperService()
        self._classifier = FloorPlanClassifier()
        self._classifier.load_model()
        self._storage = get_storage_adapter()
        self._logger = structlog.get_logger()

    # O(T + P) time, O(T + P) space — T = targets processed (network-bound, each crawl ≤ 10 pages); P = venue POIs for the city
    def run(
        self,
        city_id: str,
        max_targets: int | None = None,
        dry_run: bool = False,
        category_filter: str | None = None,
    ) -> dict:
        """Main entry point: query POIs -> create targets -> crawl -> classify -> store.

        Returns:
            Stats dict with targets_found, targets_processed, plans_found, plans_stored.
        """
        stats = {
            "targets_found": 0,
            "targets_processed": 0,
            "plans_found": 0,
            "plans_stored": 0,
        }

        # 1. Query POIs by venue categories
        categories = [category_filter] if category_filter else VENUE_CATEGORIES
        stmt = (
            select(POI)
            .where(
                POI.city_id == uuid.UUID(city_id),
                POI.category.in_(categories),
                POI.website.isnot(None),
            )
        )
        pois = list(self._session.execute(stmt).scalars().all())
        self._logger.info("venue_scraper.pois_found", count=len(pois), city_id=city_id)

        # 2. Create ScrapeTarget records (skip existing URLs)
        existing_urls_stmt = select(ScrapeTarget.url)
        existing_urls = set(self._session.execute(existing_urls_stmt).scalars().all())

        targets: list[ScrapeTarget] = []
        # O(P) time, O(P) space — P = venue POIs (existing_urls is a set: constant-time membership)
        for poi in pois:
            if poi.website in existing_urls:
                continue
            target = ScrapeTarget(
                building_id=poi.building_id,
                poi_id=poi.id,
                url=poi.website,
                status="pending",
            )
            self._session.add(target)
            targets.append(target)
            existing_urls.add(poi.website)

        self._session.commit()
        stats["targets_found"] = len(targets)

        if dry_run:
            self._logger.info("venue_scraper.dry_run", targets=len(targets))
            return stats

        # 3. Process each pending target
        targets_to_process = targets[:max_targets] if max_targets else targets

        # O(T) time, O(1) space — T = targets processed (one crawl + one commit each)
        for idx, target in enumerate(targets_to_process):
            try:
                self._process_target(target, stats)
                target.status = "done"
            except Exception as exc:
                self._logger.error(
                    "venue_scraper.target_failed",
                    url=target.url,
                    error=str(exc),
                )
                target.status = "failed"
                target.metadata_ = {"error": str(exc)}

            target.last_attempt = datetime.now(timezone.utc)
            stats["targets_processed"] += 1

            # Log progress every 10 targets
            if (idx + 1) % 10 == 0:
                self._logger.info(
                    "venue_scraper.progress",
                    processed=idx + 1,
                    total=len(targets_to_process),
                    plans_stored=stats["plans_stored"],
                )

            self._session.commit()

        self._logger.info("venue_scraper.complete", **stats)
        return stats

    # O(C) time, O(C) space — C = image candidates on the target's site (network-bound)
    def _process_target(self, target: ScrapeTarget, stats: dict) -> None:
        """Crawl a single target URL and classify/store discovered floor plans."""
        candidates = self._scraper.crawl(target.url)
        floor_plan_urls: list[str] = []
        # (city_id, geom) of the target's building — fetched once, on the first floor plan
        building: tuple[uuid.UUID | None, object | None] | None = None

        # O(C) time, O(C) space — C = image candidates (one download + classify each)
        for candidate in candidates:
            image_data, content_type = self._scraper.download_image(candidate["url"])
            if image_data is None:
                continue

            is_floor_plan, confidence = self._classifier.predict(image_data)
            if not is_floor_plan:
                continue

            stats["plans_found"] += 1

            # Store in MinIO
            parsed = urlparse(candidate["url"])
            filename = parsed.path.split("/")[-1] or f"plan_{uuid.uuid4().hex[:8]}.jpg"
            storage_key = f"interior/venue/{target.building_id}/{filename}"

            raster_url = self._storage.upload_file(
                bucket=settings.s3_bucket_name,
                key=storage_key,
                file_data=image_data,
                content_type=content_type or "image/jpeg",
            )

            # Create InteriorSource. The building row is loop-invariant — fetch it once.
            if building is None:
                building = self._building_info(target.building_id)
            city_id, building_geom = building
            source = InteriorSource(
                building_id=target.building_id,
                city_id=city_id,
                source_type="venue_scrape",
                source_url=candidate["url"],
                fetch_date=datetime.now(timezone.utc),
                raster_url=raster_url,
                raw_data={
                    "page_url": candidate.get("page_url"),
                    "alt_text": candidate.get("alt_text"),
                    "score": candidate.get("score"),
                    "classifier_confidence": confidence,
                },
                confidence=confidence,
                status="raw",
            )
            self._session.add(source)
            floor_plan_urls.append(raster_url)
            stats["plans_stored"] += 1

            # Auto-georef via building polygon
            self._try_auto_georef(source, image_data, target.building_id, building_geom)

        target.floor_plan_urls = floor_plan_urls if floor_plan_urls else None

    # O(1) time, O(g) space — g = footprint vertices (one primary-key lookup)
    def _building_info(
        self, building_id: uuid.UUID | None
    ) -> tuple[uuid.UUID | None, object | None]:
        """(city_id, geom) for a building in ONE query; (None, None) when unknown."""
        if building_id is None:
            return None, None
        row = self._session.execute(
            select(Building.city_id, Building.geom).where(Building.id == building_id)
        ).one_or_none()
        return (row[0], row[1]) if row else (None, None)

    # O(I + g) time, O(I + g) space — I = image pixels (decode); g = footprint vertices
    def _try_auto_georef(
        self,
        source: InteriorSource,
        image_data: bytes,
        building_id: uuid.UUID | None,
        geom: object | None,
    ) -> None:
        """Attempt automatic georeferencing using the building polygon (*geom*, already loaded)."""
        if building_id is None or geom is None:
            return
        try:
            from geoalchemy2.shape import to_shape

            import cv2
            import numpy as np

            nparr = np.frombuffer(image_data, np.uint8)
            img = cv2.imdecode(nparr, cv2.IMREAD_COLOR)
            if img is None:
                return

            h, w = img.shape[:2]
            polygon = to_shape(geom)
            affine = GeoreferencingService.auto_fit(polygon, w, h)
            source.raw_data = {**(source.raw_data or {}), "affine": affine}
        except Exception as exc:
            self._logger.warning(
                "venue_scraper.georef_failed",
                building_id=str(building_id),
                error=str(exc),
            )
