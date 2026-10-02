"""Montgomery County (OH) Auditor parcels → parcels table, and the building enrichment source.

PURPOSE
    City of Dayton MapLayers_Citywide/MapServer/9 joins the County's parcel polygons to the
    Auditor's CAMA table: PIN, site address, owner, owner/mailing address, appraisal, last
    sale, land use, year built, stories. Building footprints (307) have none of that, so
    enrich.join_parcels copies it onto each building whose centroid falls in a parcel.

    Static builds use this importer ONLY as an enrichment source. There is no
    parcels.pmtiles: 273K polygons would blow the ~120 MB city budget and the building
    tiles already carry the useful fields.

TRAPS
    - WRONG COUNTY (found 2026-10-02): the services6.arcgis.com "Montgomery_County_Parcels"
      FeatureServer is Montgomery County, New York. Never point this importer at it.
    - Spatial queries on layer 9 fail ("Unable to complete operation", 2026-10-02), so the
      whole county is paged (274 requests × ~1.5 s ≈ 7–9 min, ~180 MB cached JSON) and
      clipped here to the profile bbox.
    - Field names are qualified ("GISADMIN.WEB_CAMA.OWNER_NAME"); see field_maps.py.
    - Zero means unknown: DWEL_YRBLT is 0 on commercial parcels and COMM_YRBLT is 0 on homes.
    - Uniqueness: parcels has UNIQUE (city_id, pin). Rows are de-duplicated by PIN here
      (first wins) so a re-run never violates it.

STATUS — implemented 2026-10-02. load() is UNPROVEN (no database in this session).
"""

import json
import re
from pathlib import Path

from shapely.geometry import MultiPolygon, mapping, shape

from app.data_import.base_importer import BaseImporter
from app.data_import.dayton._sources import DAYTON_BBOX, fetch_arcgis, read_features, replace_rows
from app.data_import.dayton.field_maps import MONTGOMERY_PARCELS
from app.data_import.field_map import pick

# "DAYTON, OH  45402" (owner block) or "DAYTON OH 45402" (mailing block).
_CITY_LINE = re.compile(
    r"^\s*(?P<city>.*?)[,\s]+(?P<state>[A-Z]{2})\s+(?P<zip>\d{5})(?:-?\d{4})?\s*$"
)


def split_city_line(line: str | None) -> dict[str, str]:
    """O(n) time, O(n) space — n = line length (one regex match).

    "DAYTON, OH  45402" → {"city": "DAYTON", "state": "OH", "zip": "45402"}. A line that
    doesn't parse (foreign address, blank) → the whole text as city, so nothing is lost.
    """
    text = (line or "").strip()
    match = _CITY_LINE.match(text)
    if not match:
        return {"city": text, "state": "", "zip": ""}
    # O(1) time, O(1) space — k = 3 fixed keys
    return {k: match.group(k).strip() for k in ("city", "state", "zip")}


def _year(*values) -> int | None:
    """O(k) time, O(1) space — k = candidate values (2). First plausible year wins."""
    # O(k) time, O(1) space — k = candidates
    for value in values:
        try:
            year = int(float(value))
        except (TypeError, ValueError):
            continue
        if 1780 <= year <= 2100:  # Dayton was founded 1796; 0 = "not this kind of building"
            return year
    return None


def _count(*values) -> int | None:
    """O(k) time, O(1) space — k = candidate values (2). First positive count wins."""
    # O(k) time, O(1) space — k = candidates
    for value in values:
        try:
            number = int(float(value))
        except (TypeError, ValueError):
            continue
        if number > 0:
            return number
    return None


def _money(value: str | None) -> int | None:
    """O(n) time, O(n) space — n = digits. "33,470" → 33470; blank/0 → None."""
    digits = re.sub(r"[^\d]", "", value or "")
    return int(digits) if digits and int(digits) > 0 else None


