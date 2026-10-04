"""Monthly counter for PAID Google Street View photos — keeps us inside Google's free tier.

PURPOSE (2026-10-02): the paid photo was switched on because Google gives 10,000 Street
View Static photos free each month. This counter stops paid photos at a cap below that
(settings.google_streetview_monthly_cap, default 9,500), so a busy month can never start
costing money. It counts photos only — no image, location or key is written.

STORAGE: backend/data/streetview_usage.json  {"month": "2026-10", "count": 123}
    One small file, 0600, written atomically (temp file + os.replace) like presets.json.
    A new calendar month starts again at 0 — in US PACIFIC time, because Google Cloud
    billing months (and the free monthly usage) run on Pacific time, not UTC.

FAIL CLOSED: only a MISSING file means "nothing used yet". A file that can't be read or
    parsed (permissions, a hand edit, disk error) blocks paid photos instead of resetting
    to 0 — a reset would allow another 9,500 on top of what was already used.

TRAP: the count is per SERVER. Two servers (e.g. this laptop and the Mac mini) using the
    same Google key each count to the cap — set a lower cap on each if both are used.
"""

from __future__ import annotations

import json
import os
import sys
import tempfile
import threading
from datetime import datetime
from pathlib import Path  # OO file paths, cross-platform
from zoneinfo import ZoneInfo  # stdlib time-zone database

DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "streetview_usage.json"


_GOOGLE_BILLING_TZ = ZoneInfo("America/Los_Angeles")  # Google bills by Pacific-time months


# O(1) time, O(1) space — n = 1 string
def _this_month() -> str:
    return datetime.now(_GOOGLE_BILLING_TZ).strftime("%Y-%m")


class StreetViewUsage:
    """Thread-safe monthly counter. O(1) time, O(1) space per call."""

    # O(1) time, O(1) space — n = 1 path
    def __init__(self, path: Path | str = DEFAULT_PATH) -> None:
        self._path = Path(path)
        self._lock = threading.Lock()

    # O(1) time, O(1) space — n = 1 small file
    def _read(self) -> dict | None:
        """This month's record, or None when the file exists but can't be trusted."""
        try:
            data = json.loads(self._path.read_text())
        except FileNotFoundError:
            return {"month": _this_month(), "count": 0}
        except (OSError, ValueError):
            return None  # unreadable / corrupt → unknown usage → fail closed
        if not isinstance(data, dict):
            return None
        if data.get("month") != _this_month():
            return {"month": _this_month(), "count": 0}
        count = data.get("count")
        if not isinstance(count, int) or isinstance(count, bool) or count < 0:
            return None
        return {"month": data["month"], "count": count}

    # O(1) time, O(1) space — n = 1 small file
    def _write(self, data: dict) -> None:
        self._path.parent.mkdir(parents=True, exist_ok=True)
        fd, tmp = tempfile.mkstemp(dir=self._path.parent, prefix=".streetview-", suffix=".json")
        try:
            with os.fdopen(fd, "w") as fh:
                json.dump(data, fh)
            os.chmod(tmp, 0o600)
            os.replace(tmp, self._path)  # atomic on the same filesystem
        except BaseException:
            Path(tmp).unlink(missing_ok=True)
            raise

    # O(1) time, O(1) space — n = 1 counter
    def used(self) -> int:
        """Paid photos fetched so far this month."""
        with self._lock:
            data = self._read()
            return sys.maxsize if data is None else data["count"]  # unknown → "over the cap"

    # O(1) time, O(1) space — n = 1 counter
    def try_spend(self, cap: int) -> bool:
        """Count one paid photo if this month is still under `cap`; False = cap reached."""
        with self._lock:
            data = self._read()
            if data is None or data["count"] >= cap:
                return False
            data["count"] += 1
            self._write(data)
            return True
