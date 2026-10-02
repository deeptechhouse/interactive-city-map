"""Detroit parity acceptance tests — skipped until each phase lands.

Each test names its plan phase. A phase is done only when its tests are un-skipped and
passing (docs/detroit_parity/detroit_parity_plan.html, acceptance gates).
"""

import pytest

pending = pytest.mark.skip(reason="Detroit parity skeleton — implement in the named phase")


@pending
def test_phase2_chicago_importer_plan_unchanged():
    """importers_for('chicago') == today's order, minus blight/dlba/neighborhoods."""


def test_blight_never_runs_for_chicago(monkeypatch):
    """Regression (fixed 2026-10-02): blight URLs were module constants, so a Chicago
    import downloaded ~874K Detroit tickets and stored them under Chicago's city_id."""
    from app.data_import import import_blight

    calls: list[str] = []

    class FakeClient:
        def __init__(self, url, **_kw):
            calls.append(url)

        def download_all(self):
            return {"features": []}

    monkeypatch.setattr(import_blight, "ArcGISFeatureServerClient", FakeClient)
    rows = import_blight.BlightImporter("postgresql://unused", "chicago-id", {}).run()
    assert rows == 0
    assert calls == []


def test_blight_reads_detroit_urls_from_config(monkeypatch, tmp_path):
    from app.data_import import import_blight

    calls: list[str] = []

    class FakeClient:
        def __init__(self, url, **_kw):
            calls.append(url)

        def download_all(self):
            return {"features": []}

    monkeypatch.setattr(import_blight, "ArcGISFeatureServerClient", FakeClient)
    cfg = {"tickets_url": "https://t.example/q", "demolitions_url": "https://d.example/q"}
    importer = import_blight.BlightImporter("postgresql://unused", "detroit-id", cfg)
    monkeypatch.setattr(importer, "_load_json_cache", lambda *a: None)
    monkeypatch.setattr(importer, "_save_json_cache", lambda *a: tmp_path / "x.geojson")
    importer.download()
    assert calls == ["https://t.example/q", "https://d.example/q"]


def _square(x0: float, y0: float, size: float, clockwise: bool) -> list[list[float]]:
    """O(1) time, O(1) space — v = 5 ring vertices. ArcGIS outer rings run clockwise."""
    ring = [[x0, y0], [x0 + size, y0], [x0 + size, y0 + size], [x0, y0 + size], [x0, y0]]
    return ring[::-1] if clockwise else ring


def test_phase2_semcog_multipart_buildings_split(tmp_path):
    """A 2-part SEMCOG feature becomes 2 building rows, not 1 polygon with a false hole;
    a real courtyard (counter-clockwise ring inside an outer ring) stays a hole."""
    import json

    from app.data_import.detroit.import_buildings import DetroitBuildingsImporter

    two_parts = {"type": "Polygon", "coordinates": [
        _square(0, 0, 1, clockwise=True), _square(5, 5, 1, clockwise=True)]}
    courtyard = {"type": "Polygon", "coordinates": [
        _square(10, 10, 4, clockwise=True), _square(11, 11, 1, clockwise=False)]}
    raw = tmp_path / "b.geojson"
    raw.write_text(json.dumps({"features": [
        {"geometry": two_parts, "properties": {"gid": 7, "address": "1 MAIN ST",
                                               "year_built": 0, "stories": 2, "apn": "01."}},
        {"geometry": courtyard, "properties": {"gid": 8, "address": "2 MAIN ST"}},
    ]}))
    rows = DetroitBuildingsImporter("", "detroit", {}).transform(raw)
    assert [r["id"] for r in rows] == ["det-bldg-7-0", "det-bldg-7-1", "det-bldg-8"]
    assert rows[0]["year_built"] is None  # SEMCOG 0 = unknown
    assert rows[0]["floors"] == 2 and rows[0]["parcel_pin"] == "01."
    assert all(r["is_hidden"] is False and r["has_interior"] is False for r in rows)
    assert len(json.loads(rows[2]["geom_json"])["coordinates"]) == 2  # outer + hole