def _in_bbox(geom) -> bool:
    """O(v) time, O(1) space — v = vertices (shapely computes the bounds once)."""
    west, south, east, north = DAYTON_BBOX
    point = geom.representative_point()
    return west <= point.x <= east and south <= point.y <= north


def parcel_row(props: dict, geom, city_id: str) -> dict | None:
    """O(v) time, O(v) space — v = vertices of this parcel. None when there is no PIN."""
    pin = pick(props, MONTGOMERY_PARCELS, "pin")
    if not pin:
        return None
    owner_city = split_city_line(pick(props, MONTGOMERY_PARCELS, "owner_city_line"))
    mail_city = split_city_line(pick(props, MONTGOMERY_PARCELS, "mailing_city_line"))
    return {
        "city_id": city_id,
        "pin": pin,
        "address": pick(props, MONTGOMERY_PARCELS, "address"),
        "zip": pick(props, MONTGOMERY_PARCELS, "zip"),
        "owner_name": pick(props, MONTGOMERY_PARCELS, "owner_name"),
        "assessed_value": _money(pick(props, MONTGOMERY_PARCELS, "appraised_value")),
        "property_class": pick(props, MONTGOMERY_PARCELS, "property_class"),
        "land_use": pick(props, MONTGOMERY_PARCELS, "land_use"),
        "year_built": _year(
            pick(props, MONTGOMERY_PARCELS, "dwelling_year"),
            pick(props, MONTGOMERY_PARCELS, "commercial_year"),
        ),
        "floors": _count(
            pick(props, MONTGOMERY_PARCELS, "dwelling_stories"),
            pick(props, MONTGOMERY_PARCELS, "commercial_stories"),
        ),
        # Clean keys only — never the DBF names (owner_ad_2, mailing__3).
        "metadata": {
            "owner_address": {
                "street": pick(props, MONTGOMERY_PARCELS, "owner_street") or "",
                **owner_city,
            },
            "mailing_address": {
                "street": pick(props, MONTGOMERY_PARCELS, "mailing_street") or "",
                **mail_city,
            },
            "sale_date": pick(props, MONTGOMERY_PARCELS, "sale_date"),
            "sale_price": _money(pick(props, MONTGOMERY_PARCELS, "sale_price")),
        },
        "geom_json": json.dumps(
            mapping(geom if isinstance(geom, MultiPolygon) else MultiPolygon([geom]))
        ),
    }


class DaytonParcelsImporter(BaseImporter):
    layer_name = "parcels"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = parcels county-wide (~274K, 1000 per request)."""
        url = self._config.get("url") or MONTGOMERY_PARCELS.source
        # O(f) time, O(f) space — f = mapped columns × candidates (fixed, ~30)
        fields = sorted({name for names in MONTGOMERY_PARCELS.fields.values() for name in names})
        return fetch_arcgis(self, url, out_fields=",".join(fields))

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = parcels county-wide (the bbox clip keeps most of them)."""
        records: list[dict] = []
        seen: set[str] = set()
        # O(n) time, O(n) space — n = features
        for feat in read_features(raw_path):
            geom_json = feat.get("geometry")
            if not geom_json:
                continue
            try:
                geom = shape(geom_json)
            except Exception:  # noqa: BLE001 — malformed upstream geometry is skipped
                continue
            if (
                geom.is_empty
                or geom.geom_type not in ("Polygon", "MultiPolygon")
                or not _in_bbox(geom)
            ):
                continue
            row = parcel_row(feat.get("properties") or {}, geom, self._city_id)
            if row is None or row["pin"] in seen:
                continue
            seen.add(row["pin"])
            records.append(row)
        self._log.info("transformed", count=len(records))
        return records

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records. Delete this city's parcels, then insert."""
        return replace_rows(
            self,
            "parcels",
            (
                "pin",
                "address",
                "owner_name",
                "assessed_value",
                "property_class",
                "land_use",
                "metadata",
            ),
            records,
        )
