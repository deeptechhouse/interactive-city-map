"""Import blight violations and commercial demolitions from Detroit ArcGIS Hub.

Combines two data sources into a single blight_violations table:
1. Blight Tickets (~907K rows; ~903K with coordinates, 2005 → today)
2. Commercial Demolitions (~1.3K rows, real point geometry)

Also imports OSM abandoned/disused features as a third source (only if a cached
``.osm_abandoned.json`` exists — nothing in the pipeline writes it yet).

TRAPS — all found against the live services on 2026-10-02:
- blight_tickets geometry is NULL for ~98-100% of rows. The location lives in the
  ``latitude`` / ``longitude`` attribute fields, so points are built from those. The
  old code skipped null-geometry rows and would have imported almost nothing.
- blight_tickets field names are ``address``, ``ordinance_law``,
  ``ordinance_description``, ``disposition``, ``payment_status``,
  ``ticket_issued_date``. The old code read ``violation_address`` / ``violation_code``
  / ``TicketIssuedDT`` — names that do not exist — so every field would have been null.
- The server returns at most 1,000 rows per page. arcgis_helper used to stop after
  the first short page (1,000 of ~907K). Paging now follows exceededTransferLimit.
- Commercial_Demolitions ``demo_date`` is epoch milliseconds; stored as YYYY-MM-DD.
  ArcGIS labels this layer "(Deprecated)" — find its replacement before relying on it.

CITY GATING (fixed 2026-10-02): both URLs come from the city config
(`sources.blight_violations.tickets_url` / `.demolitions_url`). A city without that block
— Chicago today — raises ValueError, which BaseImporter.run() logs and turns into 0 rows,
the same way DLBA and neighborhoods skip. Before this, the Detroit URLs were module
constants, so `run.py --city chicago` downloaded ~874K Detroit tickets and stored them
under Chicago's city_id.
"""

import json
import uuid
from pathlib import Path

from datetime import datetime, timezone

from shapely.geometry import Point, mapping, shape

from app.data_import.base_importer import BaseImporter
from app.data_import.arcgis_helper import ArcGISFeatureServerClient

# Only the fields transform() reads — blight_tickets has 48, this cuts the payload ~5x.
_TICKET_FIELDS = (
    "address", "ordinance_law", "ordinance_description", "disposition",
    "payment_status", "ticket_issued_date", "latitude", "longitude",
)
_DEMO_FIELDS = ("address", "status", "demo_date")

# Default server-side filter: rows we can place on the map. Override per city with
# `tickets_where` in the city yaml (e.g. a date window to shrink the layer).
_GEOLOCATED_WHERE = "latitude IS NOT NULL AND longitude IS NOT NULL"


def _parse_bbox(raw) -> tuple[float, float, float, float] | None:
    """O(1) time, O(1) space — b = 4 bound values.

    City-config bounds [[west, south], [east, north]] → (w, s, e, n), or None.
    """
    if not raw:
        return None
    (w, s), (e, n) = raw
    return float(w), float(s), float(e), float(n)


def _point_json(geometry, props: dict, bbox) -> str | None:
    """O(v) time, O(1) space — v = vertices in the geometry (1 for points).

    GeoJSON point for a feature, or None if it cannot be placed. Uses the feature
    geometry when present, else the latitude/longitude attributes (blight_tickets
    ships ~all rows with null geometry). Rows outside the city bbox — including the
    0,0 placeholder some open-data rows carry — are rejected.
    """
    geom = None
    if geometry:
        try:
            geom = shape(geometry)
        except Exception:
            geom = None
        if geom is not None and not geom.is_empty and not isinstance(geom, Point):
            geom = geom.centroid
    if geom is None or geom.is_empty:
        try:
            geom = Point(float(props["longitude"]), float(props["latitude"]))
        except (KeyError, TypeError, ValueError):
            return None
    if bbox and not (bbox[0] <= geom.x <= bbox[2] and bbox[1] <= geom.y <= bbox[3]):
        return None
    return json.dumps(mapping(geom))


def _epoch_ms_to_date(value) -> str:
    """O(1) time, O(1) space — d = 1 date value.

    ArcGIS date (epoch milliseconds) → 'YYYY-MM-DD'; strings pass through unchanged.
    """
    if isinstance(value, (int, float)):
        return datetime.fromtimestamp(value / 1000, tz=timezone.utc).date().isoformat()
    return value or ""


