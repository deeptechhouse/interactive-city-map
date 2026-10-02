"""Import transit lines and stations from GeoJSON (Chicago/Socrata) or GTFS ZIP (Detroit/multi-agency).

Supports two data source formats:
1. GeoJSON URLs (Socrata) — used by Chicago CTA data
2. GTFS ZIP files — used by Detroit (DDOT, SMART, QLine, People Mover)

The importer auto-detects which format to use based on config keys:
- If transit_lines has a "url" key → GeoJSON path (original Chicago behavior)
- If transit_lines has keys ending in "_gtfs_url" → GTFS ZIP path
"""

import csv
import io
import json
import uuid
import zipfile
from collections import defaultdict
from pathlib import Path

import httpx
from shapely.geometry import shape, mapping, Point
from shapely import LineString, MultiLineString

from app.data_import.base_importer import BaseImporter

# Official CTA L line colors (Chicago)
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

# Detroit transit system colors and metadata
# system_key -> (display_name, hex_color, line_type)
DETROIT_TRANSIT_SYSTEMS: dict[str, tuple[str, str, str]] = {
    "ddot": ("DDOT", "#0054A6", "bus"),
    "smart": ("SMART", "#CE1126", "bus"),
    "qline": ("QLine", "#C8A951", "streetcar"),
    "people_mover": ("People Mover", "#8C8C8C", "automated_rail"),
}

