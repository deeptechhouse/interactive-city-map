"""Shared plumbing for the Dayton importers: filtered ArcGIS downloads and DB inserts.

PURPOSE
    Every Dayton layer except parks, railroads, POIs and transit comes from an ArcGIS
    MapServer. They all need the same two things the shared client does not offer:
      - a bounding-box filter (the City's layers are county-wide: 338K footprints, of
        which 230K fall in the profile bbox), and
      - geometryPrecision=6 (≈ 0.1 m), which roughly halves the JSON payload. A
        polygon page of 1,000 parcels drops from ~1.3 MB to ~0.65 MB.
    DaytonArcGISClient adds both by overriding one method of the shared client, which is
    therefore left untouched.

FLOW
    importer.download() → fetch_arcgis(importer, url, …)
        → cache hit? return path
        → DaytonArcGISClient.download_all()  (shared paging: resultOffset, then object ids)
        → importer._save_json_cache(collection)

    importer.load() → replace_rows(importer, table, columns, rows)   (PostGIS path only)

TRAP: the object-id fallback in the shared client fetches ids with `where` only, so the
    envelope would be lost there. Every Dayton layer advertises supportsPagination=true
    (checked 2026-10-02), so the offset path is the one used. If a layer ever falls back,
    the importer's own bbox clip in transform() still keeps the output correct. Only the
    download would get bigger.
"""

from __future__ import annotations

import json
from pathlib import Path

from app.data_import.arcgis_helper import ArcGISFeatureServerClient
from app.data_import.base_importer import BaseImporter

# Profile bounds (west, south, east, north). Same numbers as dayton.yaml city.bounds and
# frontend DAYTON_PROFILE.bounds. Keep the three in sync.
# ADJUSTABLE: widening it grows every static file (buildings most of all).
DAYTON_BBOX: tuple[float, float, float, float] = (-84.35, 39.65, -84.05, 39.85)

# Tighter box around the City of Dayton limit (~[-84.31,39.69]–[-84.09,39.83]). Used for
# layers that only make sense inside the city: arterial labels, ZCTAs.
DAYTON_CITY_BBOX: tuple[float, float, float, float] = (-84.31, 39.69, -84.09, 39.83)


class DaytonArcGISClient(ArcGISFeatureServerClient):
    """The shared paged client plus an optional envelope filter and coordinate rounding."""

    # O(1) time, O(1) space — n = 1 client (stores two extra query options)
    def __init__(
        self,
        base_url: str,
        *,
        envelope: tuple[float, float, float, float] | None = None,
        geometry_precision: int = 6,
        **kwargs,
    ):
        super().__init__(base_url, **kwargs)
        self._envelope = envelope
        # ADJUSTABLE: 6 decimals ≈ 0.11 m at 39.7°N. 5 (≈ 1 m) shrinks files further but
        # makes adjoining building walls visibly gap at z16.
        self._precision = geometry_precision

    def _base_params(self) -> dict[str, str]:
        """O(1) time, O(1) space — k = fixed query parameters."""
        params = super()._base_params()
        params["geometryPrecision"] = str(self._precision)
        if self._envelope:
            west, south, east, north = self._envelope
            params.update(
                {
                    "geometry": f"{west},{south},{east},{north}",
                    "geometryType": "esriGeometryEnvelope",
                    "inSR": "4326",
                    "spatialRel": "esriSpatialRelIntersects",
                }
            )
        return params


def layer_query_url(layer_url: str) -> str:
    """O(1) time, O(1) space — u = URL length (constant work per call)."""
    base = layer_url.rstrip("/")
    return base if base.endswith("/query") else f"{base}/query"


def fetch_arcgis(
    importer: BaseImporter,
    layer_url: str,
    *,
    where: str = "1=1",
    out_fields: str = "*",
    envelope: tuple[float, float, float, float] | None = None,
    page_size: int = 1000,
    suffix: str = ".geojson",
) -> Path:
    """O(n) time, O(n) space — n = features matching the filter.

    Download (or reuse the cached copy of) one ArcGIS layer as GeoJSON in EPSG:4326.
    page_size defaults to 1000 because every City of Dayton MapServer caps there.
    """
    cached = importer._cache_path(suffix)
    if cached.exists():
        return cached
    client = DaytonArcGISClient(
        layer_query_url(layer_url),
        envelope=envelope,
        page_size=page_size,
        where=where,
        out_fields=out_fields,
        # 3735 = Ohio South (ft). Without pyproj the shared client asks for outSR=4326.
        source_srid=3735,
    )
    return importer._save_json_cache(client.download_all(), suffix=suffix)


def read_features(raw_path: Path) -> list[dict]:
    """O(n) time, O(n) space — n = features in the cached file."""
    raw = json.loads(Path(raw_path).read_text())
    return raw.get("features", []) if isinstance(raw, dict) else []


def replace_rows(
    importer: BaseImporter, table: str, columns: tuple[str, ...], rows: list[dict]
) -> int:
    """O(n) time, O(n) space — n = rows (parameter tuples are built up front).

    PostGIS path only (static builds never call load()). Deletes this city's rows, then
    inserts. `geom_json` is always the last value, so callers pass plain column names.
    UNPROVEN: not run against a database in this session (static build only).
    """
    if not rows:
        return 0
    importer._truncate_table(table)
    placeholders = ", ".join(["%s"] * len(columns))
    sql = (
        f"INSERT INTO {table} (city_id, {', '.join(columns)}, geom) "
        f"VALUES (%s, {placeholders}, ST_SetSRID(ST_GeomFromGeoJSON(%s), 4326))"
    )
    # O(n) time, O(n) space — n = rows (columns per row are a fixed tuple, ≤ 12)
    params = [_row_params(importer._city_id, columns, r) for r in rows]
    conn = importer._get_connection()
    try:
        cur = conn.cursor()
        cur.executemany(sql, params)
        conn.commit()
        cur.close()
    finally:
        conn.close()
    return len(params)


def _row_params(city_id: str, columns: tuple[str, ...], row: dict) -> tuple:
    """O(1) time, O(1) space — c = columns, a fixed tuple of ≤ 12 names."""
    # O(1) time, O(1) space — c = columns (fixed ≤ 12)
    values = tuple(_db_value(row.get(c)) for c in columns)
    return (city_id, *values, row["geom_json"])


def _db_value(value):
    """O(v) time, O(v) space — v = size of a dict value serialised to JSON (scalars: constant)."""
    return json.dumps(value) if isinstance(value, dict) else value
