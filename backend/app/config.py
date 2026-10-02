from pathlib import Path  # OO file paths

from pydantic_settings import BaseSettings


class Settings(BaseSettings):
    database_url: str = "postgresql+asyncpg://citymap:citymap@localhost:5433/citymap"
    database_url_sync: str = "postgresql://citymap:citymap@localhost:5433/citymap"
    martin_url: str = "http://localhost:3030"
    s3_endpoint_url: str = "http://localhost:9000"
    s3_access_key: str = "minioadmin"
    s3_secret_key: str = "minioadmin"
    s3_bucket_name: str = "citymap-tiles"
    s3_region: str = "us-east-1"
    foursquare_api_key: str = ""
    # Phone lookup for the building contact list (see app/adapters/phone_lookup.py).
    # Keys stay server-side only — never expose them through VITE_* variables.
    google_places_api_key: str = ""
    # ADJUSTABLE: provider order, first match wins; later providers are only billed when
    # earlier ones find nothing. Providers without a key are skipped.
    phone_lookup_providers: str = "foursquare,google"
    # ADJUSTABLE: per-city override, "city=prov1,prov2;city2=..." (Chicago → Google first,
    # chosen 2026-10-01 for better US business coverage).
    phone_lookup_providers_by_city: str = "chicago=google,foursquare;detroit=google,foursquare;dayton=google,foursquare"
    # ADJUSTABLE: max phone lookups per client IP per minute. Each lookup can cost money;
    # one building with many businesses uses one lookup per business.
    phone_lookup_rate_per_minute: int = 60
    # Owner skip trace (adapters/owner_lookup.py) — paid per HIT, so the UI only calls it
    # when the user presses "Find owner phone & email".
    tracerfy_api_key: str = ""
    batchdata_api_key: str = ""
    # ADJUSTABLE: provider order, first hit wins. Tracerfy only since 2026-10-02: BatchData
    # has no pay-per-call option (smallest plan $2,000/month, checked on batchdata.io/pricing).
    # Its adapter stays in owner_lookup.py — add ",batchdata" here if a plan is ever bought.
    owner_lookup_providers: str = "tracerfy"
    # ADJUSTABLE: max owner skip traces per client IP per minute (each can cost ~$0.10–0.20).
    owner_lookup_rate_per_minute: int = 20
    # ADJUSTABLE: folder the contact-list CSV is saved to (routes/exports.py). "~" is
    # expanded. Set to "" to turn saving-to-a-folder off (e.g. on a hosted server).
    csv_export_dir: str = "~/Desktop"
    # Map server (app/map_server.py). ADJUSTABLE.
    # Folder with the BUILT map (npm run build:local). "" = API only (dev, Vite serves the map).
    map_dist_dir: str = str(Path(__file__).resolve().parents[2] / "frontend" / "dist-local")
    pelias_url: str = "http://localhost:4000"
    app_env: str = "development"
    app_port: int = 8000
    app_host: str = "0.0.0.0"
    cors_origins: str = "http://localhost:5173,http://localhost:5174"

    # Read the project-root .env first, then backend/.env (later file wins), so keys work
    # whether the server is started from backend/ with either file present.
    model_config = {"env_file": ("../.env", ".env"), "env_file_encoding": "utf-8", "extra": "ignore"}


settings = Settings()
