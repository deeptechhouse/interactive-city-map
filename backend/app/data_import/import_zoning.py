"""Import zoning districts from Chicago Open Data (Socrata GeoJSON API)."""

import json
import uuid
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely import MultiPolygon, Polygon

from app.data_import.base_importer import BaseImporter, insert_rows


# Map zone code prefixes to zone_class categories
_ZONE_CLASS_MAP = {
    "M": "manufacturing",
    "PMD": "manufacturing",
    "C": "commercial",
    "B": "commercial",
    "R": "residential",
    "RT": "residential",
    "RS": "residential",
    "RM": "residential",
    "DX": "mixed",
    "DC": "mixed",
    "DR": "mixed",
    "DS": "mixed",
    "PD": "special",
    "POS": "special",
    "T": "transportation",
    "P": "special",
}


# O(1) time, O(1) space — k = 16 zone prefixes
def _classify_zone(zone_code: str) -> str:
    """Map a Chicago zone code to a broad zone_class."""
    if not zone_code:
        return "other"
    code = zone_code.strip().upper()
    # Try longest prefix first
    # O(1) time, O(1) space — k = 16 zone prefixes
    for prefix in sorted(_ZONE_CLASS_MAP, key=len, reverse=True):
        if code.startswith(prefix):
            return _ZONE_CLASS_MAP[prefix]
    return "other"


# O(v) time, O(v) space — v = vertices in the geometry
def _ensure_multipolygon(geom) -> str | None:
    """Convert a Shapely geometry to a MultiPolygon GeoJSON string."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    elif not isinstance(geom, MultiPolygon):
        return None
    return json.dumps(mapping(geom))


class ZoningImporter(BaseImporter):
    layer_name = "zoning"

    # O(n) time, O(n) space — n = zoning features downloaded
    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        url = self._config.get("url", "")
        if not url:
            raise ValueError("No zoning URL configured")

        # Use ArcGIS FeatureServer client if configured (e.g., Detroit)
        if self._config.get("arcgis_featureserver"):
            from app.data_import.arcgis_helper import ArcGISFeatureServerClient
            source_srid = self._config.get("source_srid", 4326)
            page_size = self._config.get("page_size", 2000)
            client = ArcGISFeatureServerClient(url, source_srid=source_srid, page_size=page_size)
            data = client.download_all()
            return self._save_json_cache(data)

        data = self._http_get_json(url)
        return self._save_json_cache(data)

    # O(n + v) time, O(n + v) space — n = features in the raw file; v = total vertices across all feature geometries
    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        features = raw.get("features", raw) if isinstance(raw, dict) else raw
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
            multi_json = _ensure_multipolygon(geom)
            if not multi_json:
                continue

            zone_code = props.get("zone_class", "") or props.get("zone_type", "") or ""
            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "zone_code": zone_code,
                "zone_class": _classify_zone(zone_code),
                "zone_name": props.get("zone_type", zone_code),
                "description": props.get("zone_class_description", ""),
                "ordinance_ref": props.get("ordinance", ""),
                "geom_json": multi_json,
            })
        self._log.info("transformed", count=len(records))
        return records

    # Rows go through insert_rows (multi-row INSERT, INSERT_PAGE_SIZE per statement).
    # O(n) time, O(n) space — n = records inserted (n / INSERT_PAGE_SIZE statements)
    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("zoning_districts")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO zoning_districts (id, city_id, zone_code, zone_class,
                    zone_name, description, ordinance_ref, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            # O(n) time, O(n) space — n = records being turned into insert tuples
            batch = [
                (r["id"], r["city_id"], r["zone_code"], r["zone_class"],
                 r["zone_name"], r["description"], r["ordinance_ref"],
                 r["geom_json"])
                for r in records
            ]
            count = insert_rows(cur, sql, batch)
            conn.commit()
            cur.close()
            return count
        finally:
            conn.close()
