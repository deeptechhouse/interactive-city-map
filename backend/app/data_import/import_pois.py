"""Import points of interest from OSM via Overpass API."""

import json
import uuid
from pathlib import Path

from shapely.geometry import Point, mapping

from app.data_import.base_importer import BaseImporter, insert_rows

OVERPASS_URL = "https://overpass-api.de/api/interpreter"

# Map OSM tags to POI categories
_TAG_CATEGORY_MAP: dict[tuple[str, str], str] = {
    ("amenity", "theatre"): "theater",
    ("amenity", "cinema"): "movie_theater",
    ("amenity", "nightclub"): "music_venue",
    ("amenity", "studio"): "recording_studio",
    ("amenity", "community_centre"): "community_center",
    ("amenity", "place_of_worship"): "church",
    ("amenity", "biergarten"): "beer_garden",
    ("tourism", "museum"): "museum",
    ("tourism", "gallery"): "gallery",
    ("tourism", "hotel"): "hotel_event",
    ("tourism", "motel"): "motel",
    ("leisure", "dance"): "dance_studio",
    ("leisure", "fitness_centre"): "gymnasium",
    ("leisure", "park"): "park",
    ("building", "warehouse"): "warehouse",
    ("shop", "music"): "music_studio",
}


# O(k) time, O(k) space — k = tag/category pairs in _TAG_CATEGORY_MAP (fixed, ~20)
def _build_overpass_query(bbox: str) -> str:
    """Build Overpass QL for multiple POI categories within a bbox."""
    tag_filters = []
    # O(k) time, O(k) space — k = tag/category pairs (fixed)
    for (key, val) in _TAG_CATEGORY_MAP:
        tag_filters.append(f'  node["{key}"="{val}"]({bbox});')
    filter_block = "\n".join(tag_filters)
    return f"""
[out:json][timeout:120];
(
{filter_block}
);
out body;
"""


# O(k) time, O(1) space — k = tag/category pairs (fixed), first match wins
def _categorize_node(tags: dict) -> str | None:
    """Determine the POI category from OSM tags."""
    # O(k) time, O(1) space — k = tag/category pairs (fixed)
    for (key, val), category in _TAG_CATEGORY_MAP.items():
        if tags.get(key) == val:
            return category
    return None


class POIsImporter(BaseImporter):
    layer_name = "pois"

    # O(n) time, O(n) space — n = OSM elements returned by Overpass (or read from cache)
    def download(self) -> Path:
        # TRAP (fixed 2026-10-02): this read the default ".geojson" cache while download
        # saves ".json", so the cache never hit — every run re-downloaded, and Overpass
        # started answering 504 to the repeats.
        cached = self._load_json_cache(suffix=".json")
        if cached:
            return self._cache_path(".json")

        bbox = self._config.get("osm_overpass_bbox", "41.64,-87.94,42.02,-87.52")
        query = _build_overpass_query(bbox)
        data = self._http_post_json(
            OVERPASS_URL,
            data=f"data={query}",
            timeout=180.0,
        )
        return self._save_json_cache(data, suffix=".json")

    # O(n) time, O(n) space — n = OSM elements (per-element categorise is constant: k fixed tag pairs)
    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        elements = raw.get("elements", [])
        records = []
        # O(n) time, O(n) space — n = OSM elements in the Overpass response
        for el in elements:
            if el.get("type") != "node":
                continue
            tags = el.get("tags", {})
            lat = el.get("lat")
            lon = el.get("lon")
            if lat is None or lon is None:
                continue

            category = _categorize_node(tags)
            if not category:
                continue

            name = tags.get("name", "")
            if not name:
                continue

            point = Point(lon, lat)
            geom_json = json.dumps(mapping(point))

            address_parts = [
                tags.get("addr:housenumber", ""),
                tags.get("addr:street", ""),
            ]
            # O(1) time, O(1) space — k = 2 address parts (house number + street)
            address = " ".join(p for p in address_parts if p).strip() or None

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "name": name,
                "category": category,
                "subcategory": tags.get("cuisine") or tags.get("denomination") or None,
                "address": address,
                "phone": tags.get("phone") or tags.get("contact:phone") or None,
                "website": tags.get("website") or tags.get("contact:website") or None,
                "description": tags.get("description") or None,
                "source": "osm",
                "source_id": str(el["id"]),
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records

    # O(n) time, O(n) space — n = POI records (tuple batch built once, inserted in chunks)
    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("pois")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO pois (id, city_id, name, category, subcategory,
                    address, phone, website, description, source, source_id, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            # O(n) time, O(n) space — n = POI records
            batch = [
                (r["id"], r["city_id"], r["name"], r["category"], r["subcategory"],
                 r["address"], r["phone"], r["website"], r["description"],
                 r["source"], r["source_id"], r["geom_json"])
                for r in records
            ]
            chunk_size = 2000
            total = 0
            # O(n) time, O(c) space — n = POI records; c = chunk_size rows sliced per insert_rows call
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i : i + chunk_size]
                insert_rows(cur, sql, chunk)
                total += len(chunk)
            conn.commit()
            cur.close()
            return total
        finally:
            conn.close()
