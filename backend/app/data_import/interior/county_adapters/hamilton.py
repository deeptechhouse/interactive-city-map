import httpx

from app.data_import.interior.county_adapters.base import CountyAdapterBase


class HamiltonCountyAdapter(CountyAdapterBase):
    """Hamilton County (Cincinnati, OH) property adapter using REST API."""

    API_URL = "https://wedge1.hcauditor.org/api/property/"

    # O(1) time, O(1) space
    def _normalize(self, record: dict) -> dict:
        return {
            "pin": record.get("parcel_id", ""),
            "address": record.get("address", ""),
            "floor_count": record.get("stories"),
            "sq_ft": record.get("total_sqft"),
            "property_class": record.get("property_class", ""),
            "year_built": record.get("year_built"),
            "owner_name": record.get("owner", ""),
        }

    # O(1) time, O(1) space
    def fetch_property(self, pin: str) -> dict | None:
        """Fetch property by parcel ID from Hamilton County auditor API."""
        resp = httpx.get(
            f"{self.API_URL}{pin}",
            headers={"Accept": "application/json"},
            timeout=15.0,
        )
        if resp.status_code == 404:
            return None
        resp.raise_for_status()
        data = resp.json()
        if not data:
            return None
        return self._normalize(data)

    # NOTE: the request asks limit=20 but the server honouring it is assumed, not enforced; k is whatever it returns.
    # O(a + k) time, O(k) space — a = chars in the address; k = results returned
    def search_by_address(self, address: str) -> list[dict]:
        """Search properties by address via Hamilton County API."""
        resp = httpx.get(
            self.API_URL,
            params={"address": address, "limit": "20"},
            headers={"Accept": "application/json"},
            timeout=15.0,
        )
        resp.raise_for_status()
        results = resp.json()
        if isinstance(results, list):
            # O(k) time, O(k) space — k = results returned
            return [self._normalize(r) for r in results]
        return []