# The 29 ZONING_REV codes on the live Zoning_1 layer (2026-10-02) and their classes.
_DETROIT_CODES = {
    **{f"R{i}": "residential" for i in range(1, 7)},
    **{f"B{i}": "commercial" for i in range(1, 7)},
    **{f"M{i}": "manufacturing" for i in range(1, 6)},
    "MKT": "manufacturing", "TM": "manufacturing", "W1": "waterfront", "PCA": "commercial",
    "PC": "special", "PD": "special", "PR": "special", "P1": "special", "SD5": "special",
    "SD1": "mixed", "SD2": "mixed", "SD4": "mixed",
}


def test_phase2_detroit_zoning_classes_match_frontend_keys():
    """Every zone_class the Detroit importer emits exists in DETROIT_ZONE_CLASSES."""
    import re
    from pathlib import Path

    from app.data_import.detroit.import_zoning import classify_detroit_zone

    zoning_ts = (Path(__file__).resolve().parents[2]
                 / "frontend/src/cities/detroit/zoning.ts").read_text()
    frontend_keys = set(re.findall(r"^    key: '([a-z]+)',", zoning_ts, flags=re.M))
    assert {"residential", "commercial", "manufacturing", "mixed", "special",
            "waterfront", "other"} <= frontend_keys
    # O(c) time, O(1) space — c = codes (29)
    for code, expected in _DETROIT_CODES.items():
        assert classify_detroit_zone(code) == expected, code
        assert expected in frontend_keys
    assert classify_detroit_zone("TM") != "transportation"  # the Chicago-prefix trap
    assert classify_detroit_zone("ZZ9") == "other"
    assert classify_detroit_zone(None) == "other"


def test_phase2_nhd_upper_case_fields_map_to_name(tmp_path):
    """GNIS_NAME → name; no Detroit waterway imports with a null name when NHD has one.
    NHD answered lower case on 2026-10-02, upper case before — both must work."""
    import json

    from app.data_import.detroit.import_area_overrides import DetroitWaterwaysImporter

    line = {"type": "LineString", "coordinates": [[-83.1, 42.3], [-83.0, 42.3]]}
    raw = tmp_path / "w.geojson"
    raw.write_text(json.dumps({"features": [
        {"geometry": line, "properties": {"GNIS_NAME": "Detroit River", "FTYPE": 460}},
        {"geometry": line, "properties": {"gnis_name": "River Rouge", "ftype": 460}},
        {"geometry": line, "properties": {"gnis_name": None}},
    ]}))
    rows = DetroitWaterwaysImporter("", "detroit", {}).transform(raw)
    assert [r["name"] for r in rows] == ["Detroit River", "River Rouge", None]
    assert rows[0]["waterway_type"] == "460"


def test_detroit_dlba_reads_live_field_names(tmp_path):
    """DLBA points: address is in `name`, status in `inventory_status_socrata`."""
    import json

    from app.data_import.detroit.import_area_overrides import DetroitDLBAImporter

    raw = tmp_path / "d.geojson"
    raw.write_text(json.dumps({"features": [{
        "geometry": {"type": "Point", "coordinates": [-82.98, 42.41]},
        "properties": {"name": "12787 Fournier", "parcel_id": "21012883-4",
                       "inventory_status_socrata": "Neighborhood Lot For Sale",
                       "council_district": 4, "neighborhood": "Eden Gardens"}}]}))
    (row,) = DetroitDLBAImporter("", "detroit", {}).transform(raw)
    assert row["address"] == "12787 Fournier"
    assert row["status"] == "Neighborhood Lot For Sale"
    assert row["property_type"] == "lot"
    assert row["council_district"] == "4"


def test_detroit_precinct_and_district_ids_are_plain_text(tmp_path):
    """DPD names are zero-padded ("09"); ids must be "9" so focus options sort/label cleanly."""
    import json

    from app.data_import.detroit.import_boundaries import (
        DetroitCouncilDistrictsImporter, DetroitPolicePrecinctsImporter,
    )

    square = {"type": "Polygon", "coordinates": [_square(0, 0, 1, clockwise=True)]}
    raw = tmp_path / "p.geojson"
    raw.write_text(json.dumps({"features": [
        {"geometry": square, "properties": {"name": "09", "district_number": 3}}]}))
    (precinct,) = DetroitPolicePrecinctsImporter("", "detroit", {}).transform(raw)
    assert (precinct["precinct"], precinct["name"]) == ("9", "Precinct 9")
    (district,) = DetroitCouncilDistrictsImporter("", "detroit", {}).transform(raw)
    assert district["district_number"] == "3"
    assert json.loads(district["geom_json"])["type"] == "MultiPolygon"


