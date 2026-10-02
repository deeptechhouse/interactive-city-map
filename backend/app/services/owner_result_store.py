"""Permanent store for owner skip-trace results and batch jobs (SQLite, stdlib).

PURPOSE
    Every skip trace costs money, so an answer is saved the moment it arrives — with the
    date it was looked up — and reused forever after, across server restarts. Asked for
    2026-10-02: "items that are found should be saved/cached, including the date of
    look-up". The UI shows that date so the user can judge staleness and force a fresh
    (paid) lookup with "Search again".

    Misses are saved too (Tracerfy charges 0 for a miss, but re-asking is pointless until
    the user deliberately refreshes). Provider FAILURES are never saved — see
    http_json.ProviderUnavailable.

    Batch jobs are saved as well, so a server restart mid-batch doesn't lose the Tracerfy
    queue id (and with it, credits already spent).

PRIVACY
    This file holds personal contact data. It lives in backend/data/ (gitignored) and is
    created owner-read/write only (0600). Delete the file to wipe everything.

ARCHITECTURE
    Repository pattern: OwnerLookupService / OwnerBatchService depend on these methods,
    not on SQL. Swap for Postgres later by re-implementing this class.
"""

from __future__ import annotations

import json
import os
import sqlite3
import threading
from dataclasses import asdict
from datetime import datetime, timezone
from pathlib import Path  # OO file paths, cross-platform
from typing import Optional

from app.adapters.owner_lookup import OwnerContactResult, OwnerPhone, OwnerQuery, property_key

# ADJUSTABLE: where the store lives. ":memory:" for tests.
DEFAULT_PATH = Path(__file__).resolve().parents[2] / "data" / "owner_lookups.sqlite3"


def address_key(q: OwnerQuery) -> str:
    """Cache key for a query — see owner_lookup.property_key. O(n)."""
    return property_key(q.street, q.city, q.state)


def now_iso() -> str:
    """UTC timestamp, second precision: '2026-10-02T07:22:21Z'."""
    return datetime.now(timezone.utc).replace(microsecond=0).isoformat().replace("+00:00", "Z")


def _to_json(r: OwnerContactResult) -> str:
    return json.dumps(asdict(r))


def _from_json(text: str) -> OwnerContactResult:
    d = json.loads(text)
    return OwnerContactResult(
        person_name=d.get("person_name", ""),
        phones=tuple(OwnerPhone(**p) for p in d.get("phones", [])),
        emails=tuple(d.get("emails", [])),
        provider=d.get("provider", ""),
        dnc_checked=d.get("dnc_checked", True),
        method=d.get("method", ""),
    )


class OwnerResultStore:
    """Thread-safe SQLite repository. Each method is one indexed statement: O(1) per key
    (B-tree, so O(log n) strictly — n = saved properties)."""

    def __init__(self, path: Path | str = DEFAULT_PATH):
        self._lock = threading.Lock()  # sqlite3 connections aren't safe across threads
        if str(path) != ":memory:":
            p = Path(path)
            p.parent.mkdir(parents=True, exist_ok=True)
            if not p.exists():
                p.touch(mode=0o600)
            os.chmod(p, 0o600)
        self._db = sqlite3.connect(str(path), check_same_thread=False)
        self._db.executescript(
            """
            CREATE TABLE IF NOT EXISTS owner_results (
                address_key  TEXT PRIMARY KEY,
                result_json  TEXT NOT NULL,
                looked_up_at TEXT NOT NULL,
                source       TEXT NOT NULL
            );
            -- One row per batch. The whole job (its Tracerfy queues and the buildings in
            -- each) is one JSON document: the batch service owns its shape, the store just
            -- keeps it safe across restarts. (v2: a job can hold a name queue, an address
            -- queue and a follow-up address queue for name misses.)
            CREATE TABLE IF NOT EXISTS batch_jobs_v2 (
                job_id      TEXT PRIMARY KEY,
                state_json  TEXT NOT NULL,
                created_at  TEXT NOT NULL,
                updated_at  TEXT NOT NULL
            );
            """
        )

    # ---- results ----

    def get(self, q: OwnerQuery) -> Optional[tuple[OwnerContactResult, str, str]]:
        """(result, looked_up_at, source) or None when never looked up."""
        with self._lock:
            row = self._db.execute(
                "SELECT result_json, looked_up_at, source FROM owner_results WHERE address_key = ?",
                (address_key(q),),
            ).fetchone()
        return (_from_json(row[0]), row[1], row[2]) if row else None

    def put(self, q: OwnerQuery, result: OwnerContactResult, source: str, looked_up_at: str = "") -> str:
        """Save (replacing any older answer). Returns the timestamp stored."""
        stamp = looked_up_at or now_iso()
        with self._lock, self._db:  # `with conn` commits
            self._db.execute(
                "INSERT OR REPLACE INTO owner_results VALUES (?, ?, ?, ?)",
                (address_key(q), _to_json(result), stamp, source),
            )
        return stamp

    # ---- batch jobs ----

    def save_job(self, job_id: str, state: dict) -> None:
        """Create or replace a batch job's state (JSON-serialisable dict)."""
        now = now_iso()
        with self._lock, self._db:
            self._db.execute(
                "INSERT INTO batch_jobs_v2 VALUES (?, ?, ?, ?) "
                "ON CONFLICT(job_id) DO UPDATE SET state_json = excluded.state_json, updated_at = excluded.updated_at",
                (job_id, json.dumps(state), now, now),
            )

    def get_job(self, job_id: str) -> Optional[dict]:
        with self._lock:
            row = self._db.execute("SELECT state_json FROM batch_jobs_v2 WHERE job_id = ?", (job_id,)).fetchone()
        return json.loads(row[0]) if row else None
