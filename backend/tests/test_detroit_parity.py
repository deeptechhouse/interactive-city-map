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


@pending
def test_phase2_semcog_multipart_buildings_split():
    """A 2-part SEMCOG feature becomes 2 building rows, not 1 polygon with a false hole."""


@pending
def test_phase2_detroit_zoning_classes_match_frontend_keys():
    """Every zone_class the Detroit importer emits exists in DETROIT_ZONE_CLASSES."""


@pending
def test_phase2_nhd_upper_case_fields_map_to_name():
    """GNIS_NAME → name; no Detroit waterway imports with a null name when NHD has one."""


@pending
def test_phase2_enrichment_updates_only_detroit_rows():
    """Every enrich.* UPDATE leaves Chicago rows untouched (city_id filter)."""


@pending
def test_phase6_owner_batch_uses_item_city_state():
    """BatchItem with city=DETROIT, state=MI reaches Tracerfy as Detroit, not Chicago, IL."""


@pending
def test_phase6_phone_lookup_detroit_provider_order():
    """PHONE_LOOKUP_PROVIDERS_BY_CITY includes detroit=google,foursquare."""


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
