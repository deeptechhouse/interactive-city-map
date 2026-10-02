"""Paid lookups must never run for a request that names the wrong city (2026-10-02).

Two layers are tested: the pure checks in place_guard, and the routes refusing a
contradictory request with 422 BEFORE any (paid) service is called.
"""

from types import SimpleNamespace

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import contacts
from app.services.place_guard import check_city_slug, check_point, check_zip

CHICAGO = (41.88, -87.63)
DETROIT = (42.33, -83.05)  # 1331 Broadway St area
DAYTON = (39.76, -84.24)


class TestChecks:
    def test_point_in_its_own_city_passes(self):
        assert check_point("Chicago", "IL", *CHICAGO) is None
        assert check_point("Detroit", "MI", *DETROIT) is None
        assert check_point("Dayton", "OH", *DAYTON) is None

    def test_point_in_another_city_is_refused(self):
        assert "wrong city" in check_point("Chicago", "IL", *DETROIT)
        assert "wrong city" in check_point("Detroit", "MI", *DAYTON)
        assert "wrong city" in check_point("Dayton", "OH", *CHICAGO)

    def test_unknown_city_or_no_coordinates_passes(self):
        # Owner-company lookups search the company's own (any) city and send no point.
        assert check_point("Schaumburg", "IL", *DETROIT) is None
        assert check_point("Chicago", "IL", None, None) is None

    def test_zip_must_match_state(self):
        assert check_zip("MI", "48226") is None
        assert check_zip("IL", "60642") is None
        assert check_zip("OH", "45406") is None
        assert "wrong state" in check_zip("IL", "48226")
        assert "wrong state" in check_zip("MI", "60642")
        assert check_zip("IL", "") is None and check_zip("TX", "48226") is None

    def test_city_slug_must_match_point(self):
        assert check_city_slug("detroit", *DETROIT) is None
        assert "wrong city" in check_city_slug("chicago", *DETROIT)
        assert check_city_slug("gotham", *DETROIT) is None


class _Boom:
    """A service that fails the test if it is ever called — i.e. if money would be spent."""

    is_configured = True

    def __getattr__(self, name):
        raise AssertionError(f"paid service called: {name}")


@pytest.fixture
def client():
    app = FastAPI()
    app.include_router(contacts.router, prefix="/api/v1")
    contacts.set_phone_service(_Boom())
    contacts.set_owner_service(_Boom())
    contacts.set_batch_service(_Boom())
    yield TestClient(app)
    contacts.set_phone_service(None)
    contacts.set_owner_service(None)
    contacts.set_batch_service(None)


class TestRoutesRefuseBeforeSpending:
    def test_phone_lookup_wrong_city_point(self, client):
        r = client.get("/api/v1/contacts/phone", params={
            "name": "Shop", "address": "1331 BROADWAY ST", "city": "chicago",
            "locality": "Chicago", "region": "IL", "lat": DETROIT[0], "lon": DETROIT[1],
        })
        assert r.status_code == 422 and "wrong city" in r.json()["detail"]

    def test_phone_lookup_wrong_slug(self, client):
        r = client.get("/api/v1/contacts/phone", params={
            "name": "Shop", "address": "1331 BROADWAY ST", "city": "chicago",
            "locality": "Detroit", "region": "MI", "lat": DETROIT[0], "lon": DETROIT[1],
        })
        assert r.status_code == 422

    def test_instant_owner_lookup_wrong_state_zip(self, client):
        r = client.get("/api/v1/contacts/owner", params={
            "street": "1331 BROADWAY ST", "locality": "Chicago", "region": "IL", "zip": "48226",
        })
        assert r.status_code == 422 and "wrong state" in r.json()["detail"]

    def test_batch_with_one_wrong_item_spends_nothing(self, client):
        r = client.post("/api/v1/contacts/owner/batch", json={"items": [
            {"street": "1001 W NORTH AVE", "zip": "60642"},                      # Chicago, ok
            {"street": "1331 BROADWAY ST", "zip": "48226"},                      # defaults to IL → wrong
        ]})
        assert r.status_code == 422 and "1331 BROADWAY ST" in r.json()["detail"]


def test_matching_requests_still_reach_the_service():
    """The guard must not block legitimate lookups (Chicago default path unchanged)."""
    captured = []

    class Svc:
        is_configured = True

        # O(q) time, O(q) space — q = queries recorded
        async def start(self, queries, client_id, refresh=False):
            captured.extend(queries)
            return SimpleNamespace(job_id="a" * 32, pending=True, submitted=len(queries),
                                   by_name=0, results=[])

    app = FastAPI()
    app.include_router(contacts.router, prefix="/api/v1")
    contacts.set_batch_service(Svc())
    try:
        r = TestClient(app).post("/api/v1/contacts/owner/batch", json={"items": [
            {"street": "1001 W NORTH AVE", "zip": "60642"},
            {"street": "1331 BROADWAY ST", "zip": "48226", "city": "Detroit", "state": "MI"},
            {"street": "100 SAMPLE AVE", "zip": "45417", "city": "Dayton", "state": "OH"},
        ]})
        assert r.status_code == 200
        assert [(q.city, q.state) for q in captured] == [("Chicago", "IL"), ("Detroit", "MI"), ("Dayton", "OH")]
    finally:
        contacts.set_batch_service(None)
