"""Enriches building metadata with county auditor/assessor records."""

import uuid

from sqlalchemy import update
from sqlalchemy.orm import Session

from app.models.building import Building


class CountyRecordsEnricher:
    """Enriches building metadata with county auditor/assessor records."""

    # O(1) time, O(1) space
    def __init__(self, session: Session):
        self._session = session

    # O(1) time, O(1) space — k = 5 mapped fields
    def enrich_building(self, building_id: uuid.UUID, records: dict) -> None:
        """Update building metadata from county record data.

        Accepted keys: floor_count, sq_ft, property_class, year_built, owner_name.
        """
        field_map = {
            "floor_count": "floors",
            "sq_ft": "sq_ft",
            "property_class": "property_class",
            "year_built": "year_built",
            "owner_name": "owner_name",
        }
        updates = {}
        # O(1) time, O(1) space — k = 5 mapped fields
        for record_key, model_field in field_map.items():
            if record_key in records and records[record_key]:
                updates[model_field] = records[record_key]

        if not updates:
            return

        stmt = update(Building).where(Building.id == building_id).values(**updates)
        self._session.execute(stmt)
        self._session.commit()

    # O(r + log n) time, O(r) space — r = size of the county API response parsed by the adapter; n = buildings (primary-key UPDATE)
    def enrich_from_api(self, building_id: uuid.UUID, pin: str, county_adapter) -> dict | None:
        """Fetch records from a county adapter and apply them.

        The county_adapter must have a `fetch_property(pin) -> dict` method.
        """
        try:
            records = county_adapter.fetch_property(pin)
            if records:
                self.enrich_building(building_id, records)
            return records
        except Exception:
            return None
