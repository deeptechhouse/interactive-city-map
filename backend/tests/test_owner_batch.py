"""Tests for the owner BATCH path and the permanent result store.

Tracerfy is faked with httpx.MockTransport (submit → status → CSV download); the store
runs on SQLite ":memory:" or a tmp file. No network, no credits.
"""

import os
import stat

import httpx
import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.adapters.http_json import ProviderUnavailable
from app.adapters.owner_lookup import OwnerContactResult, OwnerPhone, OwnerQuery, property_key
from app.adapters.tracerfy_batch import TracerfyBatchClient, _allowed_result_url, build_upload_csv, parse_results
from app.routes import contacts
from app.services.owner_batch_service import MAX_BATCH_ITEMS, BatchNotFound, OwnerBatchService
from app.services.owner_result_store import OwnerResultStore, now_iso
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

A = OwnerQuery(street="1001 W NORTH AVE", city="Chicago", state="IL", zip="60642")
B = OwnerQuery(street="233 S WACKER DR", city="Chicago", state="IL", zip="60606")

CSV = (
    "\ufeffaddress,city,state,mail_address,mail_city,mail_state,first_name,last_name,primary_phone,"
    "primary_phone_type,email_1,email_2,email_3,email_4,email_5,mobile_1,mobile_2,mobile_3,mobile_4,"
    "mobile_5,landline_1,landline_2,landline_3\n"
    "1001 W North Ave,Chicago,IL,,,,Jane,Doe,3125550100,mobile,j@x.com,j@x.com,,,,3125550100,3125550101,,,,"
    "3125550200,,\n"
    "233 S Wacker Dr,Chicago,IL,,,,,,,,,,,,,,,,,,,,\n"
)
RESULT_URL = "https://tracerfy.nyc3.cdn.digitaloceanspaces.com/results/abc.csv"


def fake_tracerfy(pending_polls=1, submit_status=200, csv_text=CSV, url=RESULT_URL):
    """MockTransport emulating Tracerfy's queue API. Records requests."""
    state = {"polls": 0, "requests": []}

    def handler(req: httpx.Request):
        state["requests"].append(req)
        if req.method == "POST" and req.url.path == "/v1/api/trace/":
            if submit_status != 200:
                return httpx.Response(submit_status, json={"error": "Insufficient credits"})
            return httpx.Response(200, json={"queue_id": 456, "status": "pending", "credits_per_lead": 1})
        if req.url.path == "/v1/api/queues/":
            state["polls"] += 1
            done = state["polls"] > pending_polls
            other = {"id": 1, "pending": False, "download_url": "https://x.digitaloceanspaces.com/old.csv"}
            return httpx.Response(200, json=[{"id": 456, "pending": not done, "download_url": url if done else None,
                                              "credits_deducted": 2 if done else 0}, other])
        if str(req.url) == url:
            return httpx.Response(200, text=csv_text)
        return httpx.Response(404)

    client = httpx.AsyncClient(transport=httpx.MockTransport(handler))
    return TracerfyBatchClient(api_key="t", client=client), state


# ---------------------------------------------------------------------------
# Store
# ---------------------------------------------------------------------------

class TestStore:
    def test_round_trip_with_date_and_replace(self):
        store = OwnerResultStore(":memory:")
        r = OwnerContactResult("JANE", (OwnerPhone("(312) 555-0100", "Mobile", True),), ("j@x.com",), "tracerfy", False)
        assert store.get(A) is None
        stamp = store.put(A, r, "tracerfy-batch", looked_up_at="2026-10-02T07:00:00Z")
        assert stamp == "2026-10-02T07:00:00Z"
        # Lookup is by normalised street/city/state — ZIP and case don't matter.
        assert store.get(OwnerQuery(street="1001 w north ave", city="CHICAGO", state="il")) == (r, stamp, "tracerfy-batch")
        store.put(A, OwnerContactResult(""), "miss-instant")
        assert store.get(A)[0].person_name == ""

    def test_file_is_private_and_persists(self, tmp_path):
        path = tmp_path / "sub" / "owners.sqlite3"
        OwnerResultStore(path).put(A, OwnerContactResult("JANE", emails=("j@x.com",)), "x")
        assert stat.S_IMODE(os.stat(path).st_mode) == 0o600
        assert OwnerResultStore(path).get(A)[0].person_name == "JANE"  # survives "restart"

    def test_jobs(self):
        store = OwnerResultStore(":memory:")
        assert store.get_job("nope") is None
        store.save_job("j1", {"queues": [{"queue_id": "456"}], "done": False})
        store.save_job("j1", {"queues": [{"queue_id": "456"}], "done": True})  # update in place
        assert store.get_job("j1") == {"queues": [{"queue_id": "456"}], "done": True}

    def test_method_round_trip(self):
        store = OwnerResultStore(":memory:")
        store.put(A, OwnerContactResult("J", emails=("e",), method="name"), "tracerfy-batch-normal")
        assert store.get(A)[0].method == "name"

    def test_now_iso(self):
        assert now_iso().endswith("Z") and "T" in now_iso()