class BlightImporter(BaseImporter):
    layer_name = "blight_violations"

    def _source_urls(self) -> tuple[str, str]:
        """O(1) time, O(1) space — n = 2 config keys.

        (tickets_url, demolitions_url) from this city's config. Fails closed: no
        tickets_url means this city has no blight source, so nothing is downloaded.
        """
        tickets_url = self._config.get("tickets_url", "")
        if not tickets_url:
            raise ValueError("No blight_violations.tickets_url configured for this city")
        return tickets_url, self._config.get("demolitions_url", "")

    # O(t + d + T) time, O(t + d + o) space — t = tickets; d = demolitions; T = OSM tags; o = OSM nodes
    def download(self) -> Path:
        """Download tickets (+ demolitions, + cached OSM) into one cached collection.

        Config keys (all under ``sources.blight_violations``):
          tickets_url, demolitions_url — required / optional source layers
          tickets_where   — ADJUSTABLE server-side filter (see detroit.yaml)
          page_size       — rows per request; the server caps at 1000 anyway
        """
        # Checked before the cache so an unconfigured city is skipped the same way
        # every time, whether or not a cache file happens to exist.
        tickets_url, demolitions_url = self._source_urls()
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        all_features: list[dict] = []

        page_size = int(self._config.get("page_size", 1000))

        # 1. Blight tickets — server-side filter + only the fields transform() reads
        self._log.info("downloading_blight_tickets")
        blight_client = ArcGISFeatureServerClient(
            tickets_url,
            page_size=page_size,
            where=self._config.get("tickets_where", _GEOLOCATED_WHERE),
            out_fields=",".join(_TICKET_FIELDS),
        )
        blight_data = blight_client.download_all()
        blight_features = blight_data.get("features", [])
        # Tag source
        # O(t) time, O(1) space — t = blight tickets
        for f in blight_features:
            if f.get("properties"):
                f["properties"]["_source"] = "blight_ticket"
            elif f.get("attributes"):
                f["attributes"]["_source"] = "blight_ticket"
        all_features.extend(blight_features)
        self._log.info("blight_tickets_downloaded", count=len(blight_features))

        # 2. Commercial demolitions (optional per city)
        demo_features: list[dict] = []
        if demolitions_url:
            self._log.info("downloading_commercial_demolitions")
            demo_client = ArcGISFeatureServerClient(
                demolitions_url, page_size=page_size, out_fields=",".join(_DEMO_FIELDS)
            )
            demo_features = demo_client.download_all().get("features", [])
        # O(d) time, O(1) space — d = demolition features
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
            # O(T) time, O(o) space — T = tags summed over all OSM elements (input size); o = elements
            for el in osm_elements:
                if el.get("type") == "node" and "tags" in el and el.get("lat") and el.get("lon"):
                    point_geom = {"type": "Point", "coordinates": [el["lon"], el["lat"]]}
                    tags = el["tags"]
                    name = tags.get("name", tags.get("old_name", ""))
                    # Build a description from the abandoned/disused tags
                    desc_parts = []
                    # bigo-lint: disable=BIGO006 — amortised: each tag is visited once overall (T)
                    # O(g) time, O(g) space — g = tags on this element
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

    # O(n) time, O(n) space — n = downloaded features
    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        features = raw.get("features", []) if isinstance(raw, dict) else []
        bbox = _parse_bbox(self._config.get("bbox"))
        records = []
        skipped = 0
        # O(n) time, O(n) space — n = features
        for feat in features:
            props = feat.get("properties") or {}
            point_json = _point_json(feat.get("geometry"), props, bbox)
            if point_json is None:
                skipped += 1
                continue

            source = props.get("_source", "unknown")

            # Extract fields based on source (names verified live 2026-10-02)
            if source == "blight_ticket":
                address = props.get("address") or ""
                violation_code = props.get("ordinance_law") or ""
                violation_desc = props.get("ordinance_description") or ""
                ticket_status = props.get("disposition") or props.get("payment_status") or ""
                violation_date = props.get("ticket_issued_date") or ""
            elif source == "commercial_demolition":
                address = props.get("address") or ""
                violation_code = "DEMO"
                violation_desc = props.get("status") or "Commercial demolition"
                ticket_status = props.get("status") or "demolition"
                violation_date = _epoch_ms_to_date(props.get("demo_date"))
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
        # A big skip count means coordinates moved fields again — check the trap list above.
        self._log.info("transformed", count=len(records), skipped_no_location=skipped)
        return records

    # O(n) time, O(n) space — n = records
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
            # O(n) time, O(n) space — n = records
            batch = [
                (r["id"], r["city_id"], r["address"], r["violation_code"],
                 r["violation_description"], r["ticket_status"], r["violation_date"],
                 r["source"], r["geom_json"])
                for r in records
            ]
            # O(n) time, O(c) space — n = records; c = chunk_size rows per executemany
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
