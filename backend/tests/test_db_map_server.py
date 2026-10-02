"""Database-mode map server: /tiles and /sanborn proxies, boundary allow-list. No Docker."""

import gzip

import httpx
import pytest
from fastapi.testclient import TestClient

from app import db_map_server


@pytest.fixture
def client(monkeypatch):
    """App with Martin/MinIO replaced by an in-memory transport recording each URL."""
    seen: list[str] = []

    def handler(request: httpx.Request) -> httpx.Response:
        seen.append(str(request.url))
        if "/empty/" in request.url.path:
            return httpx.Response(204)
        if request.url.path.endswith(".jpg"):
            return httpx.Response(200, content=b"JPEG", headers={"content-type": "image/jpeg"})
        # Martin answers gzip — httpx unzips it, and the proxy must not re-announce gzip.
        return httpx.Response(
            200,
            content=gzip.compress(b"MVT"),
            headers={"content-type": "application/x-protobuf", "content-encoding": "gzip"},
        )

    fake = httpx.AsyncClient(base_url="http://martin.test", transport=httpx.MockTransport(handler))
    monkeypatch.setattr(db_map_server, "_client", fake)
    test_client = TestClient(db_map_server.app)
    test_client.seen = seen
    return test_client


def test_tile_is_proxied_without_content_encoding(client):
    resp = client.get("/tiles/buildings_lod/14/4202/6091")
    assert resp.status_code == 200
    assert resp.content == b"MVT"  # plain bytes — a forwarded "gzip" header broke every tile
    assert "content-encoding" not in resp.headers
    assert client.seen[-1] == "http://martin.test/buildings_lod/14/4202/6091"


def test_empty_tile_is_204(client):
    assert client.get("/tiles/empty/1/0/0").status_code == 204


@pytest.mark.parametrize(
    "path", ["/tiles/Bad-Name/1/0/0", "/tiles/x;drop/1/0/0", "/tiles/a/99/0/0"]
)
def test_tile_rejects_odd_sources_and_zooms(client, path):
    assert client.get(path).status_code in (404, 422)
    assert client.seen == []  # never forwarded


def test_sanborn_sheet_is_proxied_and_traversal_refused(client):
    ok = client.get("/sanborn/1906_downtown/sheet_0001.jpg")
    assert ok.status_code == 200 and ok.content == b"JPEG"
    assert client.seen[-1].endswith("/citymap-tiles/sanborn/1906_downtown/sheet_0001.jpg")
    assert client.get("/sanborn/../secret.jpg").status_code == 404
    assert client.get("/sanborn/a/..%2F..%2Fx.jpg").status_code == 404


def test_boundaries_allow_list(client):
    # Unknown layers are refused before any SQL is built (table names go into SQL text).
    assert client.get("/api/v1/cities/detroit/boundaries/buildings").status_code == 404