# ---------------------------------------------------------------------------
# Batch client + CSV parsing
# ---------------------------------------------------------------------------

class TestBatchClient:
    async def test_submit_body_status_and_download(self):
        client, state = fake_tracerfy(pending_polls=1)
        assert await client.submit([A, B]) == "456"
        req = state["requests"][0]
        body = req.content.decode()
        assert req.headers["authorization"] == "Bearer t"
        assert req.headers["content-type"].startswith("multipart/form-data")  # JSON is refused (415)
        assert 'name="trace_type"' in body and "advanced" in body  # owner discovery (normal needs names)
        assert 'name="csv_file"; filename="buildings.csv"' in body
        assert 'name="first_name_column"' in body  # required even when blank (HTTP 400 otherwise)
        assert "address,city,state,zip,first_name,last_name,mail_address,mail_city,mail_state,mailing_zip\r\n" in body
        assert "1001 W NORTH AVE,Chicago,IL,60642,,,,,,\r\n233 S WACKER DR,Chicago,IL,60606,,,,,," in body
        first = await client.status("456")
        assert first.pending and first.download_url == ""
        done = await client.status("456")
        assert not done.pending and done.download_url == RESULT_URL and done.credits_deducted == 2
        assert "Jane" in await client.fetch_results(done.download_url)
        assert "authorization" not in state["requests"][-1].headers  # pre-signed URL: no key sent

    async def test_errors_become_provider_unavailable(self):
        client, _ = fake_tracerfy(submit_status=402)
        with pytest.raises(ProviderUnavailable) as exc:
            await client.submit([A])
        assert exc.value.status == 402
        down = TracerfyBatchClient(api_key="t", client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: (_ for _ in ()).throw(httpx.ConnectError("x")))))
        with pytest.raises(ProviderUnavailable) as exc:
            await down.status("1")
        assert exc.value.status == 0

    async def test_submit_without_queue_id(self):
        c = TracerfyBatchClient(api_key="t", client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"message": "?"}))))
        with pytest.raises(ProviderUnavailable):
            await c.submit([A])

    async def test_status_throttled_means_pending(self):
        c = TracerfyBatchClient(api_key="t", client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(429, json={"error": "Rate limit exceeded"}))))
        assert (await c.status("1")).pending
        bad = TracerfyBatchClient(api_key="t", client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(500))))
        with pytest.raises(ProviderUnavailable):
            await bad.status("1")

    async def test_status_string_fallback_and_unlisted_queue(self):
        c = TracerfyBatchClient(api_key="t", client=httpx.AsyncClient(
            transport=httpx.MockTransport(lambda r: httpx.Response(200, json={"results": [
                {"id": 1, "status": "completed", "download_url": RESULT_URL}]}))))
        assert not (await c.status("1")).pending
        assert (await c.status("999")).pending  # not listed yet → keep waiting

    @pytest.mark.parametrize("url,ok", [
        (RESULT_URL, True),
        ("https://files.tracerfy.com/x.csv", True),
        ("https://tracerfy.com/x.csv", True),
        ("http://tracerfy.nyc3.digitaloceanspaces.com/x.csv", False),  # not https
        ("https://evil.com/x.csv", False),
        ("https://tracerfy.com.evil.com/x.csv", False),
        ("https://eviltracerfy.com/x.csv", False),
    ])
    def test_result_host_allowlist(self, url, ok):
        assert _allowed_result_url(url) is ok

    async def test_refuses_foreign_download_host(self):
        client, state = fake_tracerfy()
        with pytest.raises(ProviderUnavailable):
            await client.fetch_results("https://169.254.169.254/latest/meta-data")
        assert state["requests"] == []

    def test_unconfigured(self):
        assert not TracerfyBatchClient(api_key="your_tracerfy_api_key_here").is_configured


