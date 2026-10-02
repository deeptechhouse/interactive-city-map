"""Import blight violations and commercial demolitions from Detroit ArcGIS Hub.

Combines two data sources into a single blight_violations table:
1. Blight Tickets (874K+ records) — filtered to only those with coordinates
2. Commercial Demolitions (1,200+ records) — all have coordinates

Also imports OSM abandoned/disused features as a third source.
"""

import json
import uuid
from pathlib import Path

from shapely.geometry import Point, mapping, shape

from app.data_import.base_importer import BaseImporter
from app.data_import.arcgis_helper import ArcGISFeatureServerClient

# Blight ticket API caps at 2000/page; we want only geolocated records
BLIGHT_TICKETS_URL = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/blight_tickets/FeatureServer/0/query"
COMMERCIAL_DEMO_URL = "https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/Commercial_Demolitions/FeatureServer/0/query"


class BlightImporter(BaseImporter):
    layer_name = "blight_violations"

    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        all_features: list[dict] = []

        # 1. Blight tickets — filter to only geolocated records
        self._log.info("downloading_blight_tickets")
        blight_client = ArcGISFeatureServerClient(
            BLIGHT_TICKETS_URL, page_size=2000
        )
        blight_data = blight_client.download_all()
        blight_features = blight_data.get("features", [])
        # Tag source
        for f in blight_features:
            if f.get("properties"):
                f["properties"]["_source"] = "blight_ticket"
            elif f.get("attributes"):
                f["attributes"]["_source"] = "blight_ticket"
        all_features.extend(blight_features)
        self._log.info("blight_tickets_downloaded", count=len(blight_features))

        # 2. Commercial demolitions
        self._log.info("downloading_commercial_demolitions")
        demo_client = ArcGISFeatureServerClient(
            COMMERCIAL_DEMO_URL, page_size=2000
        )
        demo_data = demo_client.download_all()
        demo_features = demo_data.get("features", [])
        for f in demo_features:
            if f.get("properties"):
                f["properties"]["_source"] = "commercial_demolition"
            elif f.get("attributes"):
                f["attributes"]["_source"] = "commercial_demolition"
        all_features.extend(demo_features)
        self._log.info("demolitions_downloaded", count=len(demo_features))

        # 3. OSM abandoned features (from cached file if available)
        osm_cache = self._cache_path(".osm_abandoned.json")
        if osm_cache.exists():
            self._log.info("loading_osm_abandoned")
            osm_data = json.loads(osm_cache.read_text())
            osm_elements = osm_data.get("elements", [])
            osm_count = 0
            for el in osm_elements:
                if el.get("type") == "node" and "tags" in el and el.get("lat") and el.get("lon"):
                    point_geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
                    tags = el["tags"]
                    name = tags.get("name", tags.get("old_name", ""))
                    # Build a description from the abandoned/disused tags
                    desc_parts = []
                    for k, v in tags.items():
                        if k.startswith("disused:") or k.startswith("abandoned:"):
                            desc_parts.append(f"{k}={v}")
                    all_features.append({
                        "type": "Feature",
                        "geometry": point_geom,
                        "properties": {
                            "_source": "osm_abandoned",
                            "name": name,
                            "violation_description": ", ".join(desc_parts) or "abandoned/disused (OSM)",
                            "ticket_status": "abandoned",
                        }
                    })
                    osm_count += 1
            self._log.info("osm_abandoned_loaded", count=osm_count)

        collection = {"type": "FeatureCollection", "features": all_features}
        return self._save_json_cache(collection)

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
            if geom.is_empty:
                continue
            # Only keep point features (blight tickets and demolitions are geocoded)
            if not isinstance(geom, Point):
                # Try centroid for polygons
                geom = geom.centroid
            point_json = json.dumps(mapping(geom))

            source = props.get("_source", "unknown")

            # Extract fields based on source
            if source == "blight_ticket":
                address = props.get("violation_address", "") or props.get("ViolationAddress", "") or ""
                violation_code = props.get("violation_code", "") or props.get("ViolationCode", "") or ""
                violation_desc = props.get("violation_description", "") or props.get("ViolationDescription", "") or ""
                ticket_status = props.get("ticket_status", "") or props.get("disposition", "") or props.get("PaymentStatus", "") or ""
                violation_date = props.get("violation_date", "") or props.get("TicketIssuedDT", "") or ""
            elif source == "commercial_demolition":
                address = props.get("address", "") or props.get("Address", "") or ""
                violation_code = "DEMO"
                violation_desc = props.get("demo_status", "") or props.get("Status", "") or "Commercial demolition"
                ticket_status = props.get("demo_status", "") or "demolition"
                violation_date = props.get("demo_date", "") or ""
            else:  # osm_abandoned
                address = ""
                violation_code = "OSM"
                violation_desc = props.get("violation_description", "abandoned (OSM)")
                ticket_status = props.get("ticket_status", "abandoned")
                violation_date = ""

            records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "address": address.strip() if address else None,
                "violation_code": violation_code.strip() if violation_code else None,
                "violation_description": violation_desc.strip() if violation_desc else None,
                "ticket_status": ticket_status.strip() if ticket_status else None,
                "violation_date": str(violation_date).strip() if violation_date else None,
                "source": source,
                "geom_json": point_json,
            })
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        if not records:
            return 0
        self._truncate_table("blight_violations")
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            sql = """
                INSERT INTO blight_violations (id, city_id, address, violation_code,
                    violation_description, ticket_status, violation_date, source, geom)
                VALUES (%s, %s, %s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            chunk_size = 5000
            total = 0
            batch = [
                (r["id"], r["city_id"], r["address"], r["violation_code"],
                 r["violation_description"], r["ticket_status"], r["violation_date"],
                 r["source"], r["geom_json"])
                for r in records
            ]
            for i in range(0, len(batch), chunk_size):
                chunk = batch[i : i + chunk_size]
                cur.executemany(sql, chunk)
                total += len(chunk)
                self._log.info("loaded_chunk", progress=total, total=len(batch))
            conn.commit()
            cur.close()
            return total
        finally:
            conn.close()
