"""ArcGIS FeatureServer client with pagination and coordinate reprojection.

Handles downloading all features from ArcGIS FeatureServer REST endpoints
that impose per-request record limits (typically 1000-2000). Supports
reprojecting coordinates from arbitrary EPSG codes to WGS84 (EPSG:4326).

Used by Detroit importers for data from data.detroitmi.gov (ArcGIS Hub)
and SEMCOG FeatureServer (EPSG:2898 Michigan South State Plane).
"""

import json
import time
from pathlib import Path

import httpx
import structlog
from pyproj import Transformer
from shapely.geometry import shape, mapping
from shapely.ops import transform

logger = structlog.get_logger(__name__)


class ArcGISFeatureServerClient:
    """Download all features from an ArcGIS FeatureServer with pagination.

    Parameters
    ----------
    base_url : str
        The FeatureServer layer query URL, e.g.:
        https://services2.arcgis.com/.../FeatureServer/0/query
    source_srid : int
        EPSG code of the source coordinate system. If not 4326, coordinates
        are reprojected to WGS84 automatically.
    page_size : int
        Number of records per request. ArcGIS servers typically cap at
        1000-2000; set this to match the server's maxRecordCount.
    timeout : float
        HTTP request timeout in seconds per page.
    """

    def __init__(
        self,
        base_url: str,
        source_srid: int = 4326,
        page_size: int = 2000,
        timeout: float = 120.0,
        output_format: str = "geojson",
    ):
        self._base_url = base_url.rstrip("/")
        self._source_srid = source_srid
        self._page_size = page_size
        self._timeout = timeout
        # Some ArcGIS Enterprise servers (e.g., SEMCOG) only support f=json,
        # not f=geojson. When output_format="json", we convert ArcGIS JSON
        # features to GeoJSON format ourselves.
        self._output_format = output_format
        self._log = logger.bind(source="arcgis", url=base_url[:80])

        # Set up reprojection transformer if needed
        # always_xy=True ensures (lon, lat) order for both input and output
        self._transformer = None
        if source_srid != 4326:
            self._transformer = Transformer.from_crs(
                f"EPSG:{source_srid}", "EPSG:4326", always_xy=True
            )

    def download_all(self) -> dict:
        """Download all features with pagination, returning a GeoJSON FeatureCollection.

        Returns
        -------
        dict
            A GeoJSON FeatureCollection with all features reprojected to EPSG:4326.
        """
        all_features: list[dict] = []
        offset = 0
        total_downloaded = 0

        with httpx.Client(timeout=self._timeout, follow_redirects=True) as client:
            while True:
                # Build the paginated query URL
                params = {
                    "where": "1=1",
                    "outFields": "*",
                    "f": self._output_format,
                    "resultRecordCount": str(self._page_size),
                    "resultOffset": str(offset),
                }
                # If source SRID is not 4326, request in native projection
                # and reproject ourselves (more accurate than server-side)
                if self._source_srid != 4326:
                    params["outSR"] = str(self._source_srid)

                self._log.info("page_request", offset=offset)
                resp = client.get(self._base_url, params=params)
                resp.raise_for_status()
                data = resp.json()

                # Handle ArcGIS error responses embedded in JSON
                if "error" in data:
                    error = data["error"]
                    raise RuntimeError(
                        f"ArcGIS error {error.get('code')}: {error.get('message')}"
                    )

                features = data.get("features", [])
                if not features:
                    break

                # Convert ArcGIS JSON to GeoJSON if needed
                if self._output_format == "json":
                    features = [self._arcgis_to_geojson(f) for f in features]

                # Reproject geometries if needed
                if self._transformer:
                    features = [self._reproject_feature(f) for f in features]

                all_features.extend(features)
                total_downloaded += len(features)
                self._log.info(
                    "page_downloaded",
                    offset=offset,
                    page_count=len(features),
                    total=total_downloaded,
                )

                # If we got fewer than page_size, we've reached the end
                if len(features) < self._page_size:
                    break

                offset += self._page_size

                # Brief pause to be polite to the server
                time.sleep(0.5)

        self._log.info("download_complete", total_features=total_downloaded)
        return {"type": "FeatureCollection", "features": all_features}

    def _arcgis_to_geojson(self, feature: dict) -> dict:
        """Convert an ArcGIS JSON feature to GeoJSON format.

        ArcGIS JSON uses {"rings": [...]} for polygons and {"x": ..., "y": ...}
        for points, while GeoJSON uses {"type": "Polygon", "coordinates": [...]}.
        """
        geom = feature.get("geometry", {})
        props = feature.get("attributes", {})
        geojson_geom = None

        if "rings" in geom:
            rings = geom["rings"]
            if len(rings) == 1:
                geojson_geom = {"type": "Polygon", "coordinates": rings}
            else:
                geojson_geom = {"type": "Polygon", "coordinates": rings}
        elif "paths" in geom:
            paths = geom["paths"]
            if len(paths) == 1:
                geojson_geom = {"type": "LineString", "coordinates": paths[0]}
            else:
                geojson_geom = {"type": "MultiLineString", "coordinates": paths}
        elif "x" in geom and "y" in geom:
            geojson_geom = {"type": "Point", "coordinates": [geom["x"], geom["y"]]}
        elif "points" in geom:
            geojson_geom = {"type": "MultiPoint", "coordinates": geom["points"]}

        return {
            "type": "Feature",
            "properties": props,
            "geometry": geojson_geom,
        }

    def _reproject_feature(self, feature: dict) -> dict:
        """Reproject a single GeoJSON feature's geometry to EPSG:4326."""
        geom_json = feature.get("geometry")
        if not geom_json or not self._transformer:
            return feature

        try:
            geom = shape(geom_json)
            # transform() applies the reprojection function to all coordinates
            reprojected = transform(self._transformer.transform, geom)
            feature = dict(feature)  # shallow copy to avoid mutating input
            feature["geometry"] = mapping(reprojected)
        except Exception as exc:
            self._log.warning("reproject_failed", error=str(exc))

        return feature

    def get_record_count(self) -> int:
        """Query the server for the total number of records (optional pre-check).

        Returns
        -------
        int
            Total number of features, or -1 if the query fails.
        """
        params = {
            "where": "1=1",
            "returnCountOnly": "true",
            "f": "json",
        }
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.get(self._base_url, params=params)
                resp.raise_for_status()
                data = resp.json()
                return data.get("count", -1)
        except Exception as exc:
            self._log.warning("count_query_failed", error=str(exc))
            return -1

    def get_server_info(self) -> dict:
        """Fetch FeatureServer layer metadata (maxRecordCount, fields, SRID, etc.).

        Returns
        -------
        dict
            The raw JSON response from the layer's metadata endpoint.
        """
        # Strip '/query' from the end to get the layer info URL
        info_url = self._base_url
        if info_url.endswith("/query"):
            info_url = info_url[:-6]

        params = {"f": "json"}
        try:
            with httpx.Client(timeout=30.0, follow_redirects=True) as client:
                resp = client.get(info_url, params=params)
                resp.raise_for_status()
                return resp.json()
        except Exception as exc:
            self._log.warning("server_info_failed", error=str(exc))
            return {}
