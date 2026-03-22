"""Import railroad data from OSM Overpass API.

Two potential sources:
  1. FRA North American Rail Network (very large — skipped in v1)
  2. OSM Overpass API (preferred for v1 — manageable size, good coverage)

Overpass returns nodes + ways; we reconstruct LineStrings from way node refs.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import LineString, MultiLineString, mapping

from app.data_import.base_importer import BaseImporter

OVERPASS_URL = "https://overpass-api.de/api/interpreter"


def _build_overpass_query(bbox: str) -> str:
    """Build an Overpass QL query for railroad ways within a bounding box."""
    return f"""
[out:json][timeout:120];
(
  way["railway"="abandoned"]({bbox});
  way["railway"="disused"]({bbox});
  way["railway"="spur"]({bbox});
  way["railway"="razed"]({bbox});
  way["railway"="rail"]({bbox});
  way["railway"="light_rail"]({bbox});
  way["railway"="subway"]({bbox});
);
out body;
>;
out skel qt;
"""


class RailroadsImporter(BaseImporter):
    layer_name = "railroads"

    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        bbox = self._config.get("osm_overpass_bbox", "41.64,-87.94,42.02,-87.52")
        query = _build_overpass_query(bbox)
        data = self._http_post_json(
            OVERPASS_URL,
            data=f"data={query}",
            timeout=180.0,
        )
        return self._save_json_cache(data, suffix=".json")

    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        elements = raw.get("elements", [])

        # Build node lookup: id -> (lon, lat)
        nodes: dict[int, tuple[float, float]] = {}
        ways: list[dict] = []
        for el in elements:
            if el["type"] == "node":
                nodes[el["id"]] = (el["lon"], el["lat"])
            elif el["type"] == "way":
                ways.append(el)

        records = []
        for way in ways:
            tags = way.get("tags", {})
            node_ids = way.get("nodes", [])
            coords = [nodes[nid] for nid in node_ids if nid in nodes]
            if len(coords) < 2:
                continue

            line = LineString(coords)
            multi = MultiLineString([line])
            geom_json = json.dumps(mapping(multi))

            railway_val = tags.get("railway", "rail")
            # Map OSM railway tag to status
            status_map = {
                "rail": "active",
                "light_rail": "active",
                "subway": "active",
                "spur": "active",
                "disused": "disused",
                "abandoned": "abandoned",
                "razed": "razed",
            }
            status = status_map.get(railway_val, "unknown")
            owner = tags.get("operator", "") or tags.get("owner", "") or None
            name = tags.get("name", "") or None

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "name": name,
                "owner": owner,
                "status": status,
                "track_class": tags.get("usage", None),
                "source": "osm",
                "source_id": str(way["id"]),
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("railroads")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO railroads (id, city_id, name, owner, status,
                    track_class, source, geom, metadata)
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326),
                    %s::jsonb)
            """
            batch = [
                (r["id"], r["city_id"], r["name"], r["owner"], r["status"],
                 r["track_class"], r["source"], r["geom_json"],
                 json.dumps({"source_id": r["source_id"]}))
                for r in records
            ]
            chunk_size = 2000
            total = 0
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i : i + chunk_size]
                cur.executemany(sql, chunk)
                total += len(chunk)
            conn.commit()
            cur.close()
            return total
        finally:
            conn.close()
