"""Import neighborhood boundaries from ArcGIS Hub (Detroit-specific layer).

Uses the ArcGIS FeatureServer pagination helper for data download.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import shape, mapping
from shapely import MultiPolygon, Polygon

from app.data_import.base_importer import BaseImporter
from app.data_import.arcgis_helper import ArcGISFeatureServerClient


def _ensure_multipolygon(geom) -> str | None:
    """Convert a Shapely geometry to a MultiPolygon GeoJSON string."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, Polygon):
        geom = MultiPolygon([geom])
    elif not isinstance(geom, MultiPolygon):
        return None
    return json.dumps(mapping(geom))


class NeighborhoodsImporter(BaseImporter):
    layer_name = "neighborhoods"

    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        url = self._config.get("url", "")
        if not url:
            raise ValueError("No neighborhoods URL configured")

        # Use ArcGIS FeatureServer client if flagged
        if self._config.get("arcgis_featureserver"):
            source_srid = self._config.get("source_srid", 4326)
            page_size = self._config.get("page_size", 2000)
            client = ArcGISFeatureServerClient(url, source_srid=source_srid, page_size=page_size)
            data = client.download_all()
        else:
            data = self._http_get_json(url)

        return self._save_json_cache(data)

    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        features = raw.get("features", []) if isinstance(raw, dict) else []
        records = []
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

            # Detroit neighborhood data field names (from ArcGIS Hub)
            name = (
                props.get("nhood_name", "")
                or props.get("name", "")
                or props.get("NHOOD_NAME", "")
                or props.get("Name", "")
            )
            if not name:
                continue

            council_district = (
                props.get("council_di", "")
                or props.get("council_district", "")
                or props.get("COUNCIL_DI", "")
                or None
            )
            website = props.get("website", "") or props.get("URL", "") or None

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "name": name.strip(),
                "council_district": str(council_district).strip() if council_district else None,
                "website": website.strip() if website else None,
                "geom_json": multi_json,
            })
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("neighborhoods")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO neighborhoods (id, city_id, name, council_district, website, geom)
                VALUES (%s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            batch = [
                (r["id"], r["city_id"], r["name"], r["council_district"],
                 r["website"], r["geom_json"])
                for r in records
            ]
            cur.executemany(sql, batch)
            conn.commit()
            count = cur.rowcount
            cur.close()
            return count
        finally:
            conn.close()
