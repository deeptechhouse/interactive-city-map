"""Import CTA L lines and stations from Chicago Open Data (Socrata GeoJSON API)."""

import json
import uuid
from pathlib import Path

from shapely.geometry import shape, mapping, Point
from shapely import LineString, MultiLineString

from app.data_import.base_importer import BaseImporter

# Official CTA L line colors
CTA_LINE_COLORS: dict[str, str] = {
    "red": "#C60C30",
    "blue": "#00A1DE",
    "brown": "#62361B",
    "green": "#009B3A",
    "orange": "#F9461C",
    "pink": "#E27EA6",
    "purple": "#522398",
    "yellow": "#F9E300",
}


def _normalize_line_name(raw: str) -> str:
    """Extract a canonical line name from various property formats."""
    s = raw.strip().lower()
    for color in CTA_LINE_COLORS:
        if color in s:
            return color.capitalize()
    return raw.strip()


def _color_for_line(name: str) -> str | None:
    """Look up the official CTA hex color for a line name."""
    return CTA_LINE_COLORS.get(name.strip().lower())


def _ensure_multilinestring(geom) -> str | None:
    """Coerce geometry to MultiLineString GeoJSON string."""
    if geom is None or geom.is_empty:
        return None
    if isinstance(geom, LineString):
        geom = MultiLineString([geom])
    elif not isinstance(geom, MultiLineString):
        return None
    return json.dumps(mapping(geom))


class TransitImporter(BaseImporter):
    layer_name = "transit"

    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        lines_url = self._config.get("transit_lines", {}).get("url", "")
        stations_url = self._config.get("transit_stations", {}).get("url", "")

        lines_data = self._http_get_json(lines_url) if lines_url else {"features": []}
        stations_data = self._http_get_json(stations_url) if stations_url else {"features": []}

        combined = {"lines": lines_data, "stations": stations_data}
        return self._save_json_cache(combined, suffix=".json")

    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())

        lines_data = raw.get("lines", {})
        stations_data = raw.get("stations", {})

        lines_features = lines_data.get("features", []) if isinstance(lines_data, dict) else []
        stations_features = stations_data.get("features", []) if isinstance(stations_data, dict) else []

        # --- Transform lines ---
        line_records = []
        line_name_to_id: dict[str, str] = {}
        for feat in lines_features:
            props = feat.get("properties", {})
            geom_json = feat.get("geometry")
            if not geom_json:
                continue
            try:
                geom = shape(geom_json)
            except Exception:
                continue
            multi_json = _ensure_multilinestring(geom)
            if not multi_json:
                continue

            raw_name = (
                props.get("lines", "")
                or props.get("legend", "")
                or props.get("descriptio", "")
                or props.get("name", "")
            )
            name = _normalize_line_name(raw_name)
            line_id = str(uuid.uuid4())
            line_name_to_id[name.lower()] = line_id

            line_records.append({
                "id": line_id,
                "city_id": self._city_id,
                "name": name,
                "color": _color_for_line(name),
                "system": "CTA",
                "line_type": "heavy_rail",
                "geom_json": multi_json,
            })

        # --- Transform stations ---
        station_records = []
        for feat in stations_features:
            props = feat.get("properties", {})
            geom_json = feat.get("geometry")
            if not geom_json:
                continue
            try:
                geom = shape(geom_json)
            except Exception:
                continue
            if not isinstance(geom, Point) or geom.is_empty:
                continue
            point_json = json.dumps(mapping(geom))

            name = props.get("longname", "") or props.get("station_name", "") or props.get("name", "")
            if not name:
                continue

            # lines_served from "lines" property (comma-separated)
            lines_served = []
            raw_lines = props.get("lines", "")
            if raw_lines:
                for part in raw_lines.split(","):
                    normalized = _normalize_line_name(part.strip())
                    if normalized:
                        lines_served.append(normalized)
            if not lines_served:
                # Fallback: check boolean fields per color
                for color in CTA_LINE_COLORS:
                    if props.get(color) is True or str(props.get(color, "")).lower() in ("true", "1", "yes"):
                        lines_served.append(color.capitalize())

            # Try to link to the first matching transit_line
            line_id = None
            for ls in lines_served:
                if ls.lower() in line_name_to_id:
                    line_id = line_name_to_id[ls.lower()]
                    break

            ada = props.get("ada", False)
            accessible = str(ada).lower() in ("true", "1", "yes") if ada is not None else None

            station_records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "line_id": line_id,
                "name": name,
                "lines_served": lines_served or None,
                "accessible": accessible,
                "geom_json": point_json,
            })

        self._log.info("transformed", lines=len(line_records), stations=len(station_records))
        return [{"lines": line_records, "stations": station_records}]

    def load(self, records: list[dict]) -> int:
        if not records or not records[0]:
            return 0
        data = records[0]
        line_records = data.get("lines", [])
        station_records = data.get("stations", [])

        self._truncate_table("transit_stations")
        self._truncate_table("transit_lines")

        conn = self._get_connection()
        try:
            cur = conn.cursor()
            # Insert lines
            line_sql = """
                INSERT INTO transit_lines (id, city_id, name, color, system, line_type, geom)
                VALUES (%s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            for r in line_records:
                cur.execute(line_sql, (
                    r["id"], r["city_id"], r["name"], r["color"],
                    r["system"], r["line_type"], r["geom_json"],
                ))

            # Insert stations
            station_sql = """
                INSERT INTO transit_stations (id, city_id, line_id, name,
                    lines_served, accessible, geom)
                VALUES (%s, %s, %s, %s, %s, %s,
                    ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))
            """
            for r in station_records:
                cur.execute(station_sql, (
                    r["id"], r["city_id"], r["line_id"], r["name"],
                    r["lines_served"], r["accessible"], r["geom_json"],
                ))

            conn.commit()
            cur.close()
            total = len(line_records) + len(station_records)
            return total
        finally:
            conn.close()
