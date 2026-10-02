"""Tests for the contact-list phone lookup: adapters, service, and route.

Providers are faked with ``httpx.MockTransport`` — no network, no API keys, no cost.
The route is mounted on a bare FastAPI app so these tests don't need the database.
"""

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.http_json import ProviderUnavailable
from app.adapters.phone_lookup import (
    BusinessQuery,
    ChainedPhoneLookup,
    FoursquarePhoneLookup,
    GooglePlacesPhoneLookup,
    PhoneLookupAdapter,
    PhoneMatch,
    build_phone_lookup,
    names_match,
)
from app.routes import contacts
from app.services.phone_lookup_service import (
    LruCache,
    PhoneLookupResult,
    PhoneLookupService,
    RateLimited,
    SlidingWindowRateLimiter,
    parse_city_providers,
)


@pytest.fixture(autouse=True)
def _no_real_api_keys(monkeypatch):
    """Safety net: blank every paid-API key from .env for each test, so a code path that
    falls back to settings can never reach a real (billed) provider. Trap 2026-10-02: a
    test built TracerfyBatchClient(api_key="") which fell back to the real .env key and
    sent a live request (refused, nothing charged)."""
    from app.config import settings

    for key in ("google_places_api_key", "foursquare_api_key", "tracerfy_api_key", "batchdata_api_key"):
        monkeypatch.setattr(settings, key, "")

QUERY = BusinessQuery(name="COREY'S NYC BAGEL DELI", address="1001 W NORTH AVE", lat=41.91, lon=-87.65)


def _client(handler) -> httpx.AsyncClient:
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class FakeProvider(PhoneLookupAdapter):
    """Counts calls; returns a fixed answer or raises."""

    def __init__(self, name, result=None, error=None, configured=True):
        self._name, self._result, self._error, self._configured = name, result, error, configured
        self.calls = 0

    @property
    def name(self):
        return self._name

    @property
    def is_configured(self):
        return self._configured

    async def lookup(self, query):
        self.calls += 1
        if self._error:
            raise self._error
        return self._result


# ---------------------------------------------------------------------------
# names_match — the guard against returning a neighbour's phone
# ---------------------------------------------------------------------------

class TestNamesMatch:
    def test_shared_significant_word_matches(self):
        assert names_match("COREY'S NYC BAGEL DELI", "Corey's NYC Bagel")

    def test_only_stop_words_shared_does_not_match(self):
        assert not names_match("THE CHICAGO CO LLC", "The Chicago Company Inc")

    def test_unrelated_names_do_not_match(self):
        assert not names_match("DEEP PURPL", "Porcelanosa USA")

    def test_empty_found_name(self):
        assert not names_match("DEEP PURPL", "")


# ---------------------------------------------------------------------------
# Google Places adapter
# ---------------------------------------------------------------------------

class TestGooglePlaces:
    async def test_returns_phone_and_sends_key_and_field_mask(self):
        seen = {}

        def handler(request):
            seen["headers"] = request.headers
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={"places": [
                {"displayName": {"text": "Corey's NYC Bagel Deli"}, "nationalPhoneNumber": "(312) 555-0100"}
            ]})

        adapter = GooglePlacesPhoneLookup(api_key="k", client=_client(handler))
        match = await adapter.lookup(QUERY)

        assert match == PhoneMatch("(312) 555-0100", "Corey's NYC Bagel Deli", "google")
        assert seen["headers"]["x-goog-api-key"] == "k"
        assert "nationalPhoneNumber" in seen["headers"]["x-goog-fieldmask"]
        assert seen["body"]["locationBias"]["circle"]["center"] == {"latitude": 41.91, "longitude": -87.65}

    async def test_no_location_bias_without_coordinates(self):
        seen = {}

        def handler(request):
            seen["body"] = json.loads(request.content)
            return httpx.Response(200, json={})

        adapter = GooglePlacesPhoneLookup(api_key="k", client=_client(handler))
        assert await adapter.lookup(BusinessQuery(name="X", address="1 N STATE ST")) is None
        assert "locationBias" not in seen["body"]

    async def test_rejects_neighbouring_business(self):
        handler = lambda r: httpx.Response(200, json={"places": [
            {"displayName": {"text": "Porcelanosa USA"}, "nationalPhoneNumber": "(312) 555-9999"}
        ]})
        adapter = GooglePlacesPhoneLookup(api_key="k", client=_client(handler))
        assert await adapter.lookup(QUERY) is None

    async def test_match_without_phone_is_none(self):
        handler = lambda r: httpx.Response(200, json={"places": [{"displayName": {"text": "Corey's Bagel"}}]})
        adapter = GooglePlacesPhoneLookup(api_key="k", client=_client(handler))
        assert await adapter.lookup(QUERY) is None

    async def test_http_error_raises(self):
        adapter = GooglePlacesPhoneLookup(api_key="k", client=_client(lambda r: httpx.Response(403)))
        with pytest.raises(httpx.HTTPStatusError):
            await adapter.lookup(QUERY)

    def test_placeholder_key_is_not_configured(self):
        assert not GooglePlacesPhoneLookup(api_key="your_google_places_api_key_here").is_configured
        assert not FoursquarePhoneLookup(api_key="  your_foursquare_api_key_here ").is_configured
        assert FoursquarePhoneLookup(api_key="real").is_configured

    def test_unconfigured_without_key(self, monkeypatch):
        monkeypatch.setattr("app.adapters.phone_lookup.settings.google_places_api_key", "")
        assert not GooglePlacesPhoneLookup().is_configured


