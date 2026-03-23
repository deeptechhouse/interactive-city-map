from app.data_import.interior.county_adapters.base import CountyAdapterBase


class MontgomeryCountyAdapter(CountyAdapterBase):
    """Montgomery County (Dayton, OH) adapter — web scraping based."""

    BASE_URL = "https://www.mcrealestate.org/"

    def fetch_property(self, pin: str) -> dict | None:
        """Placeholder — would use httpx + BeautifulSoup to scrape."""
        return None  # Not implemented yet

    def search_by_address(self, address: str) -> list[dict]:
        """Placeholder — would use httpx + BeautifulSoup to scrape."""
        return []  # Not implemented yet
