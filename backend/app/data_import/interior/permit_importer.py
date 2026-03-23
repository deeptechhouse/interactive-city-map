"""Imports building permits from Chicago Socrata Open Data API."""

from __future__ import annotations

import re

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.building import Building


class PermitImporter:
    """Fetches building permits and links them to existing buildings by address."""

    SOCRATA_URL = "https://data.cityofchicago.org/resource/ydr8-5enu.json"

    def __init__(self, session: Session) -> None:
        self._session = session
        self._logger = structlog.get_logger()

    def fetch_permits(self, limit: int = 1000, offset: int = 0) -> list[dict]:
        """Fetch permits from the Socrata API.

        Returns:
            List of permit dicts from the API response.
        """
        params = {
            "$limit": limit,
            "$offset": offset,
            "$order": "issue_date DESC",
        }
        response = httpx.get(self.SOCRATA_URL, params=params, timeout=30)
        response.raise_for_status()
        return response.json()

    def link_permits_to_buildings(self, permits: list[dict]) -> dict:
        """Match permits to buildings by address and store as metadata.

        Returns:
            Stats dict with permits_processed and buildings_matched.
        """
        stats = {"permits_processed": 0, "buildings_matched": 0}

        for permit in permits:
            stats["permits_processed"] += 1
            raw_address = permit.get("street_number", "") + " " + permit.get("street_direction", "") + " " + permit.get("street_name", "")
            normalized = self._normalize_address(raw_address)

            if not normalized:
                continue

            stmt = select(Building).where(Building.address.isnot(None))
            buildings = list(self._session.execute(stmt).scalars().all())

            for building in buildings:
                if building.address and self._normalize_address(building.address) == normalized:
                    # Append permit info to building metadata
                    meta = building.metadata_ or {}
                    permits_list = meta.get("permits", [])
                    permit_entry = {
                        "permit_number": permit.get("permit_", ""),
                        "permit_type": permit.get("permit_type", ""),
                        "issue_date": permit.get("issue_date", ""),
                        "work_description": permit.get("work_description", ""),
                        "contractor": permit.get("contractor_1_name", ""),
                        "estimated_cost": permit.get("estimated_cost", ""),
                    }
                    permits_list.append(permit_entry)
                    meta["permits"] = permits_list
                    building.metadata_ = meta
                    stats["buildings_matched"] += 1
                    break

        self._session.commit()
        self._logger.info("permits.link_complete", **stats)
        return stats

    def import_city(self, max_permits: int = 5000) -> dict:
        """Full import pipeline: fetch permits in pages and link to buildings.

        Returns:
            Aggregated stats dict.
        """
        total_stats = {"permits_processed": 0, "buildings_matched": 0}
        offset = 0
        page_size = 1000

        while offset < max_permits:
            limit = min(page_size, max_permits - offset)
            permits = self.fetch_permits(limit=limit, offset=offset)

            if not permits:
                break

            page_stats = self.link_permits_to_buildings(permits)
            total_stats["permits_processed"] += page_stats["permits_processed"]
            total_stats["buildings_matched"] += page_stats["buildings_matched"]

            self._logger.info(
                "permits.page_complete",
                offset=offset,
                page_permits=len(permits),
                total_matched=total_stats["buildings_matched"],
            )

            offset += len(permits)
            if len(permits) < limit:
                break

        self._logger.info("permits.import_complete", **total_stats)
        return total_stats

    @staticmethod
    def _normalize_address(address: str) -> str:
        """Normalize an address for comparison: uppercase, strip whitespace, collapse spaces."""
        normalized = address.upper().strip()
        normalized = re.sub(r"\s+", " ", normalized)
        # Common abbreviation normalization
        replacements = {
            " STREET": " ST",
            " AVENUE": " AVE",
            " BOULEVARD": " BLVD",
            " DRIVE": " DR",
            " ROAD": " RD",
            " PLACE": " PL",
            " COURT": " CT",
            " NORTH": " N",
            " SOUTH": " S",
            " EAST": " E",
            " WEST": " W",
        }
        for full, abbr in replacements.items():
            normalized = normalized.replace(full, abbr)
        return normalized
