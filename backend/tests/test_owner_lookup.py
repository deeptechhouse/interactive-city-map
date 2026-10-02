"""Tests for owner skip trace: Tracerfy + BatchData adapters, chain, service, route.

Providers are faked with httpx.MockTransport — no network, no keys, no cost.
"""

import json

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.http_json import ProviderUnavailable, real_key
from app.adapters.owner_lookup import (
    BatchDataOwnerLookup,
    ChainedOwnerLookup,
    OwnerContactResult,
    OwnerLookupAdapter,
    OwnerPhone,
    OwnerQuery,
    TracerfyOwnerLookup,
    digits_phone,
    build_owner_lookup,
)
from app.routes import contacts
from app.services.owner_lookup_service import OwnerLookupService
from app.services.owner_result_store import OwnerResultStore
from app.services.phone_lookup_service import RateLimited, SlidingWindowRateLimiter


@pytest.fixture(autouse=True)
def _no_real_api_keys(monkeypatch):
    """Safety net: blank every paid-API key from .env for each test, so a code path that
    falls back to settings can never reach a real (billed) provider. Trap 2026-10-02: a
    test built TracerfyBatchClient(api_key="") which fell back to the real .env key and
    sent a live request (refused, nothing charged)."""
    from app.config import settings

    for key in ("google_places_api_key", "foursquare_api_key", "tracerfy_api_key", "batchdata_api_key"):
        monkeypatch.setattr(settings, key, "")

Q = OwnerQuery(street="1001 W NORTH AVE", city="Chicago", state="IL", zip="60642", owner_name="CRM PROPERTIES GROUP")


def _client(handler):
    return httpx.AsyncClient(transport=httpx.MockTransport(handler))


class Fake(OwnerLookupAdapter):
    def __init__(self, name, result=None, error=None, configured=True):
        self._n, self._r, self._e, self._c = name, result, error, configured
        self.calls = 0

    @property
    def name(self):
        return self._n

    @property
    def is_configured(self):
        return self._c

    async def lookup(self, query):
        self.calls += 1
        if self._e:
            raise self._e
        return self._r


HIT = OwnerContactResult("JANE DOE", (OwnerPhone("(312) 555-0100", "Mobile", False),), ("j@x.com",), "tracerfy")


class TestHelpers:
    @pytest.mark.parametrize("raw,out", [
        ("5125550100", "(512) 555-0100"),
        ("+1-214-555-0123", "(214) 555-0123"),
        ("12", "12"),
        (None, ""),
    ])
    def testdigits_phone(self, raw, out):
        assert digits_phone(raw) == out

    def test_real_key(self):
        assert real_key(" your_x ") == "" and real_key("") == "" and real_key("k") == "k"


class TestTracerfy:
    async def test_parses_owner_person_sorted_callable_first(self):
        seen = {}

        def handler(req):
            seen["auth"] = req.headers["authorization"]
            seen["body"] = json.loads(req.content)
            return httpx.Response(200, json={"hit": True, "persons": [
                {"full_name": "Not Owner", "property_owner": False, "phones": [{"number": "1", "rank": 1}]},
                {"full_name": "Jane Doe", "property_owner": True,
                 "phones": [
                     {"number": "5125550200", "type": "Landline", "dnc": True, "rank": 1},
                     {"number": "5125550100", "type": "Mobile", "dnc": False, "rank": 2},
                     {"number": "", "rank": 3},
                 ],
                 "emails": [{"email": "b@x.com", "rank": 2}, {"email": "a@x.com", "rank": 1}, {"email": ""}]},
            ]})

        r = await TracerfyOwnerLookup(api_key="t", client=_client(handler)).lookup(Q)
        assert seen["auth"] == "Bearer t"
        assert seen["body"] == {"address": "1001 W NORTH AVE", "city": "Chicago", "state": "IL", "zip": "60642", "find_owner": True}
        assert r.person_name == "Jane Doe"
        assert [p.number for p in r.phones] == ["(512) 555-0100", "(512) 555-0200"]  # DNC last
        assert r.phones[1].dnc and r.phones[1].type == "Landline"
        assert r.emails == ("a@x.com", "b@x.com")
        assert r.provider == "tracerfy"

    async def test_first_person_when_none_flagged(self):
        handler = lambda req: httpx.Response(200, json={"hit": True, "persons": [
            {"full_name": "A", "phones": [{"number": "5125550100"}]}]})
        r = await TracerfyOwnerLookup(api_key="t", client=_client(handler)).lookup(Q)
        assert r.person_name == "A"

    @pytest.mark.parametrize("payload", [
        {"hit": False},
        {"hit": True, "persons": []},
        {"hit": True, "persons": [{"full_name": "No Contacts", "phones": [], "emails": []}]},
    ])
    async def test_misses(self, payload):
        r = await TracerfyOwnerLookup(api_key="t", client=_client(lambda req: httpx.Response(200, json=payload))).lookup(Q)
        assert r is None

    def test_placeholder_key_unconfigured(self):
        assert not TracerfyOwnerLookup(api_key="your_tracerfy_api_key_here").is_configured


