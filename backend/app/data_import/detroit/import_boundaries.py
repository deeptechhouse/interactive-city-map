"""Detroit admin boundaries → police_precincts, council_districts, zip_codes rows.

PURPOSE
    The three boundary sets the Focus panel offers (frontend cities/detroit/focus.ts) and
    the matching map layers. Each is a small ArcGIS polygon layer, so they share one base
    class; each subclass only names its config and maps its fields.

ARCHITECTURE
    _BoundaryImporter (download = cached ArcGIS pull; load = static-only for now)
      ├─ DetroitPolicePrecinctsImporter   DPD_Precincts_Reid2 (12)
      ├─ DetroitCouncilDistrictsImporter  city_council_districts_2026 (7)
      └─ DetroitZipCodesImporter          Census TIGERweb ZCTAs ∩ city limits
    detroit_city_limits() — union of the 7 council districts = the city outline. There is
      no city-limits layer on the Detroit hub (searched 2026-10-02), but council districts
      tile the whole city by law, so their union is exact.

TRAPS (live 2026-10-02)
    - City_of_Detroit_Zip_Code_List is a non-spatial TABLE (fields ZIP_CODE, ObjectId) —
      39 mailing ZIPs including suburbs' 48220/48236/48237. Polygons come from TIGERweb.
    - TIGER's ZCTA query must say inSR=4326 & outSR=4326, else the envelope and output use
      the service's Web Mercator. The bbox returns 72 ZCTAs; most are suburbs, hence
      the overlap filter below.
    - DPD precinct `name` is zero-padded text ("09"); stored as "9" so the focus option
      sorts and labels cleanly ("Precinct 9").
    - Council layer has no council-member field. council_member is left null — UNPROVEN
      source for names (detroitmi.gov page, not an API).
    - Use the 2026 council map (effective 2026-01-01), not the 2014 one.
"""

from __future__ import annotations

import json
from pathlib import Path

from shapely.geometry import shape
from shapely.ops import unary_union

from app.data_import.base_importer import BaseImporter
from app.data_import.detroit.common import (
    as_multipolygon_json, cached_arcgis_download, int_text, read_features, stable_id,
)
from app.data_import.detroit.field_maps import (
    COUNCIL_DISTRICTS, DPD_PRECINCTS, TIGER_ZCTA, pick,
)

# ADJUSTABLE: a ZCTA is kept when at least this share of its land lies inside the city.
# 0.01 keeps edge ZIPs that are partly Detroit (48212 Hamtramck, 48239 Redford) and drops
# ZCTAs that only touch the boundary along a shared street. Raise toward 0.5 to keep only
# mostly-Detroit ZIPs; 0 keeps everything that merely touches.
ZCTA_MIN_OVERLAP_SHARE = 0.01

# Fallback when detroit.yaml has no zip_codes.polygon_url.
_TIGER_ZCTA_URL = (
    "https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/tigerWMS_ACS2023/"
    "MapServer/2/query"
)


class _BoundaryImporter(BaseImporter):
    """Shared download for the small ArcGIS boundary layers; subclasses map fields."""

    def download(self) -> Path:
        """O(n) time, O(n) space — n = boundary polygons (≤ ~80)."""
        return cached_arcgis_download(
            self,
            url=self._config.get("url", ""),
            page_size=int(self._config.get("page_size", 1000)),
        )

    def load(self, records: list[dict]) -> int:
        """O(1) time, O(1) space — r = 0 rows written.

        Static-mode only for now: the PostGIS tables for these layers arrive with the
        Phase 2 migrations (docs/detroit_parity). Fail loudly rather than pretend.
        """
        raise NotImplementedError(f"{self.layer_name}: database load not wired yet (static only)")


