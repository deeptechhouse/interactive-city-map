"""Owner skip trace — BATCH path: the map's "Look up owners" button.

SPLIT (chosen 2026-10-02): each building goes to the cheapest trace that can work.
    * trusted PERSON name supplied (individual owner, or a contact person the user typed)
        → Tracerfy "normal" queue, 1 credit if found
    * no name (company / trust / truncated or unclear county name)
        → Tracerfy "advanced" queue, 2 credits if found (owner discovery from the address)
    * a name lookup that MISSES (free) is automatically re-sent in a follow-up "advanced"
      queue — so a wrong or stale name never leaves an owner unlooked-up.
    The frontend decides which names are trustworthy (contacts/ownerNames.ts); a WRONG
    name that happens to match someone at the address is a paid wrong hit — that is why
    names are only sent when confident.

FLOW
    POST /contacts/owner/batch  → start(queries, refresh)
        saved answers come back at once (free, unless refresh)
        the rest: one "normal" queue and/or one "advanced" queue → job saved → job_id
    GET  /contacts/owner/batch/{job_id} → poll(job_id)          (UI polls every ~30 s)
        * one Tracerfy status call covers all the job's queues (it's rate-limited)
        * a finished queue → results saved with today's date; normal misses → follow-up
        * when every queue is done and no follow-up is outstanding → all results returned
        * polling a finished job just re-reads the store (free, idempotent)

JOB STATE (saved as one JSON document by OwnerResultStore, survives restarts):
    {"items": [...all queries...],
     "queues": [{"queue_id", "trace_type", "items": [...], "done": bool}, ...],
     "followup": [...queries still to send as "advanced" (submit failed / pending)...],
     "done": bool}
"""

from __future__ import annotations

import uuid
from dataclasses import dataclass
from typing import Optional

from app.adapters.http_json import ProviderUnavailable
from app.adapters.owner_lookup import OwnerContactResult, OwnerQuery, property_key
from app.adapters.tracerfy_batch import TracerfyBatchClient, parse_results
from app.services.owner_result_store import OwnerResultStore
from app.services.phone_lookup_service import RateLimited, SlidingWindowRateLimiter

# ADJUSTABLE: max properties per batch — caps what one click can spend
# (500 × 2 credits × $0.02 ≈ $20 worst case).
MAX_BATCH_ITEMS = 500

_MISS = OwnerContactResult(person_name="")
_METHOD = {"normal": "name", "advanced": "address"}


@dataclass(frozen=True)
class BatchItemResult:
    query: OwnerQuery
    result: OwnerContactResult  # miss = no phones/emails
    looked_up_at: str
    cached: bool  # answered from the store (nothing charged by this request)


@dataclass(frozen=True)
class BatchStatus:
    job_id: str  # '' when everything was already saved (no queue needed)
    pending: bool
    results: tuple[BatchItemResult, ...]  # saved answers so far (all of them once done)
    submitted: int  # properties sent to Tracerfy in this job
    by_name: int = 0  # of those, sent as a 1-credit name trace


class BatchNotFound(Exception):
    pass


def _to_dict(q: OwnerQuery) -> dict:
    return {
        "street": q.street, "city": q.city, "state": q.state, "zip": q.zip,
        "first_name": q.first_name, "last_name": q.last_name,
    }


def _from_dict(d: dict) -> OwnerQuery:
    return OwnerQuery(
        street=d["street"], city=d["city"], state=d["state"], zip=d.get("zip", ""),
        first_name=d.get("first_name", ""), last_name=d.get("last_name", ""),
    )


def _key(q: OwnerQuery) -> str:
    return property_key(q.street, q.city, q.state)


