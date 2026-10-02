"""Tests for saving the contact-list CSV to the Desktop (routes/exports.py).

Writes go to pytest's tmp_path — never the real Desktop.
"""

import os
import stat
from datetime import datetime

import pytest
from fastapi import FastAPI
from fastapi.testclient import TestClient

from app.routes import exports
from app.routes.exports import MAX_CSV_BYTES, CsvExportWriter

FIXED = lambda: datetime(2026, 10, 2, 8, 15, 0)  # noqa: E731


@pytest.fixture
def client(tmp_path, monkeypatch):
    # TestClient reports its host as "testclient"; treat it as local for these tests only.
    monkeypatch.setattr(exports, "_LOCAL_HOSTS", exports._LOCAL_HOSTS | {"testclient"})
    exports.set_writer(CsvExportWriter(tmp_path, now=FIXED))
    app = FastAPI()
    app.include_router(exports.router, prefix="/api/v1")
    yield TestClient(app), tmp_path
    exports.set_writer(None)


class TestWriter:
    def test_writes_bom_csv_private_and_never_overwrites(self, tmp_path):
        w = CsvExportWriter(tmp_path, now=FIXED)
        first = w.write("a,b\r\n1,2")
        second = w.write("x")
        assert first.name == "contacts-2026-10-02_081500.csv"
        assert second.name == "contacts-2026-10-02_081500-2.csv"
        assert first.read_bytes() == "﻿a,b\r\n1,2".encode()
        assert stat.S_IMODE(os.stat(first).st_mode) == 0o600

    def test_missing_folder(self, tmp_path):
        with pytest.raises(FileNotFoundError):
            CsvExportWriter(tmp_path / "nope").write("x")

    def test_gives_up_after_many_collisions(self, tmp_path):
        w = CsvExportWriter(tmp_path, now=FIXED)
        for _ in range(99):
            w.write("x")
        with pytest.raises(FileExistsError):
            w.write("x")


class TestRoute:
    def test_saves_and_returns_path(self, client):
        c, folder = client
        resp = c.post("/api/v1/contacts/export", json={"csv": "Name / Address,Phone\r\nA,1"})
        assert resp.status_code == 200
        assert resp.json() == {"path": str(folder / "contacts-2026-10-02_081500.csv"), "filename": "contacts-2026-10-02_081500.csv"}
        assert (folder / "contacts-2026-10-02_081500.csv").exists()

    def test_client_cannot_choose_path(self, client):
        c, folder = client
        resp = c.post("/api/v1/contacts/export", json={"csv": "x", "path": "/etc/evil", "filename": "../../x.csv"})
        assert resp.status_code == 200 and resp.json()["filename"].startswith("contacts-")
        assert sorted(p.name for p in folder.iterdir()) == ["contacts-2026-10-02_081500.csv"]

    def test_rejects_remote_callers(self, tmp_path):
        exports.set_writer(CsvExportWriter(tmp_path, now=FIXED))
        app = FastAPI()
        app.include_router(exports.router, prefix="/api/v1")
        try:
            resp = TestClient(app).post("/api/v1/contacts/export", json={"csv": "x"})  # host "testclient"
        finally:
            exports.set_writer(None)
        assert resp.status_code == 403 and list(tmp_path.iterdir()) == []

    def test_size_limit_and_empty(self, client):
        c, _ = client
        assert c.post("/api/v1/contacts/export", json={"csv": "x" * (MAX_CSV_BYTES + 1)}).status_code == 413
        assert c.post("/api/v1/contacts/export", json={"csv": ""}).status_code == 422

    def test_disabled_and_missing_folder(self, client, monkeypatch, tmp_path):
        c, _ = client
        exports.set_writer(None)
        monkeypatch.setattr(exports.settings, "csv_export_dir", "")
        assert c.post("/api/v1/contacts/export", json={"csv": "x"}).status_code == 503
        monkeypatch.setattr(exports.settings, "csv_export_dir", str(tmp_path / "missing"))
        resp = c.post("/api/v1/contacts/export", json={"csv": "x"})
        assert resp.status_code == 503 and "not found" in resp.json()["detail"]

    def test_os_error_reported(self, client, monkeypatch):
        c, _ = client

        def boom(self, text):
            raise PermissionError(13, "Permission denied")

        monkeypatch.setattr(CsvExportWriter, "write", boom)
        resp = c.post("/api/v1/contacts/export", json={"csv": "x"})
        assert resp.status_code == 500 and "Permission denied" in resp.json()["detail"]

    def test_default_writer_uses_config_with_home_expanded(self, monkeypatch, tmp_path):
        exports.set_writer(None)
        monkeypatch.setattr(exports.settings, "csv_export_dir", "~/Desktop")
        w = exports.get_writer()
        assert w.directory == exports.Path.home() / "Desktop"
        exports.set_writer(None)
