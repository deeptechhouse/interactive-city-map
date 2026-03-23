import httpx

from app.data_import.interior.county_adapters.base import CountyAdapterBase


class CookCountyAdapter(CountyAdapterBase):
    """Cook County (Chicago, IL) property adapter using Socrata API."""

    API_URL = "https://datacatalog.cookcountyil.gov/resource/5pge-nu6u.json"

    def __init__(self, app_token: str | None = None) -> None:
        self._app_token = app_token

    def _headers(self) -> dict[str, str]:
        headers: dict[str, str] = {"Accept": "application/json"}
        if self._app_token:
            headers["X-App-Token"] = self._app_token
        return headers

    def _normalize(self, record: dict) -> dict:
        return {
            "pin": record.get("pin", ""),
            "address": record.get("property_address", ""),
            "floor_count": record.get("num_stories"),
            "sq_ft": record.get("bldg_sf"),
            "property_class": record.get("class", ""),
            "year_built": record.get("age"),
            "owner_name": record.get("taxpayer", ""),
        }

    def fetch_property(self, pin: str) -> dict | None:
        """Query Socrata by PIN, return normalized property dict or None."""
        params = {"pin": pin}
        resp = httpx.get(
            self.API_URL, params=params, headers=self._headers(), timeout=15.0
        )
        resp.raise_for_status()
        rows = resp.json()
        if not rows:
            return None
        return self._normalize(rows[0])

    def search_by_address(self, address: str) -> list[dict]:
        """Query by address field, return list of normalized dicts."""
        params = {"$where": f"property_address like '%{address.upper()}%'", "$limit": "20"}
        resp = httpx.get(
            self.API_URL, params=params, headers=self._headers(), timeout=15.0
        )
        resp.raise_for_status()
        return [self._normalize(r) for r in resp.json()]
