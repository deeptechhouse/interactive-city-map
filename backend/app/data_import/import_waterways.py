"""Import waterways from Chicago Open Data (Socrata GeoJSON API)."""

import json
import uuid
from pathlib import Path

from shapely.geometry import shape, mapping

from app.data_import.base_importer import BaseImporter, insert_rows


class WaterwaysImporter(BaseImporter):
    layer_name = "waterways"

    # O(n) time, O(n) space — n = waterway features downloaded
    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        url = self._config.get("url", "")
        if not url:
            raise ValueError("No waterways URL configured")

        data = self._http_get_json(url)
        return self._save_json_cache(data)

    # O(n + v) time, O(n + v) space — n = features in the raw file; v = total vertices across all feature geometries
    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        features = raw.get("features", []) if isinstance(raw, dict) else []
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

            geom_str = json.dumps(mapping(geom))
            name = props.get("name", "") or props.get("gnis_name", "") or None
            waterway_type = props.get("waterway_type", "") or props.get("ftype", "") or None

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "name": name,
                "waterway_type": waterway_type,
                "geom_json": geom_str,
            })
        self._log.info("transformed", count=len(records))
        return records

    # Rows go through insert_rows (multi-row INSERT, INSERT_PAGE_SIZE per statement).
    # O(n) time, O(n) space — n = records inserted (n / INSERT_PAGE_SIZE statements)
    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("waterways")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO waterways (id, city_id, name, waterway_type, geom)
                VALUES (%s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            # O(n) time, O(n) space — n = records being turned into insert tuples
            batch = [
                (r["id"], r["city_id"], r["name"], r["waterway_type"], r["geom_json"])
                for r in records
            ]
            count = insert_rows(cur, sql, batch)
            conn.commit()
            cur.close()
            return count
        finally:
            conn.close()
