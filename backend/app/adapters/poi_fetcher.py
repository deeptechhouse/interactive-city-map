"""POI fetcher adapters for importing points-of-interest from external sources."""

from abc import ABC, abstractmethod
from typing import Any, Optional

import httpx

from app.config import settings


class POIFetcherAdapter(ABC):
    """Abstract interface for fetching POIs from an external data source."""

    @abstractmethod
    async def fetch_pois(
        self, bbox: tuple[float, float, float, float], categories: Optional[list[str]] = None
    ) -> list[dict[str, Any]]:
        """Fetch POIs within the bounding box.

        Args:
            bbox: (min_lon, min_lat, max_lon, max_lat)
            categories: Optional list of category filters.

        Returns:
            List of dicts with at minimum: name, category, lat, lon.
        """


class OverpassPOIFetcher(POIFetcherAdapter):
    """Fetches POIs from OpenStreetMap via the Overpass API."""

    _OVERPASS_URL = "https://overpass-api.de/api/interpreter"

    # Map our category names to OSM tags
    _CATEGORY_TAG_MAP: dict[str, str] = {
        "restaurant": 'node["amenity"="restaurant"]',
        "cafe": 'node["amenity"="cafe"]',
        "bar": 'node["amenity"="bar"]',
        "shop": 'node["shop"]',
        "school": 'node["amenity"="school"]',
        "hospital": 'node["amenity"="hospital"]',
        "park": 'way["leisure"="park"]',
        "museum": 'node["tourism"="museum"]',
        "library": 'node["amenity"="library"]',
        "place_of_worship": 'node["amenity"="place_of_worship"]',
    }

    async def fetch_pois(
        self, bbox: tuple[float, float, float, float], categories: Optional[list[str]] = None
    ) -> list[dict[str, Any]]:
        min_lon, min_lat, max_lon, max_lat = bbox
        overpass_bbox = f"{min_lat},{min_lon},{max_lat},{max_lon}"

        if categories:
            tag_queries = []
            for cat in categories:
                tag = self._CATEGORY_TAG_MAP.get(cat)
                if tag:
                    tag_queries.append(f"{tag}({overpass_bbox});")
            if not tag_queries:
                return []
            union = "\n".join(tag_queries)
            query = f"[out:json][timeout:25];\n(\n{union}\n);\nout center;"
        else:
            query = (
                f"[out:json][timeout:25];\n"
                f'(\n  node["amenity"]({overpass_bbox});\n'
                f'  node["shop"]({overpass_bbox});\n'
                f'  node["tourism"]({overpass_bbox});\n'
                f");\nout center;"
            )

        async with httpx.AsyncClient(timeout=30.0) as client:
            resp = await client.post(self._OVERPASS_URL, data={"data": query})
            resp.raise_for_status()
            data = resp.json()

        results: list[dict[str, Any]] = []
        for element in data.get("elements", []):
            tags = element.get("tags", {})
            lat = element.get("lat") or element.get("center", {}).get("lat")
            lon = element.get("lon") or element.get("center", {}).get("lon")
            if not lat or not lon:
                continue
            results.append(
                {
                    "name": tags.get("name", "Unknown"),
                    "category": self._derive_category(tags),
                    "lat": lat,
                    "lon": lon,
                    "address": tags.get("addr:street", ""),
                    "phone": tags.get("phone", ""),
                    "website": tags.get("website", ""),
                    "source": "osm",
                    "source_id": str(element.get("id", "")),
                }
            )
        return results

    @staticmethod
    def _derive_category(tags: dict) -> str:
        if "amenity" in tags:
            return tags["amenity"]
        if "shop" in tags:
            return "shop"
        if "tourism" in tags:
            return tags["tourism"]
        return "other"


class FoursquarePOIFetcher(POIFetcherAdapter):
    """Fetches POIs from the Foursquare Places API (v3)."""

    _BASE_URL = "https://api.foursquare.com/v3/places/search"

    def __init__(self, api_key: str = settings.foursquare_api_key):
        self._api_key = api_key

    async def fetch_pois(
        self, bbox: tuple[float, float, float, float], categories: Optional[list[str]] = None
    ) -> list[dict[str, Any]]:
        if not self._api_key:
            return []

        min_lon, min_lat, max_lon, max_lat = bbox
        center_lat = (min_lat + max_lat) / 2
        center_lon = (min_lon + max_lon) / 2

        headers = {
            "Authorization": self._api_key,
            "Accept": "application/json",
        }
        params: dict[str, Any] = {
            "ll": f"{center_lat},{center_lon}",
            "radius": 5000,
            "limit": 50,
        }
        if categories:
            params["categories"] = ",".join(categories)

        async with httpx.AsyncClient(timeout=15.0) as client:
            resp = await client.get(self._BASE_URL, headers=headers, params=params)
            resp.raise_for_status()
            data = resp.json()

        results: list[dict[str, Any]] = []
        for place in data.get("results", []):
            geo = place.get("geocodes", {}).get("main", {})
            if not geo:
                continue
            cats = place.get("categories", [])
            category = cats[0]["name"] if cats else "other"
            location = place.get("location", {})
            results.append(
                {
                    "name": place.get("name", "Unknown"),
                    "category": category,
                    "lat": geo["latitude"],
                    "lon": geo["longitude"],
                    "address": location.get("formatted_address", ""),
                    "phone": place.get("tel", ""),
                    "website": place.get("website", ""),
                    "source": "foursquare",
                    "source_id": place.get("fsq_id", ""),
                }
            )
        return results