class TestTracerfyCompliance:
    async def test_tcpa_litigator_flag_phones_and_deceased_skipped(self):
        handler = lambda req: httpx.Response(200, json={"hit": True, "persons": [
            {"full_name": "Gone", "property_owner": True, "deceased": True, "phones": [{"number": "3125550000"}]},
            {"full_name": "Live", "property_owner": True, "litigator": False, "phones": [
                {"number": "3125550100", "type": "Mobile", "dnc": False, "tcpa": True, "rank": 1},
                {"number": "3125550200", "type": "Landline", "dnc": False, "tcpa": False, "rank": 2},
            ]},
        ]})
        r = await TracerfyOwnerLookup(api_key="t", client=_client(handler)).lookup(Q)
        assert r.person_name == "Live"
        assert r.phones == (
            OwnerPhone("(312) 555-0200", "Landline", False),
            OwnerPhone("(312) 555-0100", "Mobile · TCPA", True),
        )

    async def test_litigator_flags_every_phone(self):
        handler = lambda req: httpx.Response(200, json={"hit": True, "persons": [
            {"full_name": "L", "litigator": True, "phones": [{"number": "3125550100"}]}]})
        r = await TracerfyOwnerLookup(api_key="t", client=_client(handler)).lookup(Q)
        assert r.phones == (OwnerPhone("(312) 555-0100", "litigator", True),)

    async def test_only_deceased_is_a_miss(self):
        handler = lambda req: httpx.Response(200, json={"hit": True, "persons": [
            {"full_name": "Gone", "deceased": True, "phones": [{"number": "3125550000"}]}]})
        assert await TracerfyOwnerLookup(api_key="t", client=_client(handler)).lookup(Q) is None


class TestBatchData:
    async def test_sends_requests_shape_and_parses_persons_shape(self):
        seen = {}

        def handler(req):
            seen["body"] = json.loads(req.content)
            return httpx.Response(200, json={"results": {"persons": [{
                "name": {"first": "John", "last": "Smith"},
                "phoneNumbers": [{"number": "3125550100", "type": "Mobile", "dnc": True}, {"number": ""}],
                "emails": [{"email": "js@x.com"}, "plain@x.com", {"email": ""}],
            }]}})

        r = await BatchDataOwnerLookup(api_key="b", client=_client(handler)).lookup(Q)
        assert seen["body"]["requests"][0]["propertyAddress"] == {
            "street": "1001 W NORTH AVE", "city": "Chicago", "state": "IL", "zip": "60642"}
        assert r == OwnerContactResult("John Smith", (OwnerPhone("(312) 555-0100", "Mobile", True),), ("js@x.com", "plain@x.com"), "batchdata")

    async def test_parses_flat_results_shape(self):
        handler = lambda req: httpx.Response(200, json={"results": [{
            "owner_name": "John Smith", "mobile_phone": "+1-214-555-0123", "landline_phone": "",
            "email": "js@x.com", "dnc_status": False}]})
        r = await BatchDataOwnerLookup(api_key="b", client=_client(handler)).lookup(Q)
        assert r.phones == (OwnerPhone("(214) 555-0123", "Mobile", False),)
        assert r.emails == ("js@x.com",)

    @pytest.mark.parametrize("payload", [{"results": {"persons": []}}, {"results": []}, {}, {"results": [{"owner_name": "X"}]}])
    async def test_misses(self, payload):
        r = await BatchDataOwnerLookup(api_key="b", client=_client(lambda req: httpx.Response(200, json=payload))).lookup(Q)
        assert r is None

    async def test_full_name_preferred(self):
        handler = lambda req: httpx.Response(200, json={"results": {"persons": [
            {"name": {"full": "J. SMITH", "first": "x"}, "emails": ["a@x.com"]}]}})
        r = await BatchDataOwnerLookup(api_key="b", client=_client(handler)).lookup(Q)
        assert r.person_name == "J. SMITH"


