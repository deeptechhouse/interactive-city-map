"""Geocoder adapters for address-to-coordinate resolution."""

from abc import ABC, abstractmethod
from typing import Optional

import httpx

from app.config import settings


class GeocoderAdapter(ABC):
    """Abstract interface for geocoding an address to (lat, lon)."""

    @abstractmethod
    async def geocode(self, address: str) -> tuple[float, float]:
        """Return (latitude, longitude) for the given address.

        Raises:
            GeocodingError: If the address cannot be resolved.
        """


class GeocodingError(Exception):
    """Raised when geocoding fails for any adapter."""


class PeliasGeocoderAdapter(GeocoderAdapter):
    """Geocoder backed by a Pelias instance."""

    def __init__(self, base_url: str = settings.pelias_url):
        self._base_url = base_url.rstrip("/")

    async def geocode(self, address: str) -> tuple[float, float]:
        url = f"{self._base_url}/v1/search"
        params = {"text": address, "size": 1}
        async with httpx.AsyncClient(timeout=10.0) as client:
            resp = await client.get(url, params=params)
            resp.raise_for_status()
            data = resp.json()
        features = data.get("features", [])
        if not features:
            raise GeocodingError(f"Pelias returned no results for: {address}")
        coords = features[0]["geometry"]["coordinates"]  # [lon, lat]
        return (coords[1], coords[0])


class CensusGeocoderAdapter(GeocoderAdapter):
    """Fallback geocoder using the US Census Bureau Geocoding API."""

    _BASE_URL = "https://geocoding.geo.census.gov/geocoder/locations/onelineaddress"

    async def geocode(self, address: str) -> tuple[float, float]:
        params = {
            "address": address,
            "benchmark": "Public_AR_Current",
            "format": "json",
        }
        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(self._BASE_URL, params=params)
            resp.raise_for_status()
            data = resp.json()
        matches = data.get("result", {}).get("addressMatches", [])
        if not matches:
            raise GeocodingError(f"Census geocoder returned no results for: {address}")
        coords = matches[0]["coordinates"]
        return (coords["y"], coords["x"])


class ChainedGeocoderAdapter(GeocoderAdapter):
    """Tries Pelias first, falls back to Census geocoder on failure."""

    def __init__(
        self,
        primary: Optional[GeocoderAdapter] = None,
        fallback: Optional[GeocoderAdapter] = None,
    ):
        self._primary = primary or PeliasGeocoderAdapter()
        self._fallback = fallback or CensusGeocoderAdapter()

    async def geocode(self, address: str) -> tuple[float, float]:
        try:
            return await self._primary.geocode(address)
        except (GeocodingError, httpx.HTTPError):
            return await self._fallback.geocode(address)