class TestUploadCsv:
    def test_quotes_commas(self):
        text = build_upload_csv([OwnerQuery(street='1 N "A", ST', city="Chicago", state="IL")])
        assert text.splitlines()[1] == '"1 N ""A"", ST",Chicago,IL,,,,,,,'


# Real advanced-trace header (2026-10-02) — differs from the docs' spelling.
REAL_HEADER_CSV = (
    "address,city,state,zip,first_name,last_name,mail_address,mail_city,mail_state,mailing_zip,primary_phone,"
    "primary_phone_type,Email-1,Email-2,Email-3,Email-4,Email-5,Mobile-1,Mobile-2,Mobile-3,Mobile-4,Mobile-5,"
    "Landline-1,Landline-2,Landline-3\n"
    "1001 W NORTH AVE,Chicago,IL,60642,Jane,Doe,,,,,3125550100,Mobile,a@x.com,b@x.com,,,,3125550101,,,,,3125550200,,\n"
)


class TestParseResults:
    def test_real_header_spelling(self):
        r = parse_results(REAL_HEADER_CSV)[property_key("1001 W NORTH AVE", "Chicago", "IL")]
        assert [p.number for p in r.phones] == ["(312) 555-0100", "(312) 555-0101", "(312) 555-0200"]
        assert r.emails == ("a@x.com", "b@x.com")

    def test_hits_misses_dedupe_and_dnc_unchecked(self):
        out = parse_results(CSV)
        assert set(out) == {property_key("1001 W NORTH AVE", "Chicago", "IL")}  # Wacker row is a miss
        r = out[property_key("1001 w north ave", "CHICAGO", "il")]
        assert r.person_name == "Jane Doe" and r.provider == "tracerfy" and r.dnc_checked is False
        assert [(p.number, p.type, p.dnc) for p in r.phones] == [
            ("(312) 555-0100", "Mobile", False),
            ("(312) 555-0101", "Mobile", False),
            ("(312) 555-0200", "Landline", False),
        ]
        assert r.emails == ("j@x.com",)


# ---------------------------------------------------------------------------
# Batch service
# ---------------------------------------------------------------------------

def _service(**kw):
    client, state = fake_tracerfy(**kw)
    store = OwnerResultStore(":memory:")
    return OwnerBatchService(client, store, SlidingWindowRateLimiter(100, 300)), store, state


class TestBatchService:
    async def test_full_cycle_saves_hits_and_misses_with_date(self):
        svc, store, state = _service(pending_polls=1)
        started = await svc.start([A, B, A], "ip")  # duplicate A sent once
        assert started.pending and started.submitted == 2 and len(started.job_id) == 32
        assert (await svc.poll(started.job_id)).pending
        done = await svc.poll(started.job_id)
        assert not done.pending
        by_street = {r.query.street: r for r in done.results}
        assert by_street["1001 W NORTH AVE"].result.person_name == "Jane Doe"
        assert not by_street["233 S WACKER DR"].result.is_hit  # miss, still saved
        assert store.get(B)[2] == "tracerfy-batch-advanced" and store.get(B)[1].endswith("Z")
        assert store.get_job(started.job_id)["done"] is True
        # Polling a finished job is free and repeatable.
        polls = state["polls"]
        assert len((await svc.poll(started.job_id)).results) == 2
        assert state["polls"] == polls

    async def test_saved_answers_not_rebought_unless_refresh(self):
        svc, store, state = _service()
        store.put(A, OwnerContactResult("SAVED", emails=("s@x.com",)), "tracerfy-instant")
        only_saved = await svc.start([A], "ip")
        assert only_saved.job_id == "" and not only_saved.pending and only_saved.results[0].cached
        assert state["requests"] == []
        mixed = await svc.start([A, B], "ip")
        assert mixed.submitted == 1 and [r.query.street for r in mixed.results] == ["1001 W NORTH AVE"]
        refreshed = await svc.start([A], "ip", refresh=True)
        assert refreshed.submitted == 1 and refreshed.results == ()

    async def test_limits(self):
        client, _ = fake_tracerfy()
        svc = OwnerBatchService(client, OwnerResultStore(":memory:"), SlidingWindowRateLimiter(1, 300))
        await svc.start([A], "ip")
        with pytest.raises(RateLimited):
            await svc.start([B], "ip")
        many = [OwnerQuery(street=f"{i} N STATE ST", city="Chicago", state="IL") for i in range(MAX_BATCH_ITEMS + 1)]
        with pytest.raises(ValueError):
            await svc.start(many, "ip2")
        with pytest.raises(BatchNotFound):
            await svc.poll("0" * 32)
        assert svc.is_configured
        assert OwnerBatchService(client, OwnerResultStore(":memory:")).is_configured  # default limiter