# GTFS route_type codes -> line_type
# See: https://gtfs.org/schedule/reference/#routestxt
_GTFS_ROUTE_TYPE_MAP: dict[int, str] = {
    0: "streetcar",      # Tram, Streetcar, Light rail
    1: "heavy_rail",     # Subway, Metro
    2: "commuter_rail",  # Rail
    3: "bus",            # Bus
    4: "ferry",          # Ferry
    5: "cable_car",      # Cable tram
    6: "gondola",        # Aerial lift
    7: "funicular",      # Funicular
    11: "trolleybus",    # Trolleybus
    12: "monorail",      # Monorail
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


def _is_gtfs_config(config: dict) -> bool:
    """Check if the config uses GTFS ZIP format (vs. GeoJSON URLs)."""
    lines_config = config.get("transit_lines", {})
    return any(k.endswith("_gtfs_url") for k in lines_config)


def _extract_system_key(url_key: str) -> str:
    """Extract system key from GTFS URL config key.

    'ddot_gtfs_url' -> 'ddot'
    'people_mover_gtfs_url' -> 'people_mover'
    """
    return url_key.replace("_gtfs_url", "")


class TransitImporter(BaseImporter):
    layer_name = "transit"

    def download(self) -> Path:
        cached = self._load_json_cache()
        if cached:
            return self._cache_path()

        if _is_gtfs_config(self._config):
            return self._download_gtfs()
        return self._download_geojson()

    def _download_geojson(self) -> Path:
        """Original GeoJSON download path (Chicago/Socrata)."""
        lines_url = self._config.get("transit_lines", {}).get("url", "")
        stations_url = self._config.get("transit_stations", {}).get("url", "")

        lines_data = self._http_get_json(lines_url) if lines_url else {"features": []}
        stations_data = self._http_get_json(stations_url) if stations_url else {"features": []}

        combined = {"lines": lines_data, "stations": stations_data, "format": "geojson"}
        return self._save_json_cache(combined, suffix=".json")

    def _download_gtfs(self) -> Path:
        """Download and parse GTFS ZIP files from multiple transit agencies."""
        lines_config = self._config.get("transit_lines", {})
        stations_config = self._config.get("transit_stations", {})

        all_routes: list[dict] = []
        all_stops: list[dict] = []

        # Collect all GTFS URLs from both lines and stations config
        gtfs_urls: dict[str, str] = {}
        for key, url in lines_config.items():
            if key.endswith("_gtfs_url") and url:
                system_key = _extract_system_key(key)
                gtfs_urls[system_key] = url
        # Also check stations config for any systems not in lines
        for key, url in stations_config.items():
            if key.endswith("_gtfs_url") and url:
                system_key = _extract_system_key(key)
                if system_key not in gtfs_urls:
                    gtfs_urls[system_key] = url

        for system_key, url in gtfs_urls.items():
            self._log.info("gtfs_download", system=system_key, url=url[:100])
            try:
                routes, stops = self._parse_gtfs_zip(url, system_key)
                all_routes.extend(routes)
                all_stops.extend(stops)
                self._log.info(
                    "gtfs_parsed", system=system_key,
                    routes=len(routes), stops=len(stops),
                )
            except Exception:
                self._log.exception("gtfs_parse_failed", system=system_key)

        combined = {
            "routes": all_routes,
            "stops": all_stops,
            "format": "gtfs",
        }
        return self._save_json_cache(combined, suffix=".json")

    def _parse_gtfs_zip(self, url: str, system_key: str) -> tuple[list[dict], list[dict]]:
        """Download a GTFS ZIP and extract routes (as LineStrings) and stops (as Points).

        GTFS files used:
        - routes.txt: route_id, route_long_name, route_short_name, route_color, route_type
        - trips.txt: route_id -> shape_id mapping
        - shapes.txt: shape_id -> ordered lat/lon points -> LineStrings
        - stops.txt: stop_id, stop_name, stop_lat, stop_lon
        """
        # Download the ZIP file
        with httpx.Client(timeout=120.0, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            zip_bytes = resp.content

        routes_data: list[dict] = []
        stops_data: list[dict] = []

        with zipfile.ZipFile(io.BytesIO(zip_bytes)) as zf:
            file_list = zf.namelist()

            # --- Parse routes.txt ---
            routes_by_id: dict[str, dict] = {}
            if "routes.txt" in file_list:
                with zf.open("routes.txt") as f:
                    reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                    for row in reader:
                        route_id = row.get("route_id", "").strip()
                        if not route_id:
                            continue
                        routes_by_id[route_id] = {
                            "long_name": row.get("route_long_name", "").strip(),
                            "short_name": row.get("route_short_name", "").strip(),
                            "color": row.get("route_color", "").strip(),
                            "route_type": int(row.get("route_type", "3")),
                        }

            # --- Parse shapes.txt -> build LineStrings per shape_id ---
            shapes: dict[str, list[tuple[float, float, int]]] = defaultdict(list)
            if "shapes.txt" in file_list:
                with zf.open("shapes.txt") as f:
                    reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                    for row in reader:
                        shape_id = row.get("shape_id", "").strip()
                        if not shape_id:
                            continue
                        try:
                            lat = float(row["shape_pt_lat"])
                            lon = float(row["shape_pt_lon"])
                            seq = int(row.get("shape_pt_sequence", 0))
                        except (ValueError, KeyError):
                            continue
                        shapes[shape_id].append((lon, lat, seq))

            # Sort shape points by sequence
            for shape_id in shapes:
                shapes[shape_id].sort(key=lambda p: p[2])

            # --- Parse trips.txt -> map route_id to shape_ids ---
            route_to_shapes: dict[str, set[str]] = defaultdict(set)
            if "trips.txt" in file_list:
                with zf.open("trips.txt") as f:
                    reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                    for row in reader:
                        route_id = row.get("route_id", "").strip()
                        shape_id = row.get("shape_id", "").strip()
                        if route_id and shape_id:
                            route_to_shapes[route_id].add(shape_id)

            # --- Build route LineStrings ---
            # Look up system display name and color
            system_info = DETROIT_TRANSIT_SYSTEMS.get(system_key)
            system_name = system_info[0] if system_info else system_key.upper()
            system_color = system_info[1] if system_info else None
            system_line_type = system_info[2] if system_info else "bus"

            for route_id, route_info in routes_by_id.items():
                shape_ids = route_to_shapes.get(route_id, set())
                if not shape_ids:
                    continue

                # Build LineStrings from all shapes for this route
                line_geoms = []
                for sid in shape_ids:
                    pts = shapes.get(sid, [])
                    if len(pts) < 2:
                        continue
                    coords = [(p[0], p[1]) for p in pts]
                    line_geoms.append(LineString(coords))

                if not line_geoms:
                    continue

                # Merge into a MultiLineString
                multi = MultiLineString(line_geoms) if len(line_geoms) > 1 else line_geoms[0]
                geom_json = _ensure_multilinestring(multi)
                if not geom_json:
                    continue

                # Determine display name
                name = route_info["long_name"] or route_info["short_name"] or route_id
                # Use route-level color if available, otherwise system color
                color = None
                if route_info["color"]:
                    color = f"#{route_info['color']}" if not route_info["color"].startswith("#") else route_info["color"]
                if not color:
                    color = system_color

                # Use GTFS route_type if available, otherwise system default
                line_type = _GTFS_ROUTE_TYPE_MAP.get(route_info["route_type"], system_line_type)

                routes_data.append({
                    "route_id": route_id,
                    "system": system_name,
                    "name": name,
                    "color": color,
                    "line_type": line_type,
                    "geom_json": geom_json,
                })

            # --- Parse stops.txt ---
            if "stops.txt" in file_list:
                with zf.open("stops.txt") as f:
                    reader = csv.DictReader(io.TextIOWrapper(f, encoding="utf-8-sig"))
                    for row in reader:
                        stop_name = row.get("stop_name", "").strip()
                        if not stop_name:
                            continue
                        try:
                            lat = float(row["stop_lat"])
                            lon = float(row["stop_lon"])
                        except (ValueError, KeyError):
                            continue

                        point = Point(lon, lat)
                        point_json = json.dumps(mapping(point))

                        # location_type: 0 or blank = stop, 1 = station
                        location_type = row.get("location_type", "0").strip()

                        # wheelchair_boarding: 0=no info, 1=yes, 2=no
                        wheelchair = row.get("wheelchair_boarding", "0").strip()
                        accessible = wheelchair == "1" if wheelchair in ("1", "2") else None

                        stops_data.append({
                            "stop_id": row.get("stop_id", "").strip(),
                            "system": system_name,
                            "name": stop_name,
                            "location_type": location_type,
                            "accessible": accessible,
                            "geom_json": point_json,
                        })

        return routes_data, stops_data

    def transform(self, raw_path: Path) -> list[dict]:
        raw = json.loads(raw_path.read_text())
        data_format = raw.get("format", "geojson")

        if data_format == "gtfs":
            return self._transform_gtfs(raw)
        return self._transform_geojson(raw)

    def _transform_geojson(self, raw: dict) -> list[dict]:
        """Original GeoJSON transform path (Chicago/Socrata)."""
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

    def _transform_gtfs(self, raw: dict) -> list[dict]:
        """Transform GTFS-parsed routes and stops into DB-ready records."""
        routes = raw.get("routes", [])
        stops = raw.get("stops", [])

        # --- Build line records (deduplicate routes by system+name) ---
        line_records = []
        line_name_to_id: dict[str, str] = {}
        seen_routes: set[str] = set()

        for route in routes:
            # Deduplicate: same system + route_id
            dedup_key = f"{route['system']}_{route['route_id']}"
            if dedup_key in seen_routes:
                continue
            seen_routes.add(dedup_key)

            line_id = str(uuid.uuid4())
            name = route["name"]
            line_name_to_id[f"{route['system'].lower()}_{name.lower()}"] = line_id

            line_records.append({
                "id": line_id,
                "city_id": self._city_id,
                "name": name,
                "color": route.get("color"),
                "system": route["system"],
                "line_type": route.get("line_type", "bus"),
                "geom_json": route["geom_json"],
            })

        # --- Build station records ---
        # For GTFS, deduplicate stops by name + proximity (many agencies
        # share stops or have duplicate stop entries for different directions)
        station_records = []
        seen_stops: set[str] = set()

        for stop in stops:
            # Skip child stops (location_type 0 with parent)
            # Keep stations (location_type 1) and standalone stops
            dedup_key = f"{stop['system']}_{stop['stop_id']}"
            if dedup_key in seen_stops:
                continue
            seen_stops.add(dedup_key)

            station_records.append({
                "id": str(uuid.uuid4()),
                "city_id": self._city_id,
                "line_id": None,  # GTFS stops aren't directly linked to a single line
                "name": stop["name"],
                "lines_served": [stop["system"]],
                "accessible": stop.get("accessible"),
                "geom_json": stop["geom_json"],
            })

        self._log.info(
            "transformed_gtfs",
            lines=len(line_records), stations=len(station_records),
        )
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