def test_detroit_railroad_owner_marks():
    from app.data_import.detroit.static_plan import classify_railroad_owner

    assert classify_railroad_owner("Consolidated Rail Corporation") == ("CRSH", "private_terminal")
    assert classify_railroad_owner("Canadian Pacific Kansas City") == ("CP", "private_class1")
    assert classify_railroad_owner("Ford Motor Company") == ("IND", "private_industrial")
    assert classify_railroad_owner(None) == ("_other", "unknown")
    assert classify_railroad_owner("Some Spur Co") == ("Some Spur Co", "unknown")


def test_detroit_enrich_tags_zoning_and_owner():
    import json

    from app.data_import.detroit.static_plan import enrich_detroit

    def poly(x0: float, size: float) -> str:
        """O(1) time, O(1) space — v = 5 vertices."""
        return json.dumps({"type": "Polygon", "coordinates": [_square(x0, 0, size, clockwise=False)]})

    rows = {
        "buildings": [
            {"geom_json": poly(1, 1), "parcel_pin": "01."},
            {"geom_json": poly(50, 1), "parcel_pin": "99."},
        ],
        "zoning_districts": [{"geom_json": poly(0, 10), "zone_code": "B4",
                              "zone_class": "commercial"}],
        "parcel_owners": [{"parcel_pin": "01.", "owner_name": "ACME LLC"}],
    }
    enrich_detroit(rows)
    first, second = rows["buildings"]
    assert (first["zoning_code"], first["zone_class"], first["owner_name"]) == (
        "B4", "commercial", "ACME LLC")
    assert "zoning_code" not in second and "owner_name" not in second


@pending
def test_phase2_enrichment_updates_only_detroit_rows():
    """Every enrich.* UPDATE leaves Chicago rows untouched (city_id filter)."""


def _batch_client(captured: list):
    """FastAPI app with the contacts router and a fake batch service recording queries."""
    from types import SimpleNamespace

    from fastapi import FastAPI
    from fastapi.testclient import TestClient

    from app.routes import contacts

    class FakeBatchService:
        is_configured = True

        # O(q) time, O(q) space — q = queries recorded
        async def start(self, queries, client_id, refresh=False):
            captured.extend(queries)
            return SimpleNamespace(job_id="a" * 32, pending=True, submitted=len(queries),
                                   by_name=0, results=[])

    contacts.set_batch_service(FakeBatchService())
    app = FastAPI()
    app.include_router(contacts.router, prefix="/api/v1")
    return TestClient(app), contacts


def test_owner_batch_uses_item_city_state():
    """Regression (TDD §13 F-1, fixed 2026-10-02): the route hard-coded Chicago, IL, so a
    Detroit batch would have bought Tracerfy answers for the wrong city."""
    captured: list = []
    client, contacts = _batch_client(captured)
    try:
        resp = client.post("/api/v1/contacts/owner/batch", json={"items": [
            {"street": "1331 BROADWAY ST", "zip": "48226", "city": "Detroit", "state": "MI"},
            {"street": "1001 W NORTH AVE", "zip": "60642"},  # old client: no city/state
        ]})
        assert resp.status_code == 200
        assert [(q.city, q.state) for q in captured] == [("Detroit", "MI"), ("Chicago", "IL")]
    finally:
        contacts.set_batch_service(None)


def test_owner_batch_rejects_bad_state():
    client, contacts = _batch_client([])
    try:
        resp = client.post("/api/v1/contacts/owner/batch", json={"items": [
            {"street": "1 MAIN ST", "city": "Detroit", "state": "Michigan"},
        ]})
        assert resp.status_code == 422
    finally:
        contacts.set_batch_service(None)


