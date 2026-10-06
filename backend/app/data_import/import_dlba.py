"""Import Detroit Land Bank Authority (DLBA) owned properties from ArcGIS Hub.

Detroit-specific layer showing city-owned land bank parcels with status
(auction, side lot, demolition, etc.). Uses ArcGIS FeatureServer pagination.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import shape, mapping

from app.data_import.base_importer import BaseImporter, insert_rows
from app.data_import.arcgis_helper import ArcGISFeatureServerClient


class DLBAImporter(BaseImporter):
    layer_name = "dlba_properties"

    # O(n) time, O(n) space — n = DLBA features downloaded
    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        url = self._config.get("url", "")
        if not url:
            raise ValueError("No DLBA properties URL configured")

        if self._config.get("arcgis_featureserver"):
            source_srid = self._config.get("source_srid", 4326)
            page_size = self._config.get("page_size", 2000)
            client = ArcGISFeatureServerClient(url, source_srid=source_srid, page_size=page_size)
            data = client.download_all()
        else:
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

            # DLBA property field names (from ArcGIS Hub)
            address = (
                props.get("address", "")
                or props.get("Address", "")
                or props.get("FULL_ADDRESS", "")
                or props.get("property_address", "")
            )
            status = (
                props.get("status", "")
                or props.get("Status", "")
                or props.get("own_status", "")
                or props.get("PROPERTY_STATUS", "")
            )
            property_type = (
                props.get("property_type", "")
                or props.get("PropertyType", "")
                or props.get("PROPERTY_TYPE", "")
                or props.get("structure_type", "")
            )
            neighborhood = (
                props.get("neighborhood", "")
                or props.get("Neighborhood", "")
                or props.get("nhood_name", "")
            )
            council_district = (
                props.get("council_district", "")
                or props.get("Council_District", "")
            )

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "address": address.strip() if address else None,
                "status": status.strip() if status else None,
                "property_type": property_type.strip() if property_type else None,
                "neighborhood": neighborhood.strip() if neighborhood else None,
                "council_district": str(council_district).strip() if council_district else None,
                "geom_json": geom_str,
            })
        self._log.info("transformed", count=len(records))
        return records

    # Rows go through insert_rows (multi-row INSERT, INSERT_PAGE_SIZE per statement).
    # O(n) time, O(n) space — n = records; c = n / 5000 chunks, each sent by insert_rows
    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("dlba_properties")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO dlba_properties (id, city_id, address, status,
                    property_type, neighborhood, council_district, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            # O(n) time, O(n) space — n = records being turned into insert tuples
            batch = [
                (r["id"], r["city_id"], r["address"], r["status"],
                 r["property_type"], r["neighborhood"], r["council_district"],
                 r["geom_json"])
                for r in records
            ]
            # Insert in chunks to avoid memory issues
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
