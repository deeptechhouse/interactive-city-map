"""Tracerfy BATCH skip trace — many properties per queue, far cheaper than Instant (5).

PURPOSE
    The map's "Look up owners" button. Two trace types, picked per building by the batch
    service (split chosen 2026-10-02):

      "normal"   — 1 credit/hit. Traces a NAMED PERSON at the address; needs first and
                   last name. Used only when we're confident of the owner's name.
      "advanced" — 2 credits/hit. Discovers the OWNER from the address alone (Tracerfy
                   docs: "Advanced discovers the owner from an address"). "normal" sent
                   with blank names matched nothing live (1001 W North Ave) — so every
                   building without a trusted name goes here.

    Both: 0 credits on a miss (verified for normal: queue 183683, credits_deducted 0).
    At $20 per 1,000 credits ⇒ ≈ $0.02 (normal) / $0.04 (advanced) per owner found.

    TRADE-OFF — Do-Not-Call: the documented batch result CSV has NO dnc / tcpa /
    litigator columns. Every result from here is marked ``dnc_checked=False`` and the UI
    and CSV say "DNC not checked". Never present these numbers as safe to cold-call.

FLOW (driven by services/owner_batch_service.py)
    submit(queries)          POST https://tracerfy.com/v1/api/trace/    → queue_id
    status(queue_id)         GET  https://tracerfy.com/v1/api/queues/   → find our queue → pending / download_url
                             (NOT /queue/:id — despite the docs' first example, that
                             returns the queue's matched RECORDS as a list; verified live)
    fetch_results(url)       GET  download_url (CSV)                   → rows
    parse_results(csv_text)  rows → {address_key: OwnerContactResult}

SUBMIT FORMAT — verified live 2026-10-02: a JSON body is refused with HTTP 415
    "Unsupported media type application/json". The endpoint takes multipart/form-data:
    column-mapping fields as form fields + the rows as a ``csv_file`` upload (built in
    memory — nothing written to disk). If Tracerfy rejects a submit, its 4xx reason is
    surfaced to the UI verbatim (via ProviderUnavailable).
"""

from __future__ import annotations

import csv
import io
from dataclasses import dataclass
from typing import Optional
from urllib.parse import urlparse

import httpx

from app.adapters.http_json import TIMEOUT_S, ProviderUnavailable, real_key
from app.adapters.owner_lookup import OwnerContactResult, OwnerPhone, OwnerQuery, digits_phone, property_key
from app.config import settings

_BASE = "https://tracerfy.com/v1/api"

# Result-file domains we will download from (the domain itself or any subdomain). The
# URL comes from Tracerfy's API response; restricting it stops an odd/tampered response
# from making our server fetch an arbitrary URL (SSRF).
# ADJUSTABLE: add a domain if Tracerfy moves its file storage.
_ALLOWED_RESULT_DOMAINS = ("digitaloceanspaces.com", "tracerfy.com")


def _allowed_result_url(url: str) -> bool:
    """https and host is an allowed domain or a subdomain of one. O(d)."""
    parsed = urlparse(url)
    host = (parsed.hostname or "").lower()
    return parsed.scheme == "https" and any(host == d or host.endswith(f".{d}") for d in _ALLOWED_RESULT_DOMAINS)

# Result CSV phone columns, best first. Names are matched after _norm_col(): the real
# advanced-trace file (2026-10-02) says "Email-1"/"Mobile-1"/"Landline-1", while the docs
# list "email_1"/"mobile_1" — case and "-" vs "_" are ignored so either spelling works.
_PHONE_COLUMNS = (
    ("primary_phone", None),  # type comes from primary_phone_type
    *((f"mobile_{i}", "Mobile") for i in range(1, 6)),
    *((f"landline_{i}", "Landline") for i in range(1, 4)),
)
_EMAIL_COLUMNS = tuple(f"email_{i}" for i in range(1, 6))


# Credits charged per HIT (0 on a miss), Tracerfy docs 2026-10-02.
TRACE_CREDITS = {"normal": 1, "advanced": 2}

# ADJUSTABLE: seconds between status checks. Tracerfy answers 429 below ~20 s.
STATUS_POLL_SECONDS = 30


@dataclass(frozen=True)
class QueueStatus:
    pending: bool
    download_url: str
    credits_deducted: int


