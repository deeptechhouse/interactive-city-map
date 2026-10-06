"""Imports building permits from the Chicago Socrata Open Data API.

PURPOSE
    Pull recent Chicago building permits and attach a short summary of each one
    to the matching Chicago building's ``metadata_["permits"]`` list. This file
    does NOT create buildings or touch any other city — the Socrata feed is
    Chicago-only, so the building index is scoped to the ``chicago`` city row.

FLOW
    import_city() → fetch_permits() per page → link_permits_to_buildings()
        → _building_index() (one query, built ONCE per run) → dict lookups.
    Each page commits; SQLAlchemy then expires the loaded buildings, so a building
    matched again on a later page is re-read by primary key (one small query per
    matched building per page — bounded by matches, not by the table).

TRAP (fixed 2026-10-06, Big O audit): the old loop re-ran
    ``SELECT * FROM buildings WHERE address IS NOT NULL`` for EVERY permit and
    then scanned the whole result — O(P·B) time plus P full-table queries — and
    it had no city filter, so a Chicago permit could land on a Detroit/Dayton
    building with the same street address. Now: one city-scoped query, a dict
    keyed by normalised address, O(1) per permit.
"""

from __future__ import annotations

import re

import httpx
import structlog
from sqlalchemy import select
from sqlalchemy.orm import Session

from app.models.building import Building
from app.models.city import City

# The Socrata dataset below is Chicago's — permits must only ever match Chicago buildings.
CITY_SLUG = "chicago"


class PermitImporter:
    """Fetches building permits and links them to existing buildings by address."""

    SOCRATA_URL = "https://data.cityofchicago.org/resource/ydr8-5enu.json"

    # O(1) time, O(1) space
    def __init__(self, session: Session) -> None:
        self._session = session
        self._logger = structlog.get_logger()

    # O(n) time, O(n) space — n = permits returned (one HTTP call)
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

    # O(B) time, O(B) space — B = Chicago buildings with an address
    def _building_index(self) -> dict[str, Building]:
        """Map normalised address → first Chicago building with that address.

        First match wins, mirroring the old scan's ``break`` on first hit.
        """
        stmt = (
            select(Building)
            .join(City, City.id == Building.city_id)
            .where(City.slug == CITY_SLUG, Building.address.isnot(None))
        )
        index: dict[str, Building] = {}
        # O(B) time, O(B) space — B = Chicago buildings with an address
        for building in self._session.execute(stmt).scalars():
            key = self._normalize_address(building.address or "")
            if key:
                index.setdefault(key, building)
        return index

    # O(P + B) time, O(B) space — P = permits in this page; B = Chicago buildings with an address
    def link_permits_to_buildings(
        self, permits: list[dict], by_address: dict[str, Building] | None = None
    ) -> dict:
        """Match permits to buildings by address and store as metadata.

        ``by_address`` lets import_city() build the building index ONCE for all pages;
        a standalone call builds it here.

        Returns:
            Stats dict with permits_processed and buildings_matched.
        """
        stats = {"permits_processed": 0, "buildings_matched": 0}
        if by_address is None:
            by_address = self._building_index()

        # O(P) time, O(1) space — P = permits (each lookup is a dict hit)
        for permit in permits:
            stats["permits_processed"] += 1
            raw_address = permit.get("street_number", "") + " " + permit.get("street_direction", "") + " " + permit.get("street_name", "")
            normalized = self._normalize_address(raw_address)
            if not normalized:
                continue

            building = by_address.get(normalized)
            if building is None:
                continue
            # Copy before mutating: SQLAlchemy JSON columns only notice a change when a
            # NEW object is assigned, so mutating the loaded dict in place can be lost.
            meta = dict(building.metadata_ or {})
            permits_list = list(meta.get("permits", []))
            permits_list.append({
                "permit_number": permit.get("permit_", ""),
                "permit_type": permit.get("permit_type", ""),
                "issue_date": permit.get("issue_date", ""),
                "work_description": permit.get("work_description", ""),
                "contractor": permit.get("contractor_1_name", ""),
                "estimated_cost": permit.get("estimated_cost", ""),
            })
            meta["permits"] = permits_list
            building.metadata_ = meta
            stats["buildings_matched"] += 1

        self._session.commit()
        self._logger.info("permits.link_complete", **stats)
        return stats

    # O(M + B) time, O(B) space — M = max_permits; B = Chicago buildings with an address (index built once)
    def import_city(self, max_permits: int = 5000) -> dict:
        """Full import pipeline: fetch permits in pages and link to buildings.

        Returns:
            Aggregated stats dict.
        """
        total_stats = {"permits_processed": 0, "buildings_matched": 0}
        offset = 0
        page_size = 1000
        by_address = self._building_index()  # built once, shared by every page

        # O(M) time, O(1) space — M = max_permits, fetched in pages of 1000 and matched against the shared index
        while offset < max_permits:
            limit = min(page_size, max_permits - offset)
            permits = self.fetch_permits(limit=limit, offset=offset)

            if not permits:
                break

            page_stats = self.link_permits_to_buildings(permits, by_address)
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

    # O(a) time, O(a) space — a = address length (k = 11 fixed replacements)
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
        # O(a) time, O(a) space — a = address length; k = 11 fixed replacements
        for full, abbr in replacements.items():
            normalized = normalized.replace(full, abbr)
        return normalized
