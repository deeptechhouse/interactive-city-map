"""Former name of the map server — kept as an alias so older scripts and notes that say
``app.phone_app:app`` keep working. The real app is app/map_server.py."""

from app.map_server import app  # noqa: F401 — re-exported for uvicorn "app.phone_app:app"
