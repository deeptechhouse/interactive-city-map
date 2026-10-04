"""Building images: per-city free sources, no cross-city calls, paid Street View gated.

No network: every HTTP call goes to an httpx.MockTransport.
"""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.adapters import building_images as bi
from app.adapters.building_images import (
    BuildingImageService,
    BuildingRef,
    CookAssessorPhotos,
    MapillaryPhotos,
    angle_gap,
    bearing_deg,
    city_sources,
    tile_xy,
)
from app.config import settings
from app.routes import images as images_route


def test_each_city_uses_only_its_own_sources():
    names = {c: [s.name for s in city_sources(c, "tok")] for c in ("chicago", "detroit", "dayton")}
    assert names["chicago"] == ["cook_assessor", "Cook County 2025 aerial", "USDA NAIP (USGS)"]
    assert names["detroit"] == ["mapillary", "Detroit 2024 aerial (6 in)", "USDA NAIP (USGS)"]
    assert names["dayton"] == ["mapillary", "Montgomery County 2024 aerial", "USDA NAIP (USGS)"]
    assert "cook_assessor" not in names["detroit"] + names["dayton"]
    assert [s.name for s in city_sources("atlantis", "")] == ["USDA NAIP (USGS)"]


def test_assessor_url_tries_both_extension_cases():
    urls = CookAssessorPhotos.candidate_urls("17163110010000")
    assert urls[0].endswith("/pin_detail/171-63/110/17163110010000_AA.JPG")
    assert urls[1].endswith("_AA.jpg")


def test_geometry_helpers():
    assert round(bearing_deg(41.0, -87.0, 41.001, -87.0)) == 0  # due north
    assert round(bearing_deg(41.0, -87.0, 41.0, -86.999)) == 90  # due east
    assert angle_gap(350, 10) == 20
    assert tile_xy(0.0, 0.0, 1) == (1, 1)


def test_mapillary_picks_the_frame_facing_the_building():
    ref = BuildingRef("dayton", 39.7590, -84.1916)
    south_of_building = [-84.1916, 39.7585]  # [lon, lat] — building is due north
    images = [
        {
            "id": "a",
            "thumb_1024_url": "u-a",
            "compass_angle": 180,
            "computed_geometry": {"coordinates": south_of_building},
        },
        {
            "id": "b",
            "thumb_1024_url": "u-b",
            "compass_angle": 5,
            "computed_geometry": {"coordinates": south_of_building},
        },
    ]
    assert MapillaryPhotos.best_facing(ref, images)["id"] == "b"


