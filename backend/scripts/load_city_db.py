"""Load one city into PostGIS for DATABASE mode (Martin tiles + the full API).

PURPOSE
    Detroit and Dayton were built for static mode only. This fills the database from the
    same importers (app/data_import/db_load.py), so `./run-db.sh` shows every city from
    PostGIS. Chicago is refused: its rows were loaded by app.data_import.run long ago and
    are in daily use — this tool never deletes or rewrites them.

USAGE (from backend/, with the DB venv; Docker postgres must be up — ./run-db.sh starts it):
    .venv-db/bin/python -m scripts.load_city_db --city detroit
    .venv-db/bin/python -m scripts.load_city_db --city dayton --layers buildings,zoning

FLOW
    main() → parse_args() → city yaml + <slug>.static_plan.STATIC_PLAN
           → run._ensure_city_record()   (cities row; Dayton has none until the first load)
           → db_load.load_plan()         (one transaction per city)

    Downloads are cached in $TMPDIR/citymap_import_cache (shared with the static build), so
    a reload after a fix doesn't re-download.
"""

from __future__ import annotations

import argparse
import importlib
import sys

from app.data_import import db_load
from app.data_import.run import DEFAULT_DB_URL, _ensure_city_record, _load_city_config


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """O(a) time, O(a) space — a = CLI arguments."""
    parser = argparse.ArgumentParser(description="Load one city's layers into PostGIS.")
    parser.add_argument("--city", required=True, help="city slug, e.g. detroit")
    parser.add_argument("--layers", default="", help="comma-separated layer ids (default all)")
    # ADJUSTABLE: points at the Docker postgres published on 5433 (docker-compose.yml).
    parser.add_argument("--db-url", default=DEFAULT_DB_URL, help="PostgreSQL connection string")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """O(1) time, O(1) space — s = 3 stages (wiring only, the work is in db_load)."""
    args = parse_args(argv)
    slug = args.city.strip().lower()
    if slug == "chicago":
        print("refusing: Chicago's database rows are not managed by this script", file=sys.stderr)
        return 2
    try:
        plan = importlib.import_module(f"app.data_import.{slug}.static_plan").STATIC_PLAN
    except ModuleNotFoundError:
        print(
            f"no static plan for {slug!r} (app/data_import/{slug}/static_plan.py)", file=sys.stderr
        )
        return 2
    config = _load_city_config(slug)
    city_uuid = _ensure_city_record(args.db_url, config)
    # O(l) time, O(l) space — l = requested layer ids
    only = {x.strip() for x in args.layers.split(",") if x.strip()} or None
    written = db_load.load_plan(plan, config.get("sources", {}), args.db_url, city_uuid, only)
    print(f"\n{config['city']['name']} → PostGIS")
    # O(t) time, O(1) space — t = tables written
    for table, count in written.items():
        print(f"  {table:<20} {count:>9,} rows")
    return 0 if written else 1


if __name__ == "__main__":
    sys.exit(main())