# ---------------------------------------------------------------------------
# Foursquare adapter
# ---------------------------------------------------------------------------

class TestFoursquare:
    async def test_picks_first_matching_result_with_phone(self):
        seen = {}

        def handler(request):
            seen["headers"] = request.headers
            seen["params"] = dict(request.url.params)
            return httpx.Response(200, json={"results": [
                {"name": "Porcelanosa", "tel": "(312) 555-9999"},
                {"name": "Corey's Bagels", "tel": ""},
                {"name": "Corey's NYC Bagel Deli", "tel": "(312) 555-0100"},
            ]})

        adapter = FoursquarePhoneLookup(api_key="fsq", client=_client(handler))
        match = await adapter.lookup(QUERY)

        assert match == PhoneMatch("(312) 555-0100", "Corey's NYC Bagel Deli", "foursquare")
        assert seen["headers"]["authorization"] == "Bearer fsq"
        assert seen["headers"]["x-places-api-version"]
        assert seen["params"]["ll"] == "41.91,-87.65"

    async def test_uses_near_without_coordinates(self):
        seen = {}

        def handler(request):
            seen["params"] = dict(request.url.params)
            return httpx.Response(200, json={"results": []})

        adapter = FoursquarePhoneLookup(api_key="fsq", client=_client(handler))
        assert await adapter.lookup(BusinessQuery(name="X", address="1 N STATE ST")) is None
        assert seen["params"]["near"].startswith("1 N STATE ST")
        assert "ll" not in seen["params"]


# ---------------------------------------------------------------------------
# Chain + factory
# ---------------------------------------------------------------------------

class TestChain:
    async def test_second_provider_only_called_when_first_misses(self):
        first = FakeProvider("google", result=PhoneMatch("1", "a", "google"))
        second = FakeProvider("foursquare", result=PhoneMatch("2", "b", "foursquare"))
        assert (await ChainedPhoneLookup([first, second]).lookup(QUERY)).phone == "1"
        assert second.calls == 0

    async def test_falls_through_on_miss_and_on_http_error(self):
        broken = FakeProvider("google", error=httpx.ConnectError("down"))
        empty = FakeProvider("x", result=None)
        good = FakeProvider("foursquare", result=PhoneMatch("2", "b", "foursquare"))
        assert (await ChainedPhoneLookup([broken, empty, good]).lookup(QUERY)).provider == "foursquare"

    async def test_skips_unconfigured_providers(self):
        unkeyed = FakeProvider("google", result=PhoneMatch("1", "a", "google"), configured=False)
        chain = ChainedPhoneLookup([unkeyed])
        assert not chain.is_configured
        assert chain.name == "none"
        assert await chain.lookup(QUERY) is None
        assert unkeyed.calls == 0

    def test_factory_respects_order_and_ignores_unknown(self, monkeypatch):
        monkeypatch.setattr("app.adapters.phone_lookup.settings.google_places_api_key", "g")
        monkeypatch.setattr("app.adapters.phone_lookup.settings.foursquare_api_key", "f")
        chain = build_phone_lookup(["google", "bogus", "foursquare"])
        assert chain.provider_names == ("google", "foursquare")
        assert chain.name == "google+foursquare"


# ---------------------------------------------------------------------------
# Service helpers
# ---------------------------------------------------------------------------

class TestServiceHelpers:
    def test_parse_city_providers(self):
        assert parse_city_providers("Chicago=google, foursquare;detroit=foursquare;junk;x=") == {
            "chicago": ["google", "foursquare"],
            "detroit": ["foursquare"],
        }

    def test_rate_limiter_window(self):
        now = [0.0]
        limiter = SlidingWindowRateLimiter(limit=2, window_s=60, clock=lambda: now[0])
        assert limiter.allow("a") and limiter.allow("a")
        assert not limiter.allow("a")
        assert limiter.allow("b")  # per-client
        now[0] = 61
        assert limiter.allow("a")

    def test_lru_evicts_oldest(self):
        cache = LruCache(2)
        r = PhoneLookupResult("", "", "", False)
        cache.put(("a",), r)
        cache.put(("b",), r)
        cache.get(("a",))  # touch a → b becomes oldest
        cache.put(("c",), r)
        assert cache.get(("b",)) is None
        assert cache.get(("a",)) is r


