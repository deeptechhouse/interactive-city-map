"""Export one city's PostGIS layers to static-mode assets (PMTiles + bundled GeoJSON).

PURPOSE
    Static mode (./start_map.sh — the way the map is actually run day to day) reads only
    files under frontend/public/data/. Every file there today is Chicago, with generic
    names (buildings.pmtiles…), and generate_pmtiles.sh exports with no city filter.
    This script writes a per-city folder so Detroit can never overwrite Chicago:

        frontend/public/data/<slug>/basemap.pmtiles        (pmtiles extract of Protomaps)
        frontend/public/data/<slug>/<layer>.pmtiles        (tippecanoe, WHERE city_id = …)
        frontend/src/cities/<slug>/data/<layer>.ts         (small boundary/label layers)
        frontend/src/cities/<slug>/taxonomies.generated.ts (POI counts, transit colours)

    Chicago's existing un-prefixed files stay where they are. Moving Chicago into
    data/chicago/ is a separate, optional step (plan Phase 9) — not part of Detroit work.

FLOW
    main() → parse_args() → export_layers() → [ogr2ogr → tippecanoe] per tiled layer
                          → export_bundled() per small layer → extract_basemap()

TOOLS (all free / open source): ogr2ogr (GDAL, MIT), tippecanoe (BSD-2),
    pmtiles CLI (BSD-3). Check they are installed before the first run.

USAGE (after Phase 3): python3 scripts/export_city_static.py --city detroit

STATUS — SKELETON (2026-10-02).
"""

import argparse
from pathlib import Path

# ADJUSTABLE: per-layer tippecanoe zoom range. Raising max zoom on buildings above 16
# roughly doubles file size per level (Chicago buildings.pmtiles is already 142 MB).
TILED_LAYERS: dict[str, tuple[int, int]] = {
    "buildings": (12, 16),
    "parcels": (13, 16),
    "zoning_districts": (10, 15),
    "railroads": (8, 15),
    "parks": (8, 15),
    "transit_lines": (8, 15),
    "pois": (10, 16),
    "neighborhoods": (8, 14),
    "dlba_properties": (12, 16),
    "blight_violations": (12, 16),
    "railroad_row": (11, 16),
}

# Small layers bundled as GeoJSON TS modules (lazy-loaded per city).
BUNDLED_LAYERS: tuple[str, ...] = (
    "zip_codes",
    "police_precincts",
    "council_districts",
    "major_streets",
    "waterways",
    "transit_stations",
)


def parse_args(argv: list[str] | None = None) -> argparse.Namespace:
    """O(a) time, O(a) space — a = CLI arguments."""
    raise NotImplementedError("skeleton: parse_args")


def export_layers(city_slug: str, out_dir: Path) -> dict[str, Path]:
    """O(n log n) time, O(n) space — n = features across tiled layers (tippecanoe sorts).

    Returns layer → written .pmtiles path.
    """
    raise NotImplementedError("skeleton: export_layers")


def export_bundled(city_slug: str, src_dir: Path) -> dict[str, Path]:
    """O(n) time, O(n) space — n = features across bundled layers (coords rounded to 5 dp)."""
    raise NotImplementedError("skeleton: export_bundled")


def extract_basemap(bounds: tuple[float, float, float, float], out_path: Path) -> Path:
    """O(t) time, O(t) space — t = basemap tiles inside the bounds (pmtiles extract)."""
    raise NotImplementedError("skeleton: extract_basemap")


def main(argv: list[str] | None = None) -> int:
    """O(1) time, O(1) space — s = 3 export stages (wiring only)."""
    raise NotImplementedError("skeleton: main")


if __name__ == "__main__":
    raise SystemExit(main())