class TestOwnerChain:
    async def test_batchdata_only_on_tracerfy_miss_or_error(self):
        miss, hit = Fake("tracerfy"), Fake("batchdata", result=HIT)
        assert (await ChainedOwnerLookup([miss, hit]).lookup(Q)) is HIT
        broken = Fake("tracerfy", error=httpx.ConnectError("x"))
        assert (await ChainedOwnerLookup([broken, hit]).lookup(Q)) is HIT
        first = Fake("tracerfy", result=HIT)
        second = Fake("batchdata", result=HIT)
        await ChainedOwnerLookup([first, second]).lookup(Q)
        assert second.calls == 0

    def test_skips_unconfigured_and_factory(self, monkeypatch):
        chain = ChainedOwnerLookup([Fake("tracerfy", configured=False)])
        assert not chain.is_configured and chain.name == "none"
        monkeypatch.setattr("app.adapters.owner_lookup.settings.tracerfy_api_key", "t")
        monkeypatch.setattr("app.adapters.owner_lookup.settings.batchdata_api_key", "b")
        built = build_owner_lookup(["tracerfy", "nope", "batchdata"])
        assert built.provider_names == ("tracerfy", "batchdata") and built.name == "tracerfy+batchdata"


def _svc(result=HIT, limit=100, provider=None):
    provider = provider or Fake("tracerfy", result=result)
    svc = OwnerLookupService(
        ["tracerfy"], SlidingWindowRateLimiter(limit), OwnerResultStore(":memory:"),
        chain_factory=lambda names: ChainedOwnerLookup([provider]),
    )
    return svc, provider


class TestOwnerService:
    async def test_saves_by_normalised_address_with_date(self):
        svc, provider = _svc()
        a1 = await svc.lookup(Q, "ip")
        a2 = await svc.lookup(OwnerQuery(street="1001 w north ave ", city="chicago", state="il", zip=""), "ip")
        assert (a1.result, a1.cached) == (HIT, False) and (a2.result, a2.cached) == (HIT, True)
        assert a1.looked_up_at == a2.looked_up_at and a1.looked_up_at.endswith("Z")
        assert provider.calls == 1
        assert svc.provider_names == ("tracerfy",)

    async def test_refresh_pays_again(self):
        svc, provider = _svc()
        await svc.lookup(Q, "ip")
        again = await svc.lookup(Q, "ip", refresh=True)
        assert provider.calls == 2 and not again.cached

    async def test_miss_is_cached_and_rate_limit(self):
        svc, provider = _svc(result=None, limit=1)
        a = await svc.lookup(Q, "ip")
        assert a.result.person_name == "" and not a.result.is_hit
        await svc.lookup(Q, "ip")  # cached, not limited
        with pytest.raises(RateLimited):
            await svc.lookup(OwnerQuery(street="2 N STATE ST", city="Chicago", state="IL"), "ip")

    def test_from_settings(self, monkeypatch):
        monkeypatch.setattr("app.services.owner_lookup_service.settings.owner_lookup_providers", "Tracerfy, batchdata")
        monkeypatch.setattr("app.adapters.owner_lookup.settings.tracerfy_api_key", "t")
        monkeypatch.setattr("app.adapters.owner_lookup.settings.batchdata_api_key", "")
        assert OwnerLookupService.from_settings(OwnerResultStore(":memory:")).provider_names == ("tracerfy",)