class TracerfyBatchClient:
    """Thin HTTP client for Tracerfy's queue API. No caching / bookkeeping — the
    batch service owns that."""

    def __init__(self, api_key: str = "", client: Optional[httpx.AsyncClient] = None):
        self._api_key = real_key(api_key or settings.tracerfy_api_key)
        self._client = client

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def _headers(self) -> dict:
        return {"Authorization": f"Bearer {self._api_key}", "Accept": "application/json"}

    async def _request(self, method: str, url: str, **kw) -> httpx.Response:
        """One HTTP call; any 4xx/5xx/network error becomes ProviderUnavailable so the
        route can say exactly what went wrong (e.g. 402 out of credits)."""
        try:
            if self._client is not None:
                resp = await self._client.request(method, url, **kw)
            else:
                async with httpx.AsyncClient(timeout=TIMEOUT_S * 3) as c:  # CSVs can be large
                    resp = await c.request(method, url, **kw)
            resp.raise_for_status()
            return resp
        except httpx.HTTPStatusError as err:
            raise ProviderUnavailable("tracerfy", err.response.status_code, err.response.text) from err
        except httpx.HTTPError as err:
            raise ProviderUnavailable("tracerfy", 0, str(err)) from err

    async def submit(self, queries: list[OwnerQuery], trace_type: str = "advanced") -> str:
        """Create a queue for ``queries``. Returns Tracerfy's queue id. O(q).

        trace_type "normal" sends each query's first/last name; "advanced" ignores them.
        """
        if trace_type not in TRACE_CREDITS:
            raise ValueError(f"Unknown trace_type {trace_type!r}")
        fields = {
            "address_column": "address",
            "city_column": "city",
            "state_column": "state",
            "zip_column": "zip",
            # Required for every trace type (HTTP 400 "first_name_column is required for
            # normal … traces", verified 2026-10-02) — blank columns are fine for advanced.
            "first_name_column": "first_name",
            "last_name_column": "last_name",
            "mail_address_column": "mail_address",
            "mail_city_column": "mail_city",
            "mail_state_column": "mail_state",
            "mailing_zip_column": "mailing_zip",
            "trace_type": trace_type,  # see module doc
        }
        csv_text = build_upload_csv(queries, with_names=trace_type == "normal")
        upload = {"csv_file": ("buildings.csv", csv_text.encode("utf-8"), "text/csv")}
        resp = await self._request("POST", f"{_BASE}/trace/", headers=self._headers(), data=fields, files=upload)
        data = resp.json()
        queue_id = data.get("queue_id") or data.get("id")
        if queue_id is None:
            raise ProviderUnavailable("tracerfy", 502, f"No queue id in response: {str(data)[:200]}")
        return str(queue_id)

    async def status(self, queue_id: str) -> QueueStatus:
        """Status of one queue — see statuses()."""
        return (await self.statuses([queue_id]))[str(queue_id)]

    async def statuses(self, queue_ids: list[str]) -> dict[str, QueueStatus]:
        """Status of several queues from ONE list call (newest first, ≤100 per page).
        One call, not one per queue: Tracerfy rate-limits this endpoint to roughly one
        request per 20 s, so a name queue + an address queue must share a single check.

        O(k + q) — k = queues listed, q = ids asked. A just-submitted queue is always on
        page 1; one that isn't listed (yet) — or a throttled check — counts as pending.
        """
        still = {str(q): QueueStatus(True, "", 0) for q in queue_ids}
        try:
            resp = await self._request("GET", f"{_BASE}/queues/", headers=self._headers())
        except ProviderUnavailable as err:
            # Tracerfy throttles status checks ("Retry in intervals of 20 seconds", seen
            # live 2026-10-02). Being told "too soon" just means: still pending.
            if err.status == 429:
                return still
            raise
        data = resp.json()
        listed = {str(q.get("id")): q for q in (data if isinstance(data, list) else data.get("results", []))}
        out = dict(still)
        for qid in still:  # O(q)
            d = listed.get(qid)
            if d is None:
                continue
            pending = bool(d.get("pending")) if "pending" in d else str(d.get("status", "")).lower() != "completed"
            out[qid] = QueueStatus(pending, str(d.get("download_url") or ""), int(d.get("credits_deducted") or 0))
        return out

    async def fetch_results(self, download_url: str) -> str:
        """Download the result CSV — only from Tracerfy's storage hosts (SSRF guard)."""
        if not _allowed_result_url(download_url):
            host = urlparse(download_url).hostname or download_url[:80]
            raise ProviderUnavailable("tracerfy", 502, f"Unexpected result file host: {host}")
        resp = await self._request("GET", download_url)  # pre-signed URL: no auth header
        return resp.text


def build_upload_csv(queries: list[OwnerQuery], with_names: bool = False) -> str:
    """The rows Tracerfy traces, as CSV text (csv module handles quoting/commas). O(q).
    Names are written only for a "normal" (by-name) queue."""
    buf = io.StringIO()
    writer = csv.writer(buf)
    writer.writerow(["address", "city", "state", "zip", "first_name", "last_name", "mail_address", "mail_city", "mail_state", "mailing_zip"])
    for q in queries:  # O(q)
        first, last = (q.first_name.strip(), q.last_name.strip()) if with_names else ("", "")
        writer.writerow([q.street, q.city, q.state, q.zip, first, last, "", "", "", ""])
    return buf.getvalue()


def _norm_col(name: str) -> str:
    """'Email-1' / 'email_1' / ' EMAIL 1 ' → 'email_1'. O(n)."""
    return "_".join(name.strip().lower().replace("-", " ").replace("_", " ").split())


def parse_results(csv_text: str, method: str = "address") -> dict[str, OwnerContactResult]:
    """Result CSV → {property_key: OwnerContactResult}. Rows without any phone or email
    are skipped (misses). All results are dnc_checked=False — see module doc.
    ``method`` ("address" | "name") is recorded on each result so the UI can say how the
    person was found.

    O(r · c) — r rows × c columns (c is fixed ≈ 23, so effectively O(r)).
    """
    out: dict[str, OwnerContactResult] = {}
    for raw in csv.DictReader(io.StringIO(csv_text.lstrip("\ufeff"))):  # O(r)
        row = {_norm_col(k): (v or "") for k, v in raw.items() if k}
        phones: list[OwnerPhone] = []
        seen: set[str] = set()
        for col, kind in _PHONE_COLUMNS:  # O(9)
            number = digits_phone(row.get(col))
            if not number or number in seen:
                continue
            seen.add(number)
            label = (row.get("primary_phone_type") or "").strip().title() if kind is None else kind
            phones.append(OwnerPhone(number, label, dnc=False))
        emails = tuple(dict.fromkeys(e.strip() for c in _EMAIL_COLUMNS if (e := row.get(c) or "").strip()))
        if not phones and not emails:
            continue
        name = " ".join(x for x in ((row.get("first_name") or "").strip(), (row.get("last_name") or "").strip()) if x)
        out[property_key(row.get("address", ""), row.get("city", ""), row.get("state", ""))] = OwnerContactResult(
            person_name=name, phones=tuple(phones), emails=emails, provider="tracerfy", dnc_checked=False,
            method=method,
        )
    return out