# ---------------------------------------------------------------------------
# Routes
# ---------------------------------------------------------------------------

@pytest.fixture
def api():
    svc, store, state = _service(pending_polls=0)
    contacts.set_batch_service(svc)
    app = FastAPI()
    app.include_router(contacts.router, prefix="/api/v1")
    yield TestClient(app), store
    contacts.set_batch_service(None)


class TestBatchRoutes:
    def test_start_and_poll(self, api):
        client, store = api
        start = client.post("/api/v1/contacts/owner/batch", json={"items": [{"street": "1001 W NORTH AVE", "zip": "60642"}]})
        assert start.status_code == 200 and start.json()["pending"] is True
        body = client.get(f"/api/v1/contacts/owner/batch/{start.json()['job_id']}").json()
        item = body["results"][0]
        assert body["pending"] is False and item["street"] == "1001 W NORTH AVE"
        assert item["person_name"] == "Jane Doe" and item["dnc_checked"] is False and item["looked_up_at"].endswith("Z")

    @pytest.mark.parametrize("payload", [
        {"items": []},
        {"items": [{"street": ""}]},
        {"items": [{"street": "x", "zip": "123"}]},
        {"items": [{"street": "x"}] * (MAX_BATCH_ITEMS + 1)},
    ])
    def test_validation(self, api, payload):
        client, _ = api
        assert client.post("/api/v1/contacts/owner/batch", json=payload).status_code == 422

    def test_bad_and_unknown_job_ids(self, api):
        client, _ = api
        assert client.get("/api/v1/contacts/owner/batch/not-a-job").status_code == 422
        assert client.get(f"/api/v1/contacts/owner/batch/{'a' * 32}").status_code == 404

    def test_out_of_credits_and_unconfigured(self):
        svc, _, _ = _service(submit_status=402)
        app = FastAPI()
        app.include_router(contacts.router, prefix="/api/v1")
        try:
            contacts.set_batch_service(svc)
            resp = TestClient(app).post("/api/v1/contacts/owner/batch", json={"items": [{"street": "x"}]})
            assert resp.status_code == 402 and "out of credits" in resp.json()["detail"]
            contacts.set_batch_service(OwnerBatchService(TracerfyBatchClient(api_key=""), OwnerResultStore(":memory:")))
            assert TestClient(app).post("/api/v1/contacts/owner/batch", json={"items": [{"street": "x"}]}).status_code == 503
        finally:
            contacts.set_batch_service(None)

    def test_rate_limited(self):
        client_, _ = fake_tracerfy()
        contacts.set_batch_service(OwnerBatchService(client_, OwnerResultStore(":memory:"), SlidingWindowRateLimiter(1, 300)))
        app = FastAPI()
        app.include_router(contacts.router, prefix="/api/v1")
        try:
            c = TestClient(app)
            assert c.post("/api/v1/contacts/owner/batch", json={"items": [{"street": "a"}]}).status_code == 200
            assert c.post("/api/v1/contacts/owner/batch", json={"items": [{"street": "b"}]}).status_code == 429
        finally:
            contacts.set_batch_service(None)


# ---------------------------------------------------------------------------
# Name / address split (2026-10-02): named → 1-credit "normal", misses → "advanced"
# ---------------------------------------------------------------------------

import re  # noqa: E402 — kept with the split tests it serves