def test_phone_lookup_provider_order_for_new_cities():
    """Default config gives Detroit and Dayton Google first, like Chicago."""
    from app.config import Settings
    from app.services.phone_lookup_service import parse_city_providers

    by_city = parse_city_providers(Settings.model_fields["phone_lookup_providers_by_city"].default)
    assert by_city["detroit"] == ["google", "foursquare"]
    assert by_city["dayton"] == ["google", "foursquare"]
    assert by_city["chicago"] == ["google", "foursquare"]


# --- Blight data-shape regressions (live services checked 2026-10-02) -------------------


def test_blight_ticket_without_geometry_is_placed_from_lat_lon():
    """~98-100% of blight_tickets rows have geometry=null; location is in attributes."""
    import json

    from app.data_import.import_blight import _point_json

    out = _point_json(None, {"latitude": 42.410331, "longitude": -83.180889}, None)
    assert json.loads(out) == {"type": "Point", "coordinates": [-83.180889, 42.410331]}


def test_blight_point_outside_city_bbox_is_dropped():
    from app.data_import.import_blight import _point_json

    bbox = (-83.30, 42.20, -82.90, 42.50)
    assert _point_json(None, {"latitude": 0, "longitude": 0}, bbox) is None
    assert _point_json(None, {"latitude": None, "longitude": None}, bbox) is None
    assert _point_json(None, {"latitude": 42.33, "longitude": -83.05}, bbox) is not None


def test_blight_ticket_fields_map_from_real_names(tmp_path):
    import json

    from app.data_import.import_blight import BlightImporter

    raw = tmp_path / "raw.geojson"
    raw.write_text(json.dumps({"features": [
        {"geometry": None, "properties": {
            "_source": "blight_ticket", "address": "16163 TRACEY",
            "ordinance_law": "50-14-286(3)", "ordinance_description": "Unlawful parking",
            "disposition": "Responsible by Determination", "ticket_issued_date": "2025-02-12",
            "latitude": 42.410331, "longitude": -83.180889}},
        {"geometry": {"type": "Point", "coordinates": [-83.0103, 42.3971]}, "properties": {
            "_source": "commercial_demolition", "address": "9110 May",
            "status": "Demolished", "demo_date": 1503014400000}},
    ]}))
    recs = BlightImporter("postgresql://unused", "detroit-id", {}).transform(raw)
    ticket, demo = recs
    assert ticket["address"] == "16163 TRACEY"
    assert ticket["violation_code"] == "50-14-286(3)"
    assert ticket["ticket_status"] == "Responsible by Determination"
    assert ticket["violation_date"] == "2025-02-12"
    assert demo["violation_date"] == "2017-08-18"  # epoch ms → ISO date


def test_arcgis_paging_follows_exceeded_flag_not_page_size(monkeypatch):
    """Server caps pages at 1000 while page_size is 2000: the old loop stopped after one
    page. It must keep going while exceededTransferLimit is true, advancing by rows got."""
    from app.data_import import arcgis_helper

    pages = [
        {"properties": {"exceededTransferLimit": True}, "features": [{"properties": {}}] * 1000},
        {"properties": {"exceededTransferLimit": True}, "features": [{"properties": {}}] * 1000},
        {"features": [{"properties": {}}] * 7},
    ]
    offsets: list[str] = []

    class FakeResp:
        def __init__(self, data):
            self._data = data

        def raise_for_status(self):
            pass

        def json(self):
            return self._data

    class FakeClient:
        def __init__(self, **_kw):
            pass

        def __enter__(self):
            return self

        def __exit__(self, *exc):
            return False

        def get(self, _url, params):
            offsets.append(params["resultOffset"])
            return FakeResp(pages[len(offsets) - 1])

    monkeypatch.setattr(arcgis_helper.httpx, "Client", FakeClient)
    monkeypatch.setattr(arcgis_helper.time, "sleep", lambda _s: None)
    client = arcgis_helper.ArcGISFeatureServerClient("https://x/query", page_size=2000, where="a=1")
    out = client.download_all()
    assert len(out["features"]) == 2007
    assert offsets == ["0", "1000", "2000"]
