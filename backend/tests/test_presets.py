"""Tests for server-side saved searches (routes/presets.py). Files go to tmp_path."""

import json
import os
import stat

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import presets
from app.routes.presets import MAX_PRESETS, PresetFileStore


def preset(i="p1", name="Vacant lots", city="chicago", **extra):
    return {"id": i, "name": name, "city": city, "savedAt": "2026-10-02T08:00:00Z",
            "state": {"layers": {"wards": True}}, "view": None, **extra}


@pytest.fixture
def client(tmp_path):
    presets.set_store(PresetFileStore(tmp_path / "presets.json"))
    app = FastAPI()
    app.include_router(presets.router, prefix="/api/v1")
    yield TestClient(app), tmp_path / "presets.json"
    presets.set_store(None)


class TestStore:
    def test_put_replace_keeps_position_delete_and_private_file(self, tmp_path):
        s = PresetFileStore(tmp_path / "sub" / "presets.json")
        assert s.list() == []
        s.put(preset("a"))
        s.put(preset("b"))
        s.put(preset("a", name="Renamed"))
        assert [(p["id"], p["name"]) for p in s.list()] == [("a", "Renamed"), ("b", "Vacant lots")]
        s.delete("a")
        s.delete("missing")  # idempotent
        assert [p["id"] for p in s.list()] == ["b"]
        assert stat.S_IMODE(os.stat(tmp_path / "sub" / "presets.json").st_mode) == 0o600
        assert not [f for f in os.listdir(tmp_path / "sub") if f.startswith(".presets-")]  # no temp leftovers

    def test_cap_drops_oldest(self, tmp_path):
        s = PresetFileStore(tmp_path / "p.json")
        for i in range(MAX_PRESETS + 3):
            s.put(preset(f"p{i}"))
        ids = [p["id"] for p in s.list()]
        assert len(ids) == MAX_PRESETS and ids[0] == "p3"

    @pytest.mark.parametrize("content", ["not json", '{"a": 1}', '[1, {"no_id": true}, {"id": "ok"}]'])
    def test_corrupt_file_degrades(self, tmp_path, content):
        f = tmp_path / "p.json"
        f.write_text(content)
        assert PresetFileStore(f).list() == ([{"id": "ok"}] if "ok" in content else [])

    def test_failed_write_leaves_old_file(self, tmp_path, monkeypatch):
        s = PresetFileStore(tmp_path / "p.json")
        s.put(preset("a"))

        def boom(*_a, **_k):
            raise OSError("disk full")

        monkeypatch.setattr(presets.json, "dump", boom)
        with pytest.raises(OSError):
            s.put(preset("b"))
        monkeypatch.undo()
        assert [p["id"] for p in s.list()] == ["a"]
        assert not [f for f in os.listdir(tmp_path) if f.startswith(".presets-")]


class TestRoutes:
    def test_round_trip(self, client):
        c, path = client
        assert c.get("/api/v1/presets").json() == {"presets": []}
        assert c.put("/api/v1/presets/p1", json=preset()).json() == {"ok": True}
        assert c.get("/api/v1/presets").json()["presets"][0]["name"] == "Vacant lots"
        assert json.loads(path.read_text())[0]["state"] == {"layers": {"wards": True}}
        assert c.delete("/api/v1/presets/p1").json() == {"ok": True}
        assert c.get("/api/v1/presets").json() == {"presets": []}

    @pytest.mark.parametrize("url,body", [
        ("/api/v1/presets/p1", preset("p2")),                 # id mismatch
        ("/api/v1/presets/p1", preset(name="")),              # empty name
        ("/api/v1/presets/p1", preset(city="../etc")),        # bad city
        ("/api/v1/presets/bad%20id", preset("bad id")),       # bad id
        ("/api/v1/presets/p1", {"id": "p1"}),                 # missing fields
    ])
    def test_rejects_bad_presets(self, client, url, body):
        c, _ = client
        assert c.put(url, json=body).status_code == 422

    def test_size_limit(self, client):
        c, _ = client
        big = preset(state={"blob": "x" * (presets.MAX_PRESET_BYTES + 10)})
        assert c.put("/api/v1/presets/p1", json=big).status_code == 413

    def test_default_store(self):
        presets.set_store(None)
        assert presets.get_store()._path == presets.DEFAULT_PATH
        presets.set_store(None)