def _service(providers_by_city, limit=100):
    """Service whose chains are built from FakeProviders keyed by name."""
    def factory(names):
        return ChainedPhoneLookup([providers_by_city[n] for n in names if n in providers_by_city])

    return PhoneLookupService(
        default_providers=["foursquare", "google"],
        city_providers={"chicago": ["google", "foursquare"]},
        rate_limiter=SlidingWindowRateLimiter(limit),
        chain_factory=factory,
    )


class TestPhoneLookupService:
    async def test_chicago_uses_google_first_other_cities_use_default(self):
        google = FakeProvider("google", result=PhoneMatch("g", "n", "google"))
        fsq = FakeProvider("foursquare", result=PhoneMatch("f", "n", "foursquare"))
        svc = _service({"google": google, "foursquare": fsq})
        assert (await svc.lookup("chicago", QUERY, "ip")).provider == "google"
        assert (await svc.lookup("detroit", QUERY, "ip")).provider == "foursquare"
        assert svc.providers_for("chicago") == ("google", "foursquare")

    async def test_cache_hits_and_misses_are_not_rebilled(self):
        google = FakeProvider("google", result=None)
        svc = _service({"google": google})
        first = await svc.lookup("chicago", QUERY, "ip")
        again = await svc.lookup("CHICAGO", BusinessQuery(name=" corey's nyc bagel deli ", address="1001 w north ave"), "ip")
        assert first.phone == "" and not first.cached
        assert again.cached
        assert google.calls == 1

    async def test_rate_limited_after_budget(self):
        google = FakeProvider("google", result=None)
        svc = _service({"google": google}, limit=1)
        await svc.lookup("chicago", QUERY, "ip")
        with pytest.raises(RateLimited):
            await svc.lookup("chicago", BusinessQuery(name="OTHER", address="2 N STATE ST"), "ip")


# ---------------------------------------------------------------------------
# Route
# ---------------------------------------------------------------------------

@pytest.fixture
def route_client():
    google = FakeProvider("google", result=PhoneMatch("(312) 555-0100", "Corey's", "google"))
    contacts.set_phone_service(_service({"google": google}, limit=1))
    app = FastAPI()
    app.include_router(contacts.router, prefix="/api/v1")
    yield TestClient(app)
    contacts.set_phone_service(None)


class TestContactsRoute:
    def test_lookup_returns_phone(self, route_client):
        resp = route_client.get("/api/v1/contacts/phone", params={
            "name": "COREY'S NYC BAGEL DELI", "address": "1001 W NORTH AVE", "lat": 41.9, "lon": -87.6,
        })
        assert resp.status_code == 200
        assert resp.json() == {
            "phone": "(312) 555-0100", "matched_name": "Corey's", "provider": "google", "cached": False, "website": "",
        }

    def test_rate_limit_returns_429(self, route_client):
        params = {"name": "A", "address": "1 N STATE ST"}
        assert route_client.get("/api/v1/contacts/phone", params=params).status_code == 200
        assert route_client.get("/api/v1/contacts/phone", params={**params, "name": "B"}).status_code == 429

    @pytest.mark.parametrize("params", [
        {"address": "1 N STATE ST"},                                  # missing name
        {"name": "A", "address": "x" * 201},                          # too long
        {"name": "A", "address": "1 N STATE ST", "lat": 91},          # out of range
        {"name": "A", "address": "1 N STATE ST", "city": "../etc"},   # bad city slug
    ])
    def test_rejects_bad_input(self, route_client, params):
        assert route_client.get("/api/v1/contacts/phone", params=params).status_code == 422

    def test_providers_endpoint(self, route_client):
        body = route_client.get("/api/v1/contacts/providers", params={"city": "chicago"}).json()
        assert body["providers"] == ["google"]
        assert "owner_providers" in body

    def test_owner_company_lookup_passes_locality(self, route_client):
        resp = route_client.get("/api/v1/contacts/phone", params={
            "name": "CRM PROPERTIES GROUP", "address": "740 WAUKEGAN RD", "locality": "Deerfield", "region": "il",
        })
        assert resp.status_code == 200
        assert resp.json()["website"] == ""


class TestPhoneProviderFailures:
    async def test_all_failing_raises_and_is_not_cached(self):
        req = httpx.Request("POST", "https://example.test")
        err = httpx.HTTPStatusError("quota", request=req, response=httpx.Response(429, request=req))
        google = FakeProvider("google", error=err)
        svc = _service({"google": google})
        for _ in range(2):
            with pytest.raises(ProviderUnavailable):
                await svc.lookup("chicago", QUERY, "ip")
        assert google.calls == 2

    def test_route_returns_502(self):
        req = httpx.Request("POST", "https://example.test")
        err = httpx.HTTPStatusError("x", request=req, response=httpx.Response(500, request=req))
        contacts.set_phone_service(_service({"google": FakeProvider("google", error=err)}))
        app = FastAPI()
        app.include_router(contacts.router, prefix="/api/v1")
        try:
            resp = TestClient(app).get("/api/v1/contacts/phone", params={"name": "A", "address": "1 N STATE ST"})
        finally:
            contacts.set_phone_service(None)
        assert resp.status_code == 502 and "Google" in resp.json()["detail"]