def multi_queue_tracerfy(csv_by_type: dict, fail_submit: dict | None = None, pending_polls: int = 0):
    """Fake Tracerfy that hands out queue ids 500, 501, … and answers each queue with the
    CSV registered for its trace_type. ``fail_submit`` = {trace_type: [status, …]} makes
    those submits fail in order."""
    state = {"submits": [], "polls": 0, "status_calls": 0}
    fail_submit = {k: list(v) for k, v in (fail_submit or {}).items()}

    def handler(req: httpx.Request):
        body = req.content.decode(errors="ignore")
        if req.method == "POST" and req.url.path == "/v1/api/trace/":
            trace = re.search(r'name="trace_type"\r\n\r\n(\w+)', body).group(1)
            if fail_submit.get(trace):
                return httpx.Response(fail_submit[trace].pop(0), json={"error": "nope"})
            qid = 500 + len(state["submits"])
            state["submits"].append({"id": qid, "trace": trace, "body": body})
            return httpx.Response(200, json={"queue_id": qid})
        if req.url.path == "/v1/api/queues/":
            state["status_calls"] += 1
            done = state["status_calls"] > pending_polls
            return httpx.Response(200, json=[
                {"id": s["id"], "pending": not done,
                 "download_url": f"https://x.digitaloceanspaces.com/{s['id']}.csv" if done else None}
                for s in state["submits"]
            ])
        m = re.match(r"/(\d+)\.csv", req.url.path)
        if m:
            sub = next(s for s in state["submits"] if s["id"] == int(m.group(1)))
            return httpx.Response(200, text=csv_by_type[sub["trace"]])
        return httpx.Response(404)

    return TracerfyBatchClient(api_key="t", client=httpx.AsyncClient(transport=httpx.MockTransport(handler))), state


HEADER = "address,city,state,first_name,last_name,primary_phone,primary_phone_type,email_1\n"
NAMED = OwnerQuery(street="5 N ELM ST", city="Chicago", state="IL", first_name="JOHN", last_name="DOE")
NAMED_WRONG = OwnerQuery(street="9 S OAK ST", city="Chicago", state="IL", first_name="NOT", last_name="OWNER")


class TestNameSplit:
    async def test_named_go_normal_unnamed_go_advanced_misses_follow_up(self):
        client, st = multi_queue_tracerfy({
            # name trace: JOHN DOE found at 5 N ELM; the wrong name at 9 S OAK misses
            "normal": HEADER + "5 N Elm St,Chicago,IL,John,Doe,3125550100,Mobile,\n",
            # address trace answers the unnamed building and the follow-up
            "advanced": HEADER + "1001 W NORTH AVE,Chicago,IL,Jane,Roe,3125550200,Mobile,\n"
                                 "9 S OAK ST,Chicago,IL,Real,Owner,3125550300,Landline,\n",
        })
        store = OwnerResultStore(":memory:")
        svc = OwnerBatchService(client, store, SlidingWindowRateLimiter(100, 300))
        started = await svc.start([NAMED, NAMED_WRONG, A], "ip")
        assert started.by_name == 2 and started.submitted == 3
        assert [s["trace"] for s in st["submits"]] == ["normal", "advanced"]
        assert "5 N ELM ST,Chicago,IL,,JOHN,DOE" in st["submits"][0]["body"]  # names sent for normal
        assert "1001 W NORTH AVE,Chicago,IL,60642,,," in st["submits"][1]["body"]  # never for advanced

        first = await svc.poll(started.job_id)  # both done; 9 S OAK → follow-up advanced queue
        assert first.pending
        assert [s["trace"] for s in st["submits"]] == ["normal", "advanced", "advanced"]
        assert "9 S OAK ST,Chicago,IL,,,," in st["submits"][2]["body"]  # follow-up: no name
        assert store.get(NAMED)[0].method == "name" and store.get(NAMED)[2] == "tracerfy-batch-normal"
        assert store.get(NAMED_WRONG) is None  # name miss is NOT saved as a miss

        done = await svc.poll(started.job_id)
        assert not done.pending and done.by_name == 2
        found = {r.query.street: r.result for r in done.results}
        assert found["9 S OAK ST"].person_name == "Real Owner" and found["9 S OAK ST"].method == "address"
        assert found["1001 W NORTH AVE"].method == "address"

    async def test_all_named_found_no_follow_up(self):
        client, st = multi_queue_tracerfy({"normal": HEADER + "5 N Elm St,Chicago,IL,John,Doe,3125550100,Mobile,\n"})
        svc = OwnerBatchService(client, OwnerResultStore(":memory:"), SlidingWindowRateLimiter(100, 300))
        started = await svc.start([NAMED], "ip")
        done = await svc.poll(started.job_id)
        assert not done.pending and len(st["submits"]) == 1

    async def test_first_submit_failure_raises_nothing_saved(self):
        client, st = multi_queue_tracerfy({}, fail_submit={"normal": [402]})
        store = OwnerResultStore(":memory:")
        svc = OwnerBatchService(client, store, SlidingWindowRateLimiter(100, 300))
        with pytest.raises(ProviderUnavailable):
            await svc.start([NAMED, A], "ip")
        assert st["submits"] == []

    async def test_second_submit_failure_becomes_follow_up(self):
        client, st = multi_queue_tracerfy(
            {"normal": HEADER, "advanced": HEADER + "1001 W NORTH AVE,Chicago,IL,Jane,Roe,3125550200,Mobile,\n"},
            fail_submit={"advanced": [500, 402]},
        )
        store = OwnerResultStore(":memory:")
        svc = OwnerBatchService(client, store, SlidingWindowRateLimiter(100, 300))
        started = await svc.start([NAMED, A], "ip")  # normal ok, advanced fails → follow-up
        assert started.pending and [s["trace"] for s in st["submits"]] == ["normal"]
        # Poll: normal done (NAMED missed → follow-up too); follow-up submit fails (402) → error raised…
        with pytest.raises(ProviderUnavailable):
            await svc.poll(started.job_id)
        job = store.get_job(started.job_id)
        assert {d["street"] for d in job["followup"]} == {"1001 W NORTH AVE", "5 N ELM ST"}
        assert job["queues"][0]["done"] is True  # progress kept
        # …next poll retries the follow-up and succeeds.
        assert (await svc.poll(started.job_id)).pending
        assert [s["trace"] for s in st["submits"]] == ["normal", "advanced"]
        done = await svc.poll(started.job_id)
        assert not done.pending
        assert {r.query.street for r in done.results} == {"1001 W NORTH AVE", "5 N ELM ST"}

    async def test_one_status_call_per_poll_for_several_queues(self):
        client, st = multi_queue_tracerfy({"normal": HEADER, "advanced": HEADER}, pending_polls=1)
        svc = OwnerBatchService(client, OwnerResultStore(":memory:"), SlidingWindowRateLimiter(100, 300))
        started = await svc.start([NAMED, A], "ip")
        await svc.poll(started.job_id)
        assert st["status_calls"] == 1

    async def test_unknown_trace_type_rejected(self):
        client, _ = multi_queue_tracerfy({})
        with pytest.raises(ValueError):
            await client.submit([A], "enhanced")


