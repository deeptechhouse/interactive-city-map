from abc import ABC, abstractmethod


class CountyAdapterBase(ABC):
    """Abstract base for county property record adapters."""

    @abstractmethod
    def fetch_property(self, pin: str) -> dict | None:
        """Fetch property details by parcel ID.

        Returns dict with floor_count, sq_ft, property_class, year_built,
        owner_name or None.
        """

    @abstractmethod
    def search_by_address(self, address: str) -> list[dict]:
        """Search properties by address. Returns list of property dicts."""
