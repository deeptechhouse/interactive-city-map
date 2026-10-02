"""Build a city's static-mode map data straight from its importers — no database needed.

PURPOSE
    Static mode (./start_map.sh) reads only files under frontend/public/data/. For a new
    city those files are made here: each importer's download() + transform() — the same
    code the PostGIS pipeline uses — produce rows, the rows become GeoJSON features, and
    tippecanoe packs them into one PMTiles archive per map layer:

        frontend/public/data/<slug>/<layer_id>.pmtiles   (tile layer names = table names)

    Tile-layer names match the PostGIS table names Martin serves in dev mode, so every
    frontend layer reads the same `source-layer` in both modes.

    WHY NOT POSTGIS → EXPORT (the original TDD §9 design)? That path needs Docker, GDAL
    and a database that may also hold Chicago's rows. Building from transform() output
    gives identical features with nothing to run, and never touches Chicago data. The
    PostGIS export can be added later behind the same StaticPlan.

FLOW
    build_city(plan, sources, out_dir)
      → for each TileLayer: importer.download() → transform() → layer.select(rows)
      → plan.enrich(rows_by_tile_layer)          (spatial joins, e.g. buildings ← zoning)
      → write NDJSON per tile layer → tippecanoe → <out_dir>/<layer_id>.pmtiles

ARCHITECTURE
    TileLayer / StaticLayer / StaticPlan — data describing a city (lives in <city>/static_plan.py)
    rows_to_features()                   — pure, unit-tested
    tag_by_containment()                 — pure spatial join (shapely STRtree)
    build_city()                         — orchestration + subprocess (tippecanoe)

TO ADD A CITY: write app/data_import/<slug>/static_plan.py exporting STATIC_PLAN, then
    `python -m scripts.export_city_static --city <slug>` (see that script).
"""

from __future__ import annotations

import json
import shutil
import subprocess
import tempfile
from collections.abc import Callable, Iterable
from dataclasses import dataclass, field
from pathlib import Path

import structlog
from shapely import STRtree
from shapely.geometry import shape

from app.data_import.base_importer import BaseImporter

logger = structlog.get_logger(__name__)

# Row keys that are database plumbing, never map properties.
_DROP_KEYS = frozenset({"id", "city_id", "geom_json", "geom", "metadata"})


def _identity(rows: list[dict]) -> list[dict]:
    """O(1) time, O(1) space — n = rows passed through unchanged."""
    return rows


@dataclass(frozen=True)
class TileLayer:
    """One tile layer inside a PMTiles archive (= one PostGIS table in dev mode)."""

    name: str  # source-layer name the frontend reads, e.g. "buildings"
    importer: type[BaseImporter]
    # City-yaml `sources` keys this importer reads. One key → that dict is the config;
    # several (transit) → {key: sources[key]}, matching run.py's _get_importer_config.
    config_keys: tuple[str, ...]
    select: Callable[[list[dict]], list[dict]] = _identity  # pick rows out of transform()
    keep: tuple[str, ...] | None = None  # properties to keep (None = all non-plumbing keys)
    minzoom: int = 0
    maxzoom: int = 14


@dataclass(frozen=True)
class StaticLayer:
    """One frontend layer id → one PMTiles file holding one or more tile layers."""

    layer_id: str  # frontend layer id, e.g. "transit" → transit.pmtiles
    tile_layers: tuple[TileLayer, ...]
    # Extra tippecanoe flags, e.g. ("--drop-densest-as-needed",) for dense polygons.
    tippecanoe_args: tuple[str, ...] = ()
    # Also write <layer_id>.geojson (all tile layers' features) for code that needs real
    # polygons, not tiles — the Focus-areas panel unions/intersects boundary polygons.
    # Only for small layers (boundaries): the file is fetched whole by the browser.
    geojson_copy: bool = False


@dataclass(frozen=True)
class StaticPlan:
    slug: str
    layers: tuple[StaticLayer, ...]
    # Mutates rows in place after every layer is transformed (spatial joins). Keyed by
    # TileLayer.name. Layers not built in this run are absent from the dict.
    enrich: Callable[[dict[str, list[dict]]], None] | None = None
    notes: tuple[str, ...] = field(default_factory=tuple)


