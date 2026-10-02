"""Build one city's static-mode data: PMTiles per layer + a clipped basemap.

PURPOSE
    Writes frontend/public/data/<slug>/ so ./start_map.sh can show the city with no
    backend and no database. Chicago's existing flat files (public/data/*.pmtiles) are
    never read or written — every output path is inside the city's own folder, and
    `--city chicago` is refused outright.

USAGE (from backend/, with the build venv):
    .venv-build/bin/python -m scripts.export_city_static --city detroit
    .venv-build/bin/python -m scripts.export_city_static --city dayton --layers buildings,zoning
    .venv-build/bin/python -m scripts.export_city_static --city detroit --basemap skip

FLOW
    main() → parse_args() → load city yaml + <slug>.static_plan.STATIC_PLAN
           → static_build.build_city() → static_build.extract_basemap()

TOOLS (free / open source): tippecanoe (BSD-2), pmtiles CLI (BSD-3) — `brew install
    tippecanoe pmtiles`. Downloads are cached in $TMPDIR/citymap_import_cache, so re-runs
    after a transform fix don't re-download.
"""

from __future__ import annotations

import argparse
import importlib
import sys
from datetime import date, timedelta
from pathlib import Path

import httpx
import yaml

from app.data_import import static_build

BACKEND_DIR = Path(__file__).resolve().parent.parent
CONFIG_DIR = BACKEND_DIR / "app" / "data_import" / "configs"
PUBLIC_DATA = BACKEND_DIR.parent / "frontend" / "public" / "data"

# Protomaps planet builds are dated daily and pruned after about a week (checked
# 2026-10-02: 20261001 and 20260930 existed, 20260925 was already gone), so the default
# source is found at run time. Pass --basemap-source to pin one. The frontend's
# protomaps-themes-base v4 needs a v4 basemap (Chicago's is 4.14.3).
BASEMAP_BUILD_URL = "https://build.protomaps.com/{date}.pmtiles"
BASEMAP_LOOKBACK_DAYS = 7  # ADJUSTABLE: how far back to search for a planet build


def latest_basemap_source(today: date | None = None) -> str:
    """O(d) time, O(1) space — d = days searched (≤ BASEMAP_LOOKBACK_DAYS HEAD requests)."""
    today = today or date.today()
    # O(d) time, O(1) space — d = lookback days
    for back in range(BASEMAP_LOOKBACK_DAYS):
        url = BASEMAP_BUILD_URL.format(date=(today - timedelta(days=back)).strftime("%Y%m%d"))
        if httpx.head(url, timeout=20, follow_redirects=True).status_code == 200:
            return url
    raise RuntimeError(f"no Protomaps build in the last {BASEMAP_LOOKBACK_DAYS} days")


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """O(a) time, O(a) space — a = CLI arguments."""
    parser = argparse.ArgumentParser(description="Build one city's static-mode map data.")
    parser.add_argument("--city", required=True, help="city slug, e.g. detroit")
    parser.add_argument("--layers", default="", help="comma-separated layer ids (default all)")
    parser.add_argument(
        "--basemap", choices=("city", "skip"), default="city",
        help="city = clip a basemap to the city bounds; skip = leave the basemap alone",
    )
    parser.add_argument("--basemap-source", default="", help="planet URL (default: newest build)")
    parser.add_argument("--out", default="", help="output dir (default public/data/<city>)")
    return parser.parse_args(argv)


def main(argv: list[str] | None = None) -> int:
    """O(1) time, O(1) space — s = 3 stages (wiring only, the work is in static_build)."""
    args = parse_args(argv)
    slug = args.city.strip().lower()
    if slug == "chicago":
        # Chicago's assets are hand-built and in daily use; this tool must never touch them.
        print("refusing: Chicago's static files are not managed by this script", file=sys.stderr)
        return 2
    config = yaml.safe_load((CONFIG_DIR / f"{slug}.yaml").read_text())
    plan = importlib.import_module(f"app.data_import.{slug}.static_plan").STATIC_PLAN
    out_dir = Path(args.out) if args.out else PUBLIC_DATA / slug
    # O(k) time, O(k) space — k = requested layer ids
    only = {x.strip() for x in args.layers.split(",") if x.strip()} or None

    counts = static_build.build_city(plan, config.get("sources", {}), out_dir, only)
    # O(L log L) time, O(L) space — L = tile layers built (sorted for a stable report)
    for name, count in sorted(counts.items()):
        print(f"  {name:<22} {count:>9,} features")

    if args.basemap == "city":
        (west, south), (east, north) = config["city"]["bounds"]
        static_build.extract_basemap(
            (west, south, east, north), out_dir / "basemap.pmtiles",
            args.basemap_source or latest_basemap_source(),
        )
        print(f"  basemap → {out_dir / 'basemap.pmtiles'}")
    return 0


if __name__ == "__main__":
    raise SystemExit(main())
