"""The DATABASE-mode map server — the map, the full API and Martin tiles behind one port.

PURPOSE (2026-10-02): show Chicago, Detroit and Dayton from PostGIS with one command
(./run-db.sh), reachable from other devices over Tailscale exactly like the static map
server. It serves:

    /                   the database-mode build (frontend `npm run build:db` → dist-db)
    /api/v1/*           every route in app/main.py — cities, buildings, POIs, search,
                        boundaries, interiors, contacts, exports, presets
    /tiles/{table}/{z}/{x}/{y}
                        proxied to Martin (settings.martin_url, Docker :3030). The build
                        sets VITE_MARTIN_URL=/tiles, so the browser never needs to reach
                        port 3030 — over Tailscale "localhost:3030" would be the phone.
    /sanborn/{file}     Sanborn sheet images, proxied from the public MinIO bucket
                        (settings.s3_endpoint_url/<bucket>/sanborn/…) for the same reason.

Compare app/map_server.py (static mode: no database, the map reads PMTiles files).

FLOW    ./run-db.sh → docker compose up postgres martin → uvicorn app.db_map_server:app
ACCESS  binds 127.0.0.1 only (run-db.sh); other devices via `tailscale serve`.
ARCHITECTURE  wiring only: the API is app.main's app; this adds the tile proxy and the
              built map, mounted last so /api, /tiles and /health win.
"""

import re
from pathlib import Path  # OO file paths, cross-platform

import httpx
from fastapi import HTTPException
from fastapi import Path as PathParam
from fastapi.responses import Response
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.main import app

# Martin source names are PostGIS table/function names. Only these characters reach the
# upstream URL, so a request can't steer the proxy anywhere but Martin's tile paths.
_SOURCE = re.compile(r"^[a-z_][a-z0-9_]{0,62}$")

# ADJUSTABLE: upstream timeout per tile. Dense building tiles at z14 take ~1 s cold.
_TILE_TIMEOUT_S = 30.0

_client: httpx.AsyncClient | None = None


# O(1) time, O(1) space — n = 1 shared client (connection pool reused across tiles).
def _martin() -> httpx.AsyncClient:
    global _client
    if _client is None:
        _client = httpx.AsyncClient(base_url=settings.martin_url, timeout=_TILE_TIMEOUT_S)
    return _client


@app.get("/tiles/{source}/{z}/{x}/{y}")
# O(b) time, O(b) space — b = bytes of one tile (passed through, not decoded).
async def tile(
    source: str,
    z: int = PathParam(..., ge=0, le=22),
    x: int = PathParam(..., ge=0),
    y: int = PathParam(..., ge=0),
):
    """One Martin vector tile. 204 = empty tile (Martin's answer where there is no data)."""
    if not _SOURCE.match(source):
        raise HTTPException(status_code=404, detail="unknown tile source")
    try:
        upstream = await _martin().get(f"/{source}/{z}/{x}/{y}")
    except httpx.HTTPError:
        raise HTTPException(
            status_code=502, detail="Martin tile server not reachable — is Docker running?"
        )
    if upstream.status_code == 204 or not upstream.content:
        return Response(status_code=204)
    if upstream.status_code != 200:
        raise HTTPException(status_code=upstream.status_code, detail="tile not available")
    # TRAP (2026-10-02): httpx has already UNZIPPED Martin's gzip body, so Martin's
    # Content-Encoding header must NOT be forwarded — the browser would try to gunzip
    # plain bytes and fail every tile with ERR_CONTENT_DECODING_FAILED.
    return Response(
        content=upstream.content,
        media_type=upstream.headers.get("content-type", "application/x-protobuf"),
        headers={"Cache-Control": "public, max-age=300"},
    )


# Sanborn object keys: folders and files of letters, digits, _ - . only — never "..".
_SANBORN_KEY = re.compile(r"^(?!.*\.\.)[A-Za-z0-9_\-./]{1,200}$")


@app.get("/sanborn/{key:path}")
# O(b) time, O(b) space — b = bytes of one sheet image (~300 KB).
async def sanborn(key: str):
    """One Sanborn sheet from the MinIO bucket (public-read, so no credentials needed)."""
    if not _SANBORN_KEY.match(key):
        raise HTTPException(status_code=404, detail="unknown sheet")
    url = f"{settings.s3_endpoint_url}/{settings.s3_bucket_name}/sanborn/{key}"
    try:
        upstream = await _martin().get(url)  # absolute URL overrides the client's base_url
    except httpx.HTTPError:
        raise HTTPException(status_code=502, detail="Sanborn image store (MinIO) not reachable")
    if upstream.status_code != 200:
        raise HTTPException(status_code=404, detail="sheet not found")
    return Response(
        content=upstream.content,
        media_type=upstream.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "public, max-age=86400"},
    )


# O(1) time, O(1) space — n = 1 path check.
def _map_dir() -> Path | None:
    """The database-mode build folder, or None (not built yet — API only)."""
    d = Path(settings.db_map_dist_dir).expanduser()
    return d if (d / "index.html").is_file() else None


# Mounted LAST so /api/*, /tiles/* and /health win. html=True serves index.html for "/".
if (_dist := _map_dir()) is not None:
    app.mount("/", StaticFiles(directory=_dist, html=True), name="map")
