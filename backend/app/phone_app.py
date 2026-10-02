"""Phone-lookup-only API server — the contact list's phone numbers without Docker.

PURPOSE
    The full backend (app/main.py) imports every route, and those pull in PostGIS,
    OpenCV, Playwright and friends, so it needs the Docker stack. The contact list's
    phone lookup needs none of that: just the API keys and an HTTP client. This app
    mounts ONLY the contacts router, so it starts with four small packages and lets the
    static-mode map (VITE_STATIC_MODE=true) get phone numbers.

    Same router, same service, same cache + rate limit as the full backend — not a fork.

RUN (from backend/):
    .venv-phone/bin/uvicorn app.phone_app:app --port 8000
    Keys are read from ../.env (project root) and/or backend/.env — see config.py.
"""

from fastapi import FastAPI
from fastapi.middleware.cors import CORSMiddleware

from app.config import settings
from app.routes import contacts, exports

app = FastAPI(title="City Map — phone lookup", version="0.1.0")

app.add_middleware(
    CORSMiddleware,
    allow_origins=settings.cors_origins.split(","),
    allow_methods=["GET", "POST"],  # POST = start an owner batch
    allow_headers=["*"],
)


@app.get("/health")
async def health():
    return {
        "status": "ok",
        "phone_providers": list(contacts.get_phone_service().providers_for("chicago")),
        "owner_providers": list(contacts.get_owner_service().provider_names),
    }


app.include_router(contacts.router, prefix="/api/v1")
app.include_router(exports.router, prefix="/api/v1")  # save CSV to the Desktop
