"""Base class for all data importers.

Provides common infrastructure: DB connection, HTTP client, logging,
download caching, and the download -> transform -> load pipeline.
"""

from abc import ABC, abstractmethod
from pathlib import Path
import json
import tempfile
import time

import httpx
import psycopg2
import structlog

logger = structlog.get_logger(__name__)

# Cache downloaded files here so re-runs don't re-download
CACHE_DIR = Path(tempfile.gettempdir()) / "citymap_import_cache"
CACHE_DIR.mkdir(parents=True, exist_ok=True)


class BaseImporter(ABC):
    """Abstract base class for spatial data importers.

    Subclasses must implement download(), transform(), and load().
    The run() method orchestrates the full pipeline with error handling.
    """

    # Subclasses set this for logging / cache key purposes
    layer_name: str = "unknown"

    def __init__(self, db_url: str, city_id: str, config: dict | None = None):
        self._db_url = db_url
        self._city_id = city_id
        self._config = config or {}
        self._log = logger.bind(layer=self.layer_name, city_id=city_id)

    # ------------------------------------------------------------------
    # Pipeline stages (abstract)
    # ------------------------------------------------------------------

    @abstractmethod
    def download(self) -> Path:
        """Download raw data and return the path to the cached file."""
        ...

    @abstractmethod
    def transform(self, raw_path: Path) -> list[dict]:
        """Read the raw file and return a list of dicts ready for DB insert."""
        ...

    @abstractmethod
    def load(self, records: list[dict]) -> int:
        """Bulk-insert records into the database. Return row count."""
        ...

    # ------------------------------------------------------------------
    # Orchestration
    # ------------------------------------------------------------------

    def run(self) -> int:
        """Execute the full import pipeline. Returns the number of rows loaded."""
        self._log.info("import_start")
        t0 = time.time()
        try:
            raw_path = self.download()
            records = self.transform(raw_path)
            count = self.load(records)
            elapsed = round(time.time() - t0, 1)
            self._log.info("import_complete", rows=count, elapsed_s=elapsed)
            return count
        except Exception:
            self._log.exception("import_failed")
            return 0

    # ------------------------------------------------------------------
    # Helpers available to subclasses
    # ------------------------------------------------------------------

    def _get_connection(self):
        """Return a raw psycopg2 connection (caller must close)."""
        return psycopg2.connect(self._db_url)

    def _http_get_json(self, url: str, timeout: float = 120.0) -> dict | list:
        """GET a URL and return parsed JSON."""
        self._log.info("http_get", url=url[:120])
        with httpx.Client(timeout=timeout, follow_redirects=True) as client:
            resp = client.get(url)
            resp.raise_for_status()
            return resp.json()

    def _http_post_json(self, url: str, data: str, timeout: float = 180.0) -> dict:
        """POST a body and return parsed JSON (for Overpass API)."""
        self._log.info("http_post", url=url[:120])
        with httpx.Client(timeout=timeout) as client:
            resp = client.post(url, content=data, headers={"Content-Type": "application/x-www-form-urlencoded"})
            resp.raise_for_status()
            return resp.json()

    def _cache_path(self, suffix: str = ".geojson") -> Path:
        """Return a deterministic cache file path for this layer + city."""
        return CACHE_DIR / f"{self._city_id}_{self.layer_name}{suffix}"

    def _save_json_cache(self, data, suffix: str = ".geojson") -> Path:
        """Write JSON data to cache and return the path."""
        p = self._cache_path(suffix)
        p.write_text(json.dumps(data))
        self._log.info("cached", path=str(p))
        return p

    def _load_json_cache(self, suffix: str = ".geojson"):
        """Load cached JSON if it exists, else return None."""
        p = self._cache_path(suffix)
        if p.exists():
            self._log.info("cache_hit", path=str(p))
            return json.loads(p.read_text())
        return None

    def _truncate_table(self, table: str):
        """Delete all rows for this city from a table."""
        conn = self._get_connection()
        try:
            cur = conn.cursor()
            cur.execute(f"DELETE FROM {table} WHERE city_id = %s", (self._city_id,))
            deleted = cur.rowcount
            conn.commit()
            cur.close()
            if deleted:
                self._log.info("truncated", table=table, rows=deleted)
        finally:
            conn.close()