@pytest.fixture
def client():
    svc, _ = _svc(limit=1)
    contacts.set_owner_service(svc)
    app = FastAPI()
    app.include_router(contacts.router, prefix="/api/v1")
    yield TestClient(app)
    contacts.set_owner_service(None)


class TestOwnerRoute:
    def test_returns_contacts_and_429(self, client):
        params = {"street": "1001 W NORTH AVE", "zip": "60642", "region": "il"}
        body = client.get("/api/v1/contacts/owner", params=params).json()
        assert body["looked_up_at"].endswith("Z")
        assert {k: v for k, v in body.items() if k != "looked_up_at"} == {
            "person_name": "JANE DOE",
            "phones": [{"number": "(312) 555-0100", "type": "Mobile", "dnc": False}],
            "emails": ["j@x.com"], "provider": "tracerfy", "cached": False, "dnc_checked": True, "method": "",
        }
        assert client.get("/api/v1/contacts/owner", params={"street": "2 N STATE ST"}).status_code == 429

    @pytest.mark.parametrize("params", [{}, {"street": "x", "zip": "6064"}, {"street": "x", "region": "ILL"}])
    def test_validation(self, client, params):
        assert client.get("/api/v1/contacts/owner", params=params).status_code == 422


# ---------------------------------------------------------------------------
# Provider failures are reported, never cached as misses (bug found 2026-10-02:
# Tracerfy HTTP 402 "Insufficient credits" showed as "No match" and stuck in cache).
# ---------------------------------------------------------------------------


def _status_error(code, text="x"):
    req = httpx.Request("POST", "https://example.test")
    return httpx.HTTPStatusError("boom", request=req, response=httpx.Response(code, text=text, request=req))


class TestProviderFailures:
    async def test_all_providers_failing_raises_with_last_status(self):
        chain = ChainedOwnerLookup([Fake("tracerfy", error=_status_error(402, "Insufficient credits"))])
        with pytest.raises(ProviderUnavailable) as exc:
            await chain.lookup(Q)
        assert exc.value.status == 402 and exc.value.provider == "tracerfy"
        assert "Insufficient credits" in exc.value.detail

    async def test_network_error_status_zero(self):
        with pytest.raises(ProviderUnavailable) as exc:
            await ChainedOwnerLookup([Fake("tracerfy", error=httpx.ConnectError("down"))]).lookup(Q)
        assert exc.value.status == 0

    async def test_one_real_miss_means_miss_not_error(self):
        chain = ChainedOwnerLookup([Fake("tracerfy", error=_status_error(500)), Fake("batchdata", result=None)])
        assert await chain.lookup(Q) is None

    async def test_failure_is_not_cached(self):
        svc, provider = _svc(provider=Fake("tracerfy", error=_status_error(402)))
        for _ in range(2):
            with pytest.raises(ProviderUnavailable):
                await svc.lookup(Q, "ip")
        assert provider.calls == 2  # second click retried, not served a cached "miss"

    @pytest.mark.parametrize("code,status,text", [
        (402, 402, "out of credits"),
        (401, 502, "rejected the API key"),
        (400, 502, "rejected the request: bad field"),
        (500, 502, "not responding"),
    ])
    def test_route_maps_failures(self, code, status, text):
        svc, _ = _svc(provider=Fake("tracerfy", error=_status_error(code, "bad field")))
        contacts.set_owner_service(svc)
        app = FastAPI()
        app.include_router(contacts.router, prefix="/api/v1")
        try:
            resp = TestClient(app).get("/api/v1/contacts/owner", params={"street": "1001 W NORTH AVE"})
        finally:
            contacts.set_owner_service(None)
        assert resp.status_code == status
        assert text in resp.json()["detail"]
