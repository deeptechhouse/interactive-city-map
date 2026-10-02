"""The map server — the whole app in one process, no Docker, no database.

PURPOSE (2026-10-02): run the map on the Mac mini (reached over Tailscale), on this laptop
(including offline in a car), or later on a private web server — with one command and
nothing heavier than Python. It serves:

    /                 the BUILT map (frontend `npm run build:local` → frontend/dist-local),
                      including the .pmtiles map data (HTTP Range requests — see
                      requirements-server.txt for why the starlette version matters)
    /api/v1/contacts/* phone + owner lookups (paid providers; keys stay on this server)
    /api/v1/contacts/export  save CSV to this machine's Desktop (local callers only)
    /health           which lookup providers have keys

What is deliberately NOT here: the PostGIS-backed endpoints (buildings, POIs, floor plans,
interiors) from app/main.py — they need the database. The map runs in "static mode" and
doesn't call them.

RUN:     ./run.sh                       (repo root; builds nothing, just serves)
DEV:     ./start_map.sh                 (Vite hot reload on :5173 + this server for /api)
ACCESS:  binds 127.0.0.1 only. Other devices reach it through `tailscale serve`
         (HTTPS, your tailnet only) — see scripts/macmini/install-autostart.sh.

ARCHITECTURE: wiring only — routes live in app/routes/, logic in app/services/.
"""

from pathlib import Path  # OO file paths, cross-platform

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware
from fastapi.staticfiles import StaticFiles

from app.config import settings
from app.routes import contacts, exports

app = FastAPI(title="City Map", version="0.2.0")

# Only needed in dev, when Vite (:5173) serves the page and this server only the API.
# The built map is same-origin, so it needs no CORS at all.
app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["GET", "POST"],
    allow_headers=["*"],
)


# O(1) time, O(1) space — n = 1 status document.
@app.get("/health")
async def health():
    return {
        "status": "ok",
        "phone_providers": list(contacts.get_phone_service().providers_for("chicago")),
        "owner_providers": list(contacts.get_owner_service().provider_names),
        "map_built": _map_dir() is not None,
    }


app.include_router(contacts.router, prefix="/api/v1")
app.include_router(exports.router, prefix="/api/v1")


# O(1) time, O(1) space — n = 1 path check.
def _map_dir() -> Path | None:
    """The built map folder, or None (dev / not built yet)."""
    if not settings.map_dist_dir:
        return None
    d = Path(settings.map_dist_dir).expanduser()
    return d if (d / "index.html").is_file() else None


# Mounted LAST so /api/* and /health win. html=True serves index.html for "/".
if (_dist := _map_dir()) is not None:
    app.mount("/", StaticFiles(directory=_dist, html=True), name="map")