class TestNameRoute:
    @pytest.fixture
    def captured(self):
        seen = {}

        class Recorder(OwnerBatchService):
            async def start(self, queries, client_id, refresh=False):
                seen["queries"] = queries
                return await super().start(queries, client_id, refresh)

        client, _ = multi_queue_tracerfy({"normal": HEADER, "advanced": HEADER})
        contacts.set_batch_service(Recorder(client, OwnerResultStore(":memory:"), SlidingWindowRateLimiter(100, 300)))
        app = FastAPI()
        app.include_router(contacts.router, prefix="/api/v1")
        yield TestClient(app), seen
        contacts.set_batch_service(None)

    def test_valid_names_kept_bad_or_half_names_dropped(self, captured):
        client, seen = captured
        resp = client.post("/api/v1/contacts/owner/batch", json={"items": [
            {"street": "1 A ST", "first_name": "José", "last_name": "de la Cruz"},
            {"street": "2 B ST", "first_name": "JOHN", "last_name": ""},  # half → address
            {"street": "3 C ST", "first_name": "=CMD", "last_name": "X1"},  # not a name → address
            {"street": "4 D ST", "first_name": "O'BRIEN", "last_name": "Mary-Kate"},
        ]})
        assert resp.status_code == 200 and resp.json()["by_name"] == 2
        names = [(q.street, q.first_name, q.last_name) for q in seen["queries"]]
        assert names == [("1 A ST", "José", "de la Cruz"), ("2 B ST", "", ""), ("3 C ST", "", ""), ("4 D ST", "O'BRIEN", "Mary-Kate")]

    def test_name_length_limit(self, captured):
        client, _ = captured
        assert client.post("/api/v1/contacts/owner/batch", json={"items": [{"street": "x", "first_name": "A" * 61}]}).status_code == 422