async def _service_with(handler) -> tuple[BuildingImageService, list[str]]:
    seen: list[str] = []

    def record(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        return handler(request)

    transport = httpx.MockTransport(record)
    real_client = httpx.AsyncClient

    class FakeClient(real_client):
        def __init__(self, *a, **kw):
            kw["transport"] = transport
            super().__init__(*a, **kw)

    bi.httpx.AsyncClient = FakeClient  # restored by the fixture below
    return BuildingImageService(""), seen


@pytest.fixture(autouse=True)
def _restore_httpx(tmp_path):
    """Restore httpx after each test, and count paid photos in a TEMP file — never in the
    real backend/data/streetview_usage.json."""
    from app.services.streetview_usage import StreetViewUsage

    original = bi.httpx.AsyncClient
    images_route.set_usage_store(StreetViewUsage(tmp_path / "usage.json"))
    yield
    bi.httpx.AsyncClient = original
    images_route.set_usage_store(None)


async def test_chicago_finds_assessor_photo_and_aerials():
    def handler(request):
        ok = request.url.path.endswith("_AA.jpg")  # this PIN uses lower-case .jpg
        return httpx.Response(200 if ok else 404)

    svc, seen = await _service_with(handler)
    answer = await svc.find(BuildingRef("chicago", 41.8789, -87.6359, pin="17163110010000"))
    assert [c.source for c in answer.facade] == ["Cook County Assessor"]
    assert answer.facade[0].url.endswith("_AA.jpg")
    assert [c.source for c in answer.aerial] == ["Cook County 2025 aerial", "USDA NAIP (USGS)"]
    assert "google.com/maps" in answer.google_maps_url
    # Only the county's photo server was contacted (aerials are browser-loaded URLs).
    assert all("cookcountyassessoril.gov" in u for u in seen)


async def test_detroit_without_token_makes_no_calls_and_still_has_aerials():
    svc, seen = await _service_with(lambda r: httpx.Response(500))
    answer = await svc.find(BuildingRef("detroit", 42.3314, -83.0458))
    assert answer.facade == [] and seen == []
    assert answer.mapillary_configured is False
    assert answer.aerial[0].url.startswith("https://tiles.arcgis.com/")


def test_building_endpoint_and_paid_streetview_off_by_default(monkeypatch):
    class Fake:
        async def find(self, ref):
            return bi.BuildingImages(google_maps_url="g")

    images_route.set_image_service(Fake())
    monkeypatch.setattr(settings, "google_streetview_enabled", False)
    from app.map_server import app

    client = TestClient(app)
    try:
        r = client.get(
            "/api/v1/images/building", params={"city": "dayton", "lat": 39.75, "lon": -84.19}
        )
        assert r.status_code == 200 and r.json()["streetview_paid_enabled"] is False
        assert (
            client.get(
                "/api/v1/images/building", params={"city": "X;", "lat": 1, "lon": 1}
            ).status_code
            == 422
        )
        assert (
            client.get("/api/v1/images/streetview/photo", params={"lat": 1, "lon": 1}).status_code
            == 404
        )
        page = client.get(
            "/api/v1/images/streetview/page", params={"lat": 1, "lon": 1, "title": "<b>x</b>"}
        )
        assert page.status_code == 200 and "turned off" in page.text and "<b>x</b>" not in page.text
    finally:
        images_route.set_image_service(None)


# --- review fixes (2026-10-02) -------------------------------------------------------------


def test_mapillary_breaks_ties_by_distance_and_skips_unknown_direction():
    ref = BuildingRef("dayton", 39.7590, -84.1916)
    near, far = [-84.1916, 39.7589], [-84.1916, 39.7586]
    images = [
        {
            "id": "far",
            "thumb_1024_url": "u",
            "is_pano": True,
            "computed_geometry": {"coordinates": far},
        },
        {
            "id": "near",
            "thumb_1024_url": "u",
            "is_pano": True,
            "computed_geometry": {"coordinates": near},
        },
        {"id": "nodir", "thumb_1024_url": "u", "computed_geometry": {"coordinates": near}},
    ]
    assert MapillaryPhotos.best_facing(ref, images)["id"] == "near"


async def test_mapillary_falls_back_to_crowd_and_credits_correctly():
    usable = {
        "id": "c1",
        "thumb_1024_url": "u",
        "is_pano": True,
        "computed_geometry": {"coordinates": [-83.0458, 42.3314]},
    }

    def handler(request):
        if "creator_username" in request.url.params:  # City frames exist but none usable
            return httpx.Response(200, json={"data": [{"id": "x", "computed_geometry": None}]})
        return httpx.Response(200, json={"data": [usable]})

    async with httpx.AsyncClient(transport=httpx.MockTransport(handler)) as client:
        found = await MapillaryPhotos("tok", creator="codgis").find(
            BuildingRef("detroit", 42.3314, -83.0458), client
        )
    assert [c.source for c in found] == ["Mapillary"]  # not "Detroit Street View"


async def test_transient_failure_is_cached_briefly_not_for_an_hour():
    calls = {"n": 0}

    def handler(request):
        calls["n"] += 1
        return httpx.Response(503)

    svc, _ = await _service_with(handler)
    ref = BuildingRef("chicago", 41.8789, -87.6359, pin="17163110010000")
    first = await svc.find(ref)
    assert first.facade == [] and first.aerial  # aerials still shown
    expiry = next(iter(svc._cache.values()))[0]
    import time as _t

    assert expiry - _t.monotonic() <= BuildingImageService.FAILED_TTL_S


def test_paid_photo_refuses_cross_site_and_asks_metadata_with_same_filter(monkeypatch):
    monkeypatch.setattr(settings, "google_streetview_enabled", True)
    monkeypatch.setattr(settings, "google_streetview_api_key", "real-key-123")
    seen: list[httpx.Request] = []

    def handler(request):
        seen.append(request)
        if request.url.path.endswith("/metadata"):
            return httpx.Response(200, json={"status": "OK"})
        return httpx.Response(200, content=b"JPEG", headers={"content-type": "image/jpeg"})

    original = images_route.httpx.AsyncClient

    class Fake(original):
        def __init__(self, *a, **kw):
            kw["transport"] = httpx.MockTransport(handler)
            super().__init__(*a, **kw)

    monkeypatch.setattr(images_route.httpx, "AsyncClient", Fake)
    from app.map_server import app

    client = TestClient(app)
    params = {"lat": 41.8789, "lon": -87.6359}
    cross = client.get(
        "/api/v1/images/streetview/photo", params=params, headers={"sec-fetch-site": "cross-site"}
    )
    assert cross.status_code == 403 and seen == []  # nothing asked of Google, nothing billed
    no_pass = client.get("/api/v1/images/streetview/photo", params=params)
    assert no_pass.status_code == 403 and seen == []  # no offer pass → Google never asked
    token = images_route._passes().mint(41.8789, -87.6359)
    ok = client.get(
        "/api/v1/images/streetview/photo",
        params={**params, "token": token},
        headers={"sec-fetch-site": "same-origin"},
    )
    assert ok.status_code == 200 and ok.headers["cache-control"] == "no-store"
    again = client.get("/api/v1/images/streetview/photo", params={**params, "token": token})
    assert again.status_code == 403  # single use: a reload/loop can't bill twice
    meta, photo = seen
    assert meta.url.params["source"] == photo.url.params["source"] == "outdoor"
    assert photo.url.params["return_error_code"] == "true"
    assert "real-key-123" not in ok.text


# --- paid Street View only during a search, only when the free photo is missing/poor ---------


def test_poor_quality_rule():
    from app.adapters.building_images import ImageCandidate, paid_streetview_reason

    old = ImageCandidate("facade", "Cook County Assessor", "u", "a", captured_year=2008)
    fresh = ImageCandidate("facade", "Mapillary", "u", "a", captured_year=2024, distance_m=10.0)
    far = ImageCandidate("facade", "Mapillary", "u", "a", captured_year=2024, distance_m=48.0)
    assert paid_streetview_reason([], 2026) == "no free street-level photo"
    assert paid_streetview_reason([old], 2026) == "free photo is from 2008"
    assert paid_streetview_reason([far], 2026) == "free photo was taken 48 m away"
    assert paid_streetview_reason([fresh], 2026) == ""  # good free photo → Google never asked


def _paid_client(monkeypatch, facades, meta_status="OK", meta_date="2023-07"):
    """App with paid photos ON, a fake image service, and a fake Google that records calls."""
    monkeypatch.setattr(settings, "google_streetview_enabled", True)
    monkeypatch.setattr(settings, "google_streetview_api_key", "real-key-123")
    google_calls: list[str] = []

    def handler(request):
        google_calls.append(request.url.path)
        return httpx.Response(200, json={"status": meta_status, "date": meta_date})

    original = images_route.httpx.AsyncClient

    class Fake(original):
        def __init__(self, *a, **kw):
            kw["transport"] = httpx.MockTransport(handler)
            super().__init__(*a, **kw)

    monkeypatch.setattr(images_route.httpx, "AsyncClient", Fake)

    class Svc:
        async def find(self, ref):
            return bi.BuildingImages(facade=list(facades), google_maps_url="g")

    images_route.set_image_service(Svc())
    from app.map_server import app

    return TestClient(app), google_calls


def _get(client, searched):
    params = {"city": "chicago", "lat": 41.88, "lon": -87.63, "searched": searched}
    return client.get("/api/v1/images/building", params=params).json()


def test_no_google_call_before_a_search(monkeypatch):
    client, calls = _paid_client(monkeypatch, facades=[])
    try:
        assert _get(client, "false")["streetview"] is None
        assert calls == []
    finally:
        images_route.set_image_service(None)


def test_old_free_photo_after_search_offers_paid_photo_via_free_check(monkeypatch):
    old = bi.ImageCandidate("facade", "Cook County Assessor", "u", "a", captured_year=2008)
    client, calls = _paid_client(monkeypatch, facades=[old])
    try:
        offer = _get(client, "true")["streetview"]
        token = offer.pop("token")
        assert offer == {
            "available": True,
            "reason": "free photo is from 2008",
            "date": "2023-07",
            "note": "",
        }
        assert images_route._passes().is_valid(token, 41.88, -87.63)
        assert not images_route._passes().is_valid(token, 42.33, -83.04)  # bound to this place
        assert calls == ["/maps/api/streetview/metadata"]  # only the FREE check — nothing billed
    finally:
        images_route.set_image_service(None)


def test_good_free_photo_after_search_never_asks_google(monkeypatch):
    fresh = bi.ImageCandidate("facade", "Mapillary", "u", "a", captured_year=2025, distance_m=8.0)
    client, calls = _paid_client(monkeypatch, facades=[fresh])
    try:
        assert _get(client, "true")["streetview"] is None and calls == []
    finally:
        images_route.set_image_service(None)


def test_monthly_cap_stops_offers_and_photos(monkeypatch, tmp_path):
    from app.services.streetview_usage import StreetViewUsage

    usage = StreetViewUsage(tmp_path / "u.json")
    monkeypatch.setattr(settings, "google_streetview_monthly_cap", 2)
    images_route.set_usage_store(usage)
    assert usage.try_spend(2) and usage.try_spend(2) and not usage.try_spend(2)
    client, calls = _paid_client(monkeypatch, facades=[])
    try:
        offer = _get(client, "true")["streetview"]
        assert offer["available"] is False and "used up" in offer["note"] and calls == []
        token = images_route._passes().mint(41.88, -87.63)
        photo = client.get(
            "/api/v1/images/streetview/photo",
            params={"lat": 41.88, "lon": -87.63, "token": token},
        )
        assert photo.status_code == 429  # metadata asked (free), photo refused — nothing billed
        assert calls == ["/maps/api/streetview/metadata"]
    finally:
        images_route.set_image_service(None)


def test_denied_key_is_explained_not_reported_as_no_imagery(monkeypatch):
    client, calls = _paid_client(monkeypatch, facades=[], meta_status="REQUEST_DENIED")
    try:
        offer = _get(client, "true")["streetview"]
        assert offer["available"] is False
        assert "Street View Static API enabled" in offer["note"]
    finally:
        images_route.set_image_service(None)


# --- second review fixes (2026-10-04) ------------------------------------------------------


def test_popup_page_refuses_other_sites_and_cannot_be_framed(monkeypatch):
    monkeypatch.setattr(settings, "google_streetview_enabled", True)
    monkeypatch.setattr(settings, "google_streetview_api_key", "real-key-123")
    from app.map_server import app

    client = TestClient(app)
    params = {"lat": 41.88, "lon": -87.63, "token": "x.y.z"}
    cross = client.get(
        "/api/v1/images/streetview/page", params=params, headers={"sec-fetch-site": "cross-site"}
    )
    assert cross.status_code == 403
    page = client.get("/api/v1/images/streetview/page", params=params)
    assert page.status_code == 200
    assert page.headers["x-frame-options"] == "DENY"
    assert "frame-ancestors 'none'" in page.headers["content-security-policy"]
    assert page.headers["cross-origin-opener-policy"] == "same-origin"
    assert "token=x.y.z" in page.text


def test_pass_rejects_tampering_and_expiry():
    from app.services.streetview_offers import OfferPasses

    passes = OfferPasses(secret=b"s" * 32)
    token = passes.mint(41.88, -87.63)
    expiry, nonce, sig = token.split(".")
    assert not passes.is_valid(f"{int(expiry) + 999}.{nonce}.{sig}", 41.88, -87.63)
    assert not passes.is_valid("garbage", 41.88, -87.63)
    assert passes.redeem(token, 41.88, -87.63) and not passes.redeem(token, 41.88, -87.63)
    expired = OfferPasses(secret=b"s" * 32, ttl_s=-1).mint(41.88, -87.63)
    assert not passes.is_valid(expired, 41.88, -87.63)


@pytest.mark.parametrize(
    "content",
    [
        '{"month": "2026-10", "cou',
        '{"month": "M", "count": "abc"}',
        '{"month": "M", "count": -5}',
        "[1, 2]",
    ],
)
def test_counter_fails_closed_on_a_bad_file(tmp_path, content):
    from app.services import streetview_usage as su

    path = tmp_path / "usage.json"
    path.write_text(content.replace('"M"', f'"{su._this_month()}"'))
    usage = su.StreetViewUsage(path)
    before = path.read_text()
    assert usage.try_spend(9500) is False  # unknown usage → no paid photo
    assert usage.used() >= 9500
    assert path.read_text() == before  # left as it was, for a person to look at


def test_counter_month_is_pacific_time():
    from app.services import streetview_usage as su

    assert str(su._GOOGLE_BILLING_TZ) == "America/Los_Angeles"


def test_old_google_photo_is_not_offered_to_replace_an_old_free_photo(monkeypatch):
    old = bi.ImageCandidate("facade", "Cook County Assessor", "u", "a", captured_year=2008)
    client, calls = _paid_client(monkeypatch, facades=[old], meta_date="2009-05")
    try:
        offer = _get(client, "true")["streetview"]
        assert offer["available"] is False and "also old (2009-05)" in offer["note"]
        assert "token" not in offer  # no pass → nothing can be billed
    finally:
        images_route.set_image_service(None)


def test_usage_endpoint_reports_the_month_without_calling_google(monkeypatch, tmp_path):
    from app.services.streetview_usage import StreetViewUsage

    monkeypatch.setattr(settings, "google_streetview_enabled", True)
    monkeypatch.setattr(settings, "google_streetview_api_key", "real-key-123")
    usage = StreetViewUsage(tmp_path / "u.json")
    usage.try_spend(9500)
    usage.try_spend(9500)
    images_route.set_usage_store(usage)
    from app.map_server import app

    body = TestClient(app).get("/api/v1/images/streetview/usage").json()
    assert body["enabled"] is True and body["used"] == 2 and body["cap"] == 9500
    (tmp_path / "u.json").write_text("{broken")
    assert TestClient(app).get("/api/v1/images/streetview/usage").json()["used"] is None