class DetroitPolicePrecinctsImporter(_BoundaryImporter):
    layer_name = "police_precincts"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices; n = precincts (12)."""
        records: list[dict] = []
        # O(v) time, O(n) space — v = vertices; n = features
        for feat in read_features(raw_path):
            props = feat.get("properties") or {}
            precinct = int_text(pick(props, DPD_PRECINCTS, "precinct"))
            geom_json = as_multipolygon_json(feat.get("geometry"))
            if not precinct or not geom_json:
                continue
            records.append({
                "id": stable_id("det-precinct", precinct),
                "city_id": self._city_id,
                "precinct": precinct,
                "name": f"Precinct {precinct}",
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records


class DetroitCouncilDistrictsImporter(_BoundaryImporter):
    layer_name = "council_districts"

    def transform(self, raw_path: Path) -> list[dict]:
        """O(v) time, O(n) space — v = vertices; n = districts (7)."""
        records: list[dict] = []
        # O(v) time, O(n) space — v = vertices; n = features
        for feat in read_features(raw_path):
            props = feat.get("properties") or {}
            number = int_text(pick(props, COUNCIL_DISTRICTS, "district_number"))
            geom_json = as_multipolygon_json(feat.get("geometry"))
            if not number or not geom_json:
                continue
            records.append({
                "id": stable_id("det-council", number),
                "city_id": self._city_id,
                "district_number": number,
                "name": pick(props, COUNCIL_DISTRICTS, "district_name") or f"District {number}",
                "council_member": None,  # not on the layer — see module TRAPS
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records


def detroit_city_limits(council_rows: list[dict]):
    """O(v log v) time, O(v) space — v = vertices of the 7 district polygons (union).

    City outline as one shapely geometry = union of the council districts.
    """
    # O(n) time, O(v) space — n = district rows; v = their vertices
    return unary_union([shape(json.loads(r["geom_json"])) for r in council_rows])


class DetroitZipCodesImporter(_BoundaryImporter):
    """ZCTAs from TIGERweb, kept only where they overlap the city (see module TRAPS).

    Config is TWO yaml blocks, {"zip_codes": {...}, "council_districts": {...}} — the
    static plan passes config_keys=("zip_codes", "council_districts").
    """

    layer_name = "zip_codes"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = ZCTAs in the bbox (72) + 7 council districts."""
        zip_cfg = self._config.get("zip_codes", {})
        (west, south), (east, north) = zip_cfg.get("bbox", [[-83.30, 42.20], [-82.90, 42.50]])
        # The envelope rides in the URL; ArcGISFeatureServerClient adds where/outFields/f.
        base = zip_cfg.get("polygon_url") or _TIGER_ZCTA_URL
        url = (
            f"{base}?geometry={west},{south},{east},{north}"
            "&geometryType=esriGeometryEnvelope&inSR=4326&spatialRel=esriSpatialRelIntersects"
        )
        path = cached_arcgis_download(self, url=url, out_fields="ZCTA5")
        # The city outline needs the council districts, cached under their own name.
        self._council_importer().download()
        return path

    def _council_importer(self) -> DetroitCouncilDistrictsImporter:
        """O(1) time, O(1) space — n = 1 importer built from the nested config."""
        return DetroitCouncilDistrictsImporter(
            self._db_url, self._city_id, self._config.get("council_districts", {})
        )

    # bigo-allow: z ≤ 72 ZCTAs in the bbox, each intersected with one city outline
    def transform(self, raw_path: Path) -> list[dict]:
        """O(z · c) time, O(v) space — z = ZCTAs (72); c = city-outline vertices; v = vertices.

        Keep a ZCTA when ≥ ZCTA_MIN_OVERLAP_SHARE of it lies inside the city.
        """
        council = self._council_importer()
        limits = detroit_city_limits(council.transform(council.download()))
        records: list[dict] = []
        # bigo-allow: z ≤ 72 ZCTAs in the bbox; each intersection is against one outline
        # O(z · c) time, O(v) space — z = ZCTAs; c = city-outline vertices; v = vertices
        for feat in read_features(raw_path):
            props = feat.get("properties") or {}
            zip_code = pick(props, TIGER_ZCTA, "zip_code")
            geom_json = as_multipolygon_json(feat.get("geometry"))
            if not zip_code or not geom_json:
                continue
            geom = shape(json.loads(geom_json))
            if geom.area <= 0:
                continue
            share = geom.intersection(limits).area / geom.area
            if share < ZCTA_MIN_OVERLAP_SHARE:
                continue
            records.append({
                "id": stable_id("det-zip", zip_code),
                "city_id": self._city_id,
                "zip_code": zip_code,
                "share_in_city": round(share, 3),
                "geom_json": geom_json,
            })
        self._log.info("transformed", count=len(records))
        return records