def importer_config(sources: dict, keys: tuple[str, ...]) -> dict:
    """O(k) time, O(k) space — k = config keys (1, or 2 for transit)."""
    if len(keys) == 1:
        return sources.get(keys[0], {}) or {}
    # O(k) time, O(k) space — k = keys
    return {k: sources.get(k, {}) or {} for k in keys}


def rows_to_features(rows: Iterable[dict], keep: tuple[str, ...] | None) -> Iterable[dict]:
    """O(S) time, O(p) space — S = property values across all rows (input size); p = per row.

    DB-ready rows (with "geom_json") → GeoJSON features. Lists/dicts become JSON strings,
    because vector tiles only carry scalar properties. Rows without geometry are skipped.
    """
    # O(S) time, O(p) space — S = property values across all rows; p = values in one row
    for row in rows:
        geom = row.get("geom_json")
        if not geom:
            continue
        props: dict = {}
        # bigo-lint: disable=BIGO006 — amortised: every value is visited once overall (S)
        # O(p) time, O(p) space — p = keys on this row
        for key, value in row.items():
            if key in _DROP_KEYS or value is None or (keep is not None and key not in keep):
                continue
            props[key] = json.dumps(value) if isinstance(value, (list, dict)) else value
        yield {
            "type": "Feature",
            "geometry": json.loads(geom) if isinstance(geom, str) else geom,
            "properties": props,
        }


def tag_by_containment(
    targets: list[dict],
    polygons: list[dict],
    copy: dict[str, str],
) -> int:
    """O((n + m) log m) time, O(m) space — n = target rows; m = polygon rows.

    For each target row, find the polygon containing its representative point and copy
    polygon fields onto it: copy = {target_key: polygon_key}. Used to give buildings their
    zoning code (Chicago did this with a hand-run SQL UPDATE). Returns rows tagged.
    The STRtree index makes each lookup O(log m) instead of a scan over every polygon.
    """
    if not targets or not polygons:
        return 0
    # O(m) time, O(m) space — m = polygons
    geoms = [shape(json.loads(p["geom_json"])) for p in polygons]
    tree = STRtree(geoms)
    tagged = 0
    # O(n log m) time, O(1) space — n = targets; m = polygons in the R-tree
    for row in targets:
        point = shape(json.loads(row["geom_json"])).representative_point()
        # bigo-lint: disable=BIGO006 — candidates per query are the few polygons whose
        # bounding boxes contain the point (zoning districts don't overlap), not m
        # O(c) time, O(1) space — c = candidate polygons for this point (small)
        for idx in tree.query(point, predicate="within"):
            src = polygons[int(idx)]
            # O(f) time, O(1) space — f = fields copied (1–3)
            for dst_key, src_key in copy.items():
                row[dst_key] = src.get(src_key)
            tagged += 1
            break
    return tagged


def _write_ndjson(features: Iterable[dict], path: Path) -> int:
    """O(n) time, O(1) space — n = features streamed to disk one line each."""
    count = 0
    with path.open("w") as fh:
        # O(n) time, O(1) space — n = features
        for feature in features:
            fh.write(json.dumps(feature, separators=(",", ":")))
            fh.write("\n")
            count += 1
    return count


def _write_feature_collection(ndjson_paths: list[Path], out_path: Path) -> None:
    """O(n) time, O(n) space — n = features across the NDJSON files (small layers only)."""
    features: list[dict] = []
    # O(n) time, O(n) space — n = features
    for path in ndjson_paths:
        with path.open() as fh:
            # bigo-lint: disable=BIGO006 — amortised: each line is read once overall (n)
            # O(f) time, O(f) space — f = lines in this file
            features.extend(json.loads(line) for line in fh if line.strip())
    out_path.write_text(json.dumps({"type": "FeatureCollection", "features": features}))


