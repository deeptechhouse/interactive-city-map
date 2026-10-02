"""Tests for the single-process map server (app/map_server.py).

Uses a tiny fake "built map" in tmp_path — never the real 255 MB build.
"""

import importlib

import pytest
from fastapi.testclient import TestClient


@pytest.fixture(autouse=True)
def _no_real_api_keys(monkeypatch):
    """Never let a test reach a paid provider with the real .env keys."""
    from app.config import settings

    for key in ("google_places_api_key", "foursquare_api_key", "tracerfy_api_key", "batchdata_api_key"):
        monkeypatch.setattr(settings, key, "")


def _load_server(monkeypatch, dist):
    """Re-import map_server with MAP_DIST_DIR pointed at ``dist`` ('' = API only)."""
    from app.config import settings

    monkeypatch.setattr(settings, "map_dist_dir", str(dist))
    import app.map_server as ms

    return importlib.reload(ms)


@pytest.fixture
def built_map(tmp_path):
    (tmp_path / "index.html").write_text("<!doctype html><title>City Map</title>")
    (tmp_path / "data").mkdir()
    (tmp_path / "data" / "tiles.pmtiles").write_bytes(bytes(range(256)) * 40)  # 10,240 bytes
    return tmp_path


class TestMapServer:
    def test_serves_map_page_and_health(self, monkeypatch, built_map):
        client = TestClient(_load_server(monkeypatch, built_map).app)
        assert "City Map" in client.get("/").text
        health = client.get("/health").json()
        assert health["status"] == "ok" and health["map_built"] is True
        assert health["owner_providers"] == []  # keys blanked by the fixture

    def test_pmtiles_range_requests_get_206(self, monkeypatch, built_map):
        """The whole reason requirements-server.txt pins starlette ≥ 0.39."""
        client = TestClient(_load_server(monkeypatch, built_map).app)
        resp = client.get("/data/tiles.pmtiles", headers={"Range": "bytes=0-99"})
        assert resp.status_code == 206
        assert resp.headers["content-range"] == "bytes 0-99/10240"
        assert resp.content == bytes(range(100))

    def test_api_routes_win_over_static_files(self, monkeypatch, built_map):
        client = TestClient(_load_server(monkeypatch, built_map).app)
        assert client.get("/api/v1/contacts/providers").json()["city"] == "chicago"

    def test_api_only_when_not_built(self, monkeypatch, tmp_path):
        client = TestClient(_load_server(monkeypatch, tmp_path / "missing").app)
        assert client.get("/health").json()["map_built"] is False
        assert client.get("/").status_code == 404

    def test_api_only_when_disabled(self, monkeypatch):
        client = TestClient(_load_server(monkeypatch, "").app)
        assert client.get("/health").json()["map_built"] is False

    def test_old_name_still_works(self, monkeypatch, built_map):
        _load_server(monkeypatch, built_map)
        import app.phone_app as legacy

        assert importlib.reload(legacy).app is not None