class OwnerBatchService:
    def __init__(
        self,
        client: TracerfyBatchClient,
        store: OwnerResultStore,
        rate_limiter: Optional[SlidingWindowRateLimiter] = None,
    ):
        self._client = client
        self._store = store
        # ADJUSTABLE: batch starts per client per 5 minutes. Each start can create two
        # Tracerfy queues (+1 follow-up); Tracerfy's own cap is 10 submissions / 5 min.
        self._limiter = rate_limiter or SlidingWindowRateLimiter(limit=3, window_s=300)

    @property
    def is_configured(self) -> bool:
        return self._client.is_configured

    # ---- start ----

    async def start(self, queries: list[OwnerQuery], client_id: str, refresh: bool = False) -> BatchStatus:
        """O(q) store reads + at most two Tracerfy submits. Duplicate properties are sent once."""
        unique: dict[str, OwnerQuery] = {}
        for q in queries:  # O(q) — dedupe by property (first occurrence wins, incl. its name)
            unique.setdefault(_key(q), q)
        if len(unique) > MAX_BATCH_ITEMS:
            raise ValueError(f"At most {MAX_BATCH_ITEMS} buildings per batch.")

        saved: list[BatchItemResult] = []
        to_send: list[OwnerQuery] = []
        for q in unique.values():  # O(q)
            hit = None if refresh else self._store.get(q)
            if hit:
                saved.append(BatchItemResult(q, hit[0], hit[1], cached=True))
            else:
                to_send.append(q)
        if not to_send:
            return BatchStatus("", pending=False, results=tuple(saved), submitted=0)

        if not self._limiter.allow(client_id):
            raise RateLimited()
        named = [q for q in to_send if q.has_person_name]
        unnamed = [q for q in to_send if not q.has_person_name]

        job_id = uuid.uuid4().hex
        state: dict = {"items": [_to_dict(q) for q in to_send], "queues": [], "followup": [], "done": False}
        first_submit = True
        for trace_type, batch in (("normal", named), ("advanced", unnamed)):
            if not batch:
                continue
            try:
                queue_id = await self._client.submit(batch, trace_type)
            except ProviderUnavailable:
                if first_submit:
                    raise  # nothing spent yet → report the error (e.g. 402 out of credits)
                # A queue is already running (credits will be spent) — keep the job and
                # send these as a follow-up "advanced" queue on the next poll.
                state["followup"].extend(_to_dict(q) for q in batch)
                continue
            first_submit = False
            state["queues"].append({"queue_id": queue_id, "trace_type": trace_type,
                                    "items": [_to_dict(q) for q in batch], "done": False})
        self._store.save_job(job_id, state)
        return BatchStatus(job_id, pending=True, results=tuple(saved), submitted=len(to_send), by_name=len(named))

    # ---- poll ----

    async def poll(self, job_id: str) -> BatchStatus:
        """One Tracerfy status call; one CSV download per finished queue; ≤1 follow-up submit."""
        state = self._store.get_job(job_id)
        if state is None:
            raise BatchNotFound(job_id)
        items = [_from_dict(d) for d in state["items"]]
        by_name = sum(len(q["items"]) for q in state["queues"] if q["trace_type"] == "normal")

        if not state["done"]:
            await self._collect_finished_queues(state)
            await self._submit_followup(job_id, state)
            state["done"] = all(q["done"] for q in state["queues"]) and not state["followup"]
            self._store.save_job(job_id, state)
            if not state["done"]:
                return BatchStatus(job_id, pending=True, results=(), submitted=len(items), by_name=by_name)

        results = []
        for q in items:  # O(q)
            hit = self._store.get(q)
            if hit:
                results.append(BatchItemResult(q, hit[0], hit[1], cached=False))
        return BatchStatus(job_id, pending=False, results=tuple(results), submitted=len(items), by_name=by_name)

    async def _collect_finished_queues(self, state: dict) -> None:
        """Save results of every queue Tracerfy has finished. Name-trace misses are NOT
        saved — they become follow-ups for an address trace. O(q) per finished queue."""
        open_queues = [q for q in state["queues"] if not q["done"]]
        if not open_queues:
            return
        statuses = await self._client.statuses([q["queue_id"] for q in open_queues])
        for queue in open_queues:
            st = statuses.get(str(queue["queue_id"]))
            if st is None or st.pending or not st.download_url:
                continue
            parsed = parse_results(await self._client.fetch_results(st.download_url), _METHOD[queue["trace_type"]])
            source = f"tracerfy-batch-{queue['trace_type']}"
            for d in queue["items"]:  # O(q)
                q = _from_dict(d)
                result = parsed.get(_key(q))
                if result is not None:
                    self._store.put(q, result, source=source)
                elif queue["trace_type"] == "normal":
                    state["followup"].append(d)  # wrong/stale name or unlisted person → try the address
                else:
                    self._store.put(q, _MISS, source=source)
            queue["done"] = True

    async def _submit_followup(self, job_id: str, state: dict) -> None:
        """Send outstanding follow-ups as one "advanced" queue. On failure they stay in
        the job (saved) and the next poll retries; the error is reported to the caller."""
        if not state["followup"]:
            return
        batch = [_from_dict(d) for d in state["followup"]]
        try:
            queue_id = await self._client.submit(batch, "advanced")
        except ProviderUnavailable:
            self._store.save_job(job_id, state)  # keep already-saved progress + the follow-up list
            raise
        state["queues"].append({"queue_id": queue_id, "trace_type": "advanced",
                                "items": state["followup"], "done": False})
        state["followup"] = []
