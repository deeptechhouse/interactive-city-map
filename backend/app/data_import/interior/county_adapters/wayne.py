from app.data_import.interior.county_adapters.base import CountyAdapterBase


class WayneCountyAdapter(CountyAdapterBase):
    """Wayne County (Detroit, MI) adapter — web scraping based (no public API)."""

    BASE_URL = "https://www.waynecounty.com/departments/treasurer/property-search.aspx"

    def fetch_property(self, pin: str) -> dict | None:
        """Placeholder — would use httpx + BeautifulSoup to scrape."""
        return None  # Not implemented yet

    def search_by_address(self, address: str) -> list[dict]:
        """Placeholder — would use httpx + BeautifulSoup to scrape."""
        return []  # Not implemented yet
