"""Saved searches (presets), stored on the map server so they persist.

WHY (2026-10-02): presets lived only in the browser's localStorage, which is keyed by the
exact address *including the port*. Switching from the dev server (:5173) to the map
server (:8000), run.sh falling back to :8001, or opening the map from another device over
Tailscale each showed an empty list — presets "disappeared". Kept here, every browser that
uses this server sees the same presets, across restarts.

API (one preset at a time, so two devices editing can't overwrite each other's lists):
    GET    /api/v1/presets            → {"presets": [...]}  all cities, save order
    PUT    /api/v1/presets/{id}       → create or replace that preset
    DELETE /api/v1/presets/{id}       → remove it (absent is fine — idempotent)

The preset body is the frontend's SavedSearch object (frontend/src/presets/savedSearches.ts).
The server checks shape and size only; it never interprets the filter snapshot inside.

STORAGE: backend/data/presets.json (same gitignored, owner-only folder as saved owner
lookups), written atomically (temp file + rename) so a crash can't leave half a file.
"""

from __future__ import annotations

import json
import os
import tempfile
import threading
from pathlib import Path  # OO file paths, cross-platform
from typing import Any, Optional

from fastapi import APIRouter, HTTPException, Path as PathParam
from pydantic import BaseModel, Field

router = APIRouter(tags=["presets"])

# ADJUSTABLE: limits that keep one bad request from filling the disk. A preset is
# ~1–3 KB; the frontend already caps the list at 200 (savedSearches.ts MAX_PRESETS).
MAX_PRESETS = 200
MAX_PRESET_BYTES = 64 * 1024
DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "presets.json"

_ID = r"^[A-Za-z0-9_-]{1,64}$"


class Preset(BaseModel):
    """Shape check only — `state` and `view` are the frontend's business."""

    id: str = Field(..., pattern=_ID)
    name: str = Field(..., min_length=1, max_length=80)
    city: str = Field(..., pattern=r"^[a-z_-]{1,40}$")
    savedAt: str = Field(..., max_length=40)
    state: dict[str, Any]
    view: Optional[dict[str, Any]] = None


class PresetFileStore:
    """Presets in one JSON file. Thread-safe; every write is atomic.

    O(p) time, O(p) space per call — p = presets (≤ MAX_PRESETS).
    """

    # O(1) time, O(1) space — n = 1 path.
    def __init__(self, path: Path | str = DEFAULT_PATH):
        self._path = Path(path)
        self._lock = threading.Lock()

    # O(p) time, O(p) space — p = presets.
    def _read(self) -> list[dict]:
        try:
            data = json.loads(self._path.read_text(encoding="utf-8"))
        except FileNotFoundError:
            return []
        except (OSError, ValueError):
            return []  # unreadable/corrupt → start empty rather than break the map
        # O(p) time, O(p) space — p = presets in the file.
        return [p for p in data if isinstance(p, dict) and isinstance(p.get("id"), str)] if isinstance(data, list) else []

    # O(p) time, O(p) space — p = presets.
    def _write(self, presets: list[dict]) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, prefix=".presets-", suffix=".json")
        try:
            with os.fdopen(fd, "w", encoding="utf-8") as fh:
                json.dump(presets, fh, ensure_ascii=False)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self._path)  # atomic on the same filesystem
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    # O(p) time, O(p) space — p = presets.
    def list(self) -> list[dict]:
        with self._lock:
            return self._read()

    # O(p) time, O(p) space — p = presets.
    def put(self, preset: dict) -> None:
        """Replace by id (keeping its position) or append; oldest dropped past the cap."""
        with self._lock:
            presets = self._read()
            # O(p) time, O(1) space — p = presets.
            idx = next((i for i, p in enumerate(presets) if p.get("id") == preset["id"]), None)
            if idx is None:
                presets.append(preset)
            else:
                presets[idx] = preset
            self._write(presets[-MAX_PRESETS:])

    # O(p) time, O(p) space — p = presets.
    def delete(self, preset_id: str) -> None:
        with self._lock:
            presets = self._read()
            # O(p) time, O(p) space — p = presets.
            kept = [p for p in presets if p.get("id") != preset_id]
            if len(kept) != len(presets):
                self._write(kept)


_store: Optional[PresetFileStore] = None


# O(1) time, O(1) space — n = 1 store.
def get_store() -> PresetFileStore:
    global _store
    if _store is None:
        _store = PresetFileStore()
    return _store


# O(1) time, O(1) space — n = 1 store.
def set_store(store: Optional[PresetFileStore]) -> None:
    """Test hook (None resets to the default file)."""
    global _store
    _store = store


# O(p) time, O(p) space — p = presets.
@router.get("/presets")
async def list_presets():
    return {"presets": get_store().list()}


# O(p) time, O(p) space — p = presets.
@router.put("/presets/{preset_id}")
async def put_preset(body: Preset, preset_id: str = PathParam(..., pattern=_ID)):
    if body.id != preset_id:
        raise HTTPException(status_code=422, detail="Preset id in the URL and body differ.")
    data = body.model_dump()
    if len(json.dumps(data)) > MAX_PRESET_BYTES:
        raise HTTPException(status_code=413, detail="Preset is too large.")
    get_store().put(data)
    return {"ok": True}


# O(p) time, O(p) space — p = presets.
@router.delete("/presets/{preset_id}")
async def delete_preset(preset_id: str = PathParam(..., pattern=_ID)):
    get_store().delete(preset_id)
    return {"ok": True}
