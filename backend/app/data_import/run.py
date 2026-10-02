"""CLI runner for the data import pipeline.

Usage:
    python -m app.data_import.run --city chicago
    python -m app.data_import.run --city chicago --only zoning,buildings
    python -m app.data_import.run --city chicago --only transit --clear-cache
"""

import argparse
import sys
import uuid
from pathlib import Path

import psycopg2
import structlog
import yaml

from app.data_import.base_importer import CACHE_DIR
from app.data_import.city_registry import UseCityLoaderError, importers_for

logger = structlog.get_logger(__name__)

# Default DB URL (same as app config)
DEFAULT_DB_URL = "postgresql://citymap:citymap@localhost:5433/citymap"

# O(b) time, O(b) space — b = bytes of the city YAML
def _load_city_config(city_slug: str) -> dict:
    """Load city configuration from the YAML file."""
    config_dir = Path(__file__).parent / "configs"
    config_path = config_dir / f"{city_slug}.yaml"
    if not config_path.exists():
        raise FileNotFoundError(f"City config not found: {config_path}")
    with open(config_path) as f:
        return yaml.safe_load(f)


# O(1) time, O(1) space — n = 1 city row (indexed slug lookup + insert)
def _ensure_city_record(db_url: str, city_config: dict) -> str:
    """Insert the city record if it doesn't exist. Return the city ID."""
    city = city_config["city"]
    slug = city["slug"]
    conn = psycopg2.connect(db_url)
    try:
        cur = conn.cursor()
        # Check if city already exists
        cur.execute("SELECT id FROM cities WHERE slug = %s", (slug,))
        row = cur.fetchone()
        if row:
            city_id = str(row[0])
            logger.info("city_exists", slug=slug, city_id=city_id)
            cur.close()
            return city_id

        # Create city record
        city_id = str(uuid.uuid4())
        center = city["center"]  # [lon, lat]
        bounds = city["bounds"]  # [[sw_lon, sw_lat], [ne_lon, ne_lat]]

        # Build a bounding box polygon from the bounds
        sw_lon, sw_lat = bounds[0]
        ne_lon, ne_lat = bounds[1]
        bounds_wkt = (
            f"POLYGON(({sw_lon} {sw_lat}, {ne_lon} {sw_lat}, "
            f"{ne_lon} {ne_lat}, {sw_lon} {ne_lat}, {sw_lon} {sw_lat}))"
        )
        center_wkt = f"POINT({center[0]} {center[1]})"

        cur.execute(
            """
            INSERT INTO cities (id, name, slug, state, default_zoom, bounds, center)
            VALUES (%s, %s, %s, %s, %s,
                ST_SetSRID(ST_GeomFromText(%s), 4326),
                ST_SetSRID(ST_GeomFromText(%s), 4326))
            """,
            (city_id, city["name"], slug, city["state"],
             city.get("default_zoom", 12), bounds_wkt, center_wkt),
        )
        conn.commit()
        cur.close()
        logger.info("city_created", slug=slug, city_id=city_id)
        return city_id
    finally:
        conn.close()


# O(1) time, O(1) space — n = 1–2 config blocks
def _get_importer_config(sources: dict, layer: str) -> dict:
    """Extract the config dict for a specific importer from sources."""
    if layer == "transit":
        # Transit importer needs both transit_lines and transit_stations
        return {
            "transit_lines": sources.get("transit_lines", {}),
            "transit_stations": sources.get("transit_stations", {}),
        }
    return sources.get(layer, {})


# O(f) time, O(1) space — f = cached files deleted
def clear_cache():
    """Remove all cached download files."""
    if CACHE_DIR.exists():
        import shutil
        shutil.rmtree(CACHE_DIR)
        CACHE_DIR.mkdir(parents=True, exist_ok=True)
        logger.info("cache_cleared", path=str(CACHE_DIR))


# O(N) time, O(N) space — N = rows imported across the city's layers
def main():
    parser = argparse.ArgumentParser(description="Import spatial data into PostGIS")
    parser.add_argument("--city", required=True, help="City slug (e.g., 'chicago')")
    parser.add_argument("--only", default="", help="Comma-separated list of layers to import")
    parser.add_argument("--db-url", default=DEFAULT_DB_URL, help="PostgreSQL connection string")
    parser.add_argument("--clear-cache", action="store_true", help="Clear download cache before importing")
    args = parser.parse_args()

    if args.clear_cache:
        clear_cache()

    # Which importers run for this city (city_registry.py). Detroit/Dayton are refused
    # here — their rows come from scripts/load_city_db.py — BEFORE any city row is written.
    try:
        plan = importers_for(args.city)
    except UseCityLoaderError as err:
        print(str(err))
        sys.exit(2)
    classes = dict(plan)

    # Load config
    config = _load_city_config(args.city)
    sources = config.get("sources", {})

    # Ensure city record
    city_id = _ensure_city_record(args.db_url, config)

    # Determine which layers to run
    if args.only:
        # O(k) time, O(k) space — k = requested layers
        layers = [x.strip() for x in args.only.split(",") if x.strip()]
        # O(k) time, O(1) space — k = requested layers
        for layer in layers:
            if layer not in classes:
                print(f"Unknown layer: {layer}. Available: {', '.join(classes)}")
                sys.exit(1)
    else:
        layers = list(classes)

    # Run importers in the plan's dependency order
    results: dict[str, int] = {}
    # O(N) time, O(N) space — N = rows imported across layers
    for layer, cls in plan:
        if layer not in layers:
            continue
        importer_config = _get_importer_config(sources, layer)
        importer = cls(db_url=args.db_url, city_id=city_id, config=importer_config)
        count = importer.run()
        results[layer] = count

    # Report
    print("\n" + "=" * 50)
    print(f"Import Results for {config['city']['name']}")
    print("=" * 50)
    total = 0
    # O(l) time, O(1) space — l = layers reported
    for layer, count in results.items():
        status = f"{count:>8,} rows" if count > 0 else "  skipped"
        print(f"  {layer:<20} {status}")
        total += count
    print("-" * 50)
    print(f"  {'TOTAL':<20} {total:>8,} rows")
    print("=" * 50)


if __name__ == "__main__":
    main()
