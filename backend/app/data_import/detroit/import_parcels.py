"""Detroit parcel owners from the Office of the Assessor (parcel_file_current).

PURPOSE
    Owner of record for every Detroit parcel, so each building can carry `owner_name` in
    its tile properties (joined on the parcel id — static_plan.enrich_detroit). Static
    mode never ships parcel polygons (378K polygons would blow the size budget), so this
    importer downloads ATTRIBUTES ONLY: parcel_id + taxpayer_1. Rows have no geom_json,
    which also means static_build writes no tiles for them.

FLOW
    download() → page the layer with returnGeometry=false (1,000 rows/page, ~378 pages)
    transform() → [{"parcel_pin", "owner_name"}] keyed for the join

TRAPS (live 2026-10-02)
    - The PIN field is `parcel_id` ("10000924."), not `parcel_number` (old guess). SEMCOG
      footprints carry the same string in `apn`, which is what makes the join possible.
      Some ids end with "." and some with "-N"; both sides use the Assessor's spelling,
      so ids are compared verbatim after strip().
    - Server caps pages at 1,000 regardless of resultRecordCount; paging follows
      exceededTransferLimit and advances by rows received (the arcgis_helper lesson).
    - Owner names are "LAST , FIRST" for people; the contact list shows them as given.

STATUS — attribute download implemented; the PostGIS polygon load is still Phase 2 work
    and raises.
"""

from __future__ import annotations

import json
from pathlib import Path

import httpx

from app.data_import.base_importer import HTTP_HEADERS, BaseImporter
from app.data_import.detroit.field_maps import DETROIT_PARCELS, pick

# ADJUSTABLE: rows asked per request. The server returns at most 1,000 (maxRecordCount).
PAGE_SIZE = 1000


class DetroitParcelsImporter(BaseImporter):
    layer_name = "parcel_owners"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = parcels (~378K), fetched n/1000 pages."""
        path = self._cache_path(".json")
        if path.exists():
            return path
        url = self._config.get("url", "")
        if not url:
            raise ValueError("No parcels URL configured")
        out_fields = ",".join(
            DETROIT_PARCELS.fields["pin"] + DETROIT_PARCELS.fields["owner_name"]
        )
        rows: list[dict] = []
        offset = 0
        with httpx.Client(timeout=120.0, follow_redirects=True, headers=HTTP_HEADERS) as client:
            # O(n) time, O(n) space — n = parcels, one page of ≤ 1,000 per request
            while True:
                resp = client.get(url, params={
                    "where": "1=1", "outFields": out_fields, "returnGeometry": "false",
                    "orderByFields": "ObjectId", "resultOffset": str(offset),
                    "resultRecordCount": str(PAGE_SIZE), "f": "json",
                })
                resp.raise_for_status()
                data = resp.json()
                if "error" in data:
                    raise RuntimeError(f"ArcGIS error: {data['error']}")
                features = data.get("features", [])
                # bigo-lint: disable=BIGO006 — amortised: each row is appended once overall (n)
                # O(p) time, O(p) space — p = rows on this page
                rows.extend(f.get("attributes", {}) for f in features)
                if not features or not data.get("exceededTransferLimit"):
                    break
                offset += len(features)
                if offset % 50000 < PAGE_SIZE:
                    self._log.info("parcel_owner_pages", rows=offset)
        path.write_text(json.dumps(rows))
        self._log.info("downloaded", rows=len(rows))
        return path

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = parcel attribute rows. No geometry by design."""
        records: list[dict] = []
        # O(n) time, O(n) space — n = rows
        for props in json.loads(raw_path.read_text()):
            pin = pick(props, DETROIT_PARCELS, "pin")
            owner = pick(props, DETROIT_PARCELS, "owner_name")
            if pin and owner:
                records.append({"parcel_pin": pin, "owner_name": owner})
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        """O(1) time, O(1) space — r = 0 rows written. Polygon load is Phase 2 work."""
        raise NotImplementedError("parcels: database load not wired yet (static only)")
