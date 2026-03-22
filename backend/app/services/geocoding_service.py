from abc import ABC, abstractmethod
from typing import Any


class GeocodingResult:
    """Structured result from a geocoding operation."""

    def __init__(
        self,
        latitude: float,
        longitude: float,
        formatted_address: str,
        confidence: float | None = None,
        raw: dict[str, Any] | None = None,
    ):
        self._latitude = latitude
        self._longitude = longitude
        self._formatted_address = formatted_address
        self._confidence = confidence
        self._raw = raw or {}

    @property
    def latitude(self) -> float:
        return self._latitude

    @property
    def longitude(self) -> float:
        return self._longitude

    @property
    def formatted_address(self) -> str:
        return self._formatted_address

    @property
    def confidence(self) -> float | None:
        return self._confidence

    @property
    def raw(self) -> dict[str, Any]:
        return dict(self._raw)

    def to_geojson_point(self) -> dict[str, Any]:
        """Return a GeoJSON Point representation."""
        return {
            "type": "Point",
            "coordinates": [self._longitude, self._latitude],
        }


class GeocodingServiceInterface(ABC):
    """Abstract interface for geocoding services.

    Implementations should wrap a specific geocoding provider (e.g., Pelias,
    Nominatim, Google Geocoding API) behind this interface so that providers
    can be swapped with minimal effort.
    """

    @abstractmethod
    async def geocode(self, address: str) -> GeocodingResult | None:
        """Forward-geocode an address string to coordinates.

        Args:
            address: The address string to geocode.

        Returns:
            A GeocodingResult if the address was found, or None if no match.
        """
        ...

    @abstractmethod
    async def reverse_geocode(self, latitude: float, longitude: float) -> GeocodingResult | None:
        """Reverse-geocode coordinates to an address.

        Args:
            latitude: Latitude in WGS84.
            longitude: Longitude in WGS84.

        Returns:
            A GeocodingResult if an address was found, or None if no match.
        """
        ...


class GeocodingService(GeocodingServiceInterface):
    """Placeholder geocoding service.

    Raises NotImplementedError until a concrete adapter is wired in.
    The adapter (e.g., Pelias, Nominatim) should be implemented in
    app/adapters/ and injected here.
    """

    async def geocode(self, address: str) -> GeocodingResult | None:
        raise NotImplementedError(
            "GeocodingService.geocode() requires a concrete adapter. "
            "Implement a provider in app/adapters/ and inject it."
        )

    async def reverse_geocode(self, latitude: float, longitude: float) -> GeocodingResult | None:
        raise NotImplementedError(
            "GeocodingService.reverse_geocode() requires a concrete adapter. "
            "Implement a provider in app/adapters/ and inject it."
        )