def run_tippecanoe(
    inputs: list[tuple[TileLayer, Path]], out_path: Path, extra: tuple[str, ...]
) -> None:
    """O(n log n) time, O(n) space — n = features (tippecanoe sorts by tile)."""
    if shutil.which("tippecanoe") is None:
        raise RuntimeError("tippecanoe not found — brew install tippecanoe")
    # O(l) time, O(1) space — l = tile layers in this archive (1–2)
    minzoom = min(t.minzoom for t, _ in inputs)
    # O(l) time, O(1) space — l = tile layers in this archive
    maxzoom = max(t.maxzoom for t, _ in inputs)
    cmd = [
        "tippecanoe", "-o", str(out_path), "--force", "--quiet",
        f"--minimum-zoom={minzoom}", f"--maximum-zoom={maxzoom}",
        "--no-tile-size-limit", "--read-parallel",
        *extra,
    ]
    # O(l) time, O(l) space — l = tile layers in this archive (1–2)
    for tile_layer, path in inputs:
        cmd.append(f"--named-layer={tile_layer.name}:{path}")
    subprocess.run(cmd, check=True)


def build_city(
    plan: StaticPlan,
    sources: dict,
    out_dir: Path,
    only: set[str] | None = None,
) -> dict[str, int]:
    """O(N log N) time, O(N) space — N = features across every built layer.

    Build the plan's layers (or just `only` layer ids). Returns tile-layer → feature count.
    A failed importer leaves that layer out (logged) instead of aborting the city, the same
    contract as BaseImporter.run().
    """
    out_dir.mkdir(parents=True, exist_ok=True)
    # O(L) time, O(L) space — L = layers in the plan
    chosen = [s for s in plan.layers if only is None or s.layer_id in only]
    rows: dict[str, list[dict]] = {}
    # O(N) time, O(N) space — N = rows across all layers (download/transform are linear)
    for static_layer in chosen:
        # bigo-lint: disable=BIGO006 — 1–2 tile layers per archive, fixed by the plan
        # O(t) time, O(R) space — t = tile layers in this archive; R = rows they return
        for tile_layer in static_layer.tile_layers:
            importer = tile_layer.importer(
                db_url="", city_id=plan.slug,
                config=importer_config(sources, tile_layer.config_keys),
            )
            log = logger.bind(city=plan.slug, layer=tile_layer.name)
            try:
                raw = importer.download()
                rows[tile_layer.name] = tile_layer.select(importer.transform(raw))
            except Exception:
                log.exception("static_layer_failed")
                continue
            log.info("static_layer_rows", rows=len(rows[tile_layer.name]))

    if plan.enrich:
        plan.enrich(rows)

    counts: dict[str, int] = {}
    with tempfile.TemporaryDirectory(prefix=f"static_{plan.slug}_") as tmp:
        # O(N log N) time, O(N) space — N = features (tippecanoe dominates)
        for static_layer in chosen:
            inputs: list[tuple[TileLayer, Path]] = []
            # bigo-lint: disable=BIGO006 — 1–2 tile layers per archive
            # O(t) time, O(1) space — t = tile layers in this archive
            for tile_layer in static_layer.tile_layers:
                if tile_layer.name not in rows:
                    continue
                path = Path(tmp) / f"{tile_layer.name}.ndjson"
                counts[tile_layer.name] = _write_ndjson(
                    rows_to_features(rows[tile_layer.name], tile_layer.keep), path
                )
                if counts[tile_layer.name]:
                    inputs.append((tile_layer, path))
            if static_layer.geojson_copy and inputs:
                # O(t) time, O(t) space — t = tile layers (1–2)
                _write_feature_collection(
                    [p for _, p in inputs], out_dir / f"{static_layer.layer_id}.geojson"
                )
            if inputs:
                run_tippecanoe(
                    inputs, out_dir / f"{static_layer.layer_id}.pmtiles",
                    static_layer.tippecanoe_args,
                )
    return counts


def extract_basemap(
    bounds: tuple[float, float, float, float], out_path: Path, source_url: str, maxzoom: int = 15
) -> None:
    """O(t) time, O(t) space — t = basemap tiles inside the bounds.

    `pmtiles extract` reads only the byte ranges it needs from a remote planet build, so
    a city basemap (~50–80 MB) downloads without fetching the ~120 GB planet.
    bounds = (west, south, east, north).
    """
    if shutil.which("pmtiles") is None:
        raise RuntimeError("pmtiles CLI not found — brew install pmtiles")
    w, s, e, n = bounds
    subprocess.run(
        ["pmtiles", "extract", source_url, str(out_path),
         f"--bbox={w},{s},{e},{n}", f"--maxzoom={maxzoom}"],
        check=True,
    )
