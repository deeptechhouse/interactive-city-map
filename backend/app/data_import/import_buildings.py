"""Import building footprints from Socrata GeoJSON API or ArcGIS FeatureServer.

Supports two pagination modes:
1. Socrata: $offset/$limit (Chicago)
2. ArcGIS FeatureServer: resultOffset/resultRecordCount with optional
   coordinate reprojection (Detroit/SEMCOG in EPSG:2898)
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely import Polygon, MultiPolygon

from app.data_import.base_importer import BaseImporter, insert_rows

PAGE_SIZE = 50000


class BuildingsImporter(BaseImporter):
    layer_name = "buildings"

    # O(n) time, O(n) space — n = building features downloaded
    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        url = self._config.get("url", "")
        if not url:
            raise ValueError("No buildings URL configured")

        # Use ArcGIS FeatureServer client if configured (e.g., SEMCOG for Detroit)
        if self._config.get("arcgis_featureserver"):
            from app.data_import.arcgis_helper import ArcGISFeatureServerClient
            source_srid = self._config.get("source_srid", 4326)
            page_size = self._config.get("page_size", 2000)
            output_format = self._config.get("output_format", "geojson")
            client = ArcGISFeatureServerClient(
                url, source_srid=source_srid, page_size=page_size,
                output_format=output_format,
            )
            collection = client.download_all()
            return self._save_json_cache(collection)

        # Socrata pagination (Chicago default)
        all_features: list[dict] = []
        offset = 0
        # O(n) time, O(n) space — n = features downloaded; p = n / 50000 pages
        while True:
            page_url = f"{url}&$offset={offset}" if "?" in url else f"{url}?$offset={offset}"
            data = self._http_get_json(page_url)
            features = data.get("features", []) if isinstance(data, dict) else []
            if not features:
                break
            all_features.extend(features)
            self._log.info("page_downloaded", offset=offset, features=len(features))
            if len(features) < PAGE_SIZE:
                break
            offset += PAGE_SIZE

        collection = {"type": "FeatureCollection", "features": all_features}
        return self._save_json_cache(collection)

    # O(n + v) time, O(n + v) space — n = features in the raw file; v = total vertices across all feature geometries
    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        features = raw.get("features", [])
        records = []
        # O(n + v) time, O(n + v) space — n = features in the raw file; v = total vertices across all feature geometries
        for feat in features:
            props = feat.get("properties", {})
            geom_json = feat.get("geometry")
            if not geom_json:
                continue
            try:
                geom = shape(geom_json)
            except Exception:
                continue
            if geom.is_empty:
                continue
            # API returns MultiPolygon — extract first polygon for buildings
            if isinstance(geom, MultiPolygon):
                geom = list(geom.geoms)[0] if geom.geoms else None
                if not geom:
                    continue
            if not isinstance(geom, Polygon):
                continue

            geom_str = json.dumps(mapping(geom))

            # Try to extract useful fields from Chicago building footprint data
            address = (
                props.get("bldg_addr", "")
                or props.get("address", "")
                or props.get("f_add1", "")
            )
            name = props.get("bldg_name", "") or props.get("name", "")
            year_built = _safe_int(props.get("year_built") or props.get("yr_built"))
            floors = _safe_int(props.get("stories") or props.get("no_stories") or props.get("floors"))
            sq_ft = _safe_int(props.get("shape_area") or props.get("sqft"))

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "address": address or None,
                "name": name or None,
                "year_built": year_built,
                "floors": floors,
                "sq_ft": sq_ft,
                "geom_json": geom_str,
            })
        self._log.info("transformed", count=len(records))
        return records

    # Rows go through insert_rows (multi-row INSERT, INSERT_PAGE_SIZE per statement).
    # O(n) time, O(n) space — n = records; c = n / 5000 chunks, each sent by insert_rows
    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("buildings")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO buildings (id, city_id, address, name, year_built,
                    floors, sq_ft, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            # O(n) time, O(n) space — n = records being turned into insert tuples
            batch = [
                (r["id"], r["city_id"], r["address"], r["name"],
                 r["year_built"], r["floors"], r["sq_ft"], r["geom_json"])
                for r in records
            ]
            # Insert in chunks of 5000 to avoid memory issues
            chunk_size = 5000
            total = 0
            # O(n) time, O(1) space — n = rows inserted; k = 5000 rows per chunk slice
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i : i + chunk_size]
                insert_rows(cur, sql, chunk)
                total += len(chunk)
                self._log.info("loaded_chunk", progress=total, total=len(batch))
            conn.commit()
            cur.close()
            return total
        finally:
            conn.close()


# O(1) time, O(1) space
def _safe_int(val) -> int | None:
    """Safely convert a value to int, returning None on failure."""
    if val is None:
        return None
    try:
        return int(float(val))
    except (ValueError, TypeError):
        return None
