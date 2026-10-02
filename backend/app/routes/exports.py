"""Save the contact-list CSV to the user's Desktop (asked for 2026-10-02).

PURPOSE
    A web page can't choose where a file goes — browser downloads land in ~/Downloads.
    This local server can, so the map sends the finished CSV here and it's written to
    ``settings.csv_export_dir`` (default ~/Desktop). Triggered automatically when an owner
    batch finishes, and by the "Export CSV" button.

SECURITY — this endpoint WRITES FILES, so it is deliberately narrow:
    * local callers only (127.0.0.1 / ::1) — the lookup server binds to 127.0.0.1 too
      (start_map.sh), this is a second lock;
    * the client sends CSV TEXT only — never a path or filename. The server picks the
      folder (config) and the name (timestamp), so there is no path traversal surface;
    * size-capped, never overwrites (a "-2", "-3"… suffix instead), created 0600 because
      it contains personal contact data;
    * disabled entirely when CSV_EXPORT_DIR is set to "" (e.g. a hosted deployment).

FLOW
    POST /api/v1/contacts/export {"csv": "..."} → CsvExportWriter.write() → {"path", "filename"}
"""

from __future__ import annotations

import os
from datetime import datetime
from pathlib import Path  # OO file paths, cross-platform
from typing import Optional

from fastapi import APIRouter, HTTPException, Request
from pydantic import BaseModel, Field

from app.config import settings

router = APIRouter(tags=["exports"])

# ADJUSTABLE: largest CSV accepted. A 500-building list with owners + businesses is
# ~300 KB; 5 MB leaves lots of headroom while stopping accidental/hostile huge writes.
MAX_CSV_BYTES = 5 * 1024 * 1024

_LOCAL_HOSTS = frozenset({"127.0.0.1", "::1", "localhost"})


class CsvExportWriter:
    """Writes CSV text to one fixed folder with server-chosen, non-colliding names."""

    def __init__(self, directory: Path, now=datetime.now):
        self._dir = directory
        self._now = now  # injectable clock for tests

    @property
    def directory(self) -> Path:
        return self._dir

    def write(self, csv_text: str) -> Path:
        """Create ``contacts-YYYY-MM-DD_HHMMSS[-n].csv``. O(size of csv_text).

        Opened with O_CREAT|O_EXCL so an existing file is never overwritten, even if two
        exports land in the same second (the loop then tries the next suffix).
        """
        if not self._dir.is_dir():
            raise FileNotFoundError(str(self._dir))
        stem = f"contacts-{self._now().strftime('%Y-%m-%d_%H%M%S')}"
        data = ("﻿" + csv_text).encode("utf-8")  # BOM: Excel reads UTF-8 names correctly
        for n in range(1, 100):  # O(1) in practice — collisions need same-second exports
            path = self._dir / (f"{stem}.csv" if n == 1 else f"{stem}-{n}.csv")
            try:
                fd = os.open(path, os.O_WRONLY | os.O_CREAT | os.O_EXCL, 0o600)
            except FileExistsError:
                continue
            with os.fdopen(fd, "wb") as fh:
                fh.write(data)
            return path
        raise FileExistsError(f"Too many exports named {stem}")


_writer: Optional[CsvExportWriter] = None


def get_writer() -> Optional[CsvExportWriter]:
    """None when exports are disabled (CSV_EXPORT_DIR="")."""
    global _writer
    if _writer is None and settings.csv_export_dir:
        _writer = CsvExportWriter(Path(settings.csv_export_dir).expanduser())
    return _writer


def set_writer(writer: Optional[CsvExportWriter]) -> None:
    """Test hook."""
    global _writer
    _writer = writer


class ExportRequest(BaseModel):
    csv: str = Field(..., min_length=1)


@router.post("/contacts/export")
async def export_csv(request: Request, body: ExportRequest):
    """Save the contact-list CSV to the export folder (Desktop). Local callers only."""
    host = request.client.host if request.client else ""
    if host not in _LOCAL_HOSTS:
        raise HTTPException(status_code=403, detail="Saving files is only allowed from this computer.")
    writer = get_writer()
    if writer is None:
        raise HTTPException(status_code=503, detail="Saving to a folder is turned off (CSV_EXPORT_DIR).")
    if len(body.csv.encode("utf-8")) > MAX_CSV_BYTES:
        raise HTTPException(status_code=413, detail="Contact list is too large to save in one file.")
    try:
        path = writer.write(body.csv)
    except FileNotFoundError:
        raise HTTPException(status_code=503, detail=f"Export folder not found: {writer.directory}")
    except OSError as err:
        raise HTTPException(status_code=500, detail=f"Could not save the file: {err.strerror or err}")
    return {"path": str(path), "filename": path.name}
