"""Owner skip trace — INSTANT path (one property, answer now, 5 Tracerfy credits per hit).

Since 2026-10-02 the map's GUI uses the BATCH path instead (owner_batch_service.py,
1 credit per hit). This instant path stays wired — route, service, adapter, frontend
client — for later use; the button is hidden behind SHOW_INSTANT_OWNER_LOOKUP in
frontend/src/contacts/ContactListPanel.tsx.

FLOW
    routes/contacts.py → OwnerLookupService.lookup(query, client_id, refresh)
      → saved answer? return it with its looked-up date (free, not rate-limited)
        — unless refresh=True ("Search again", a deliberate paid re-check)
      → rate limiter → ChainedOwnerLookup.lookup()  (adapters/owner_lookup.py)
      → save the answer with today's date, hits AND misses (OwnerResultStore, SQLite —
        survives restarts, so nothing is ever paid for twice by accident)
      → provider FAILURES (ProviderUnavailable) propagate unsaved, so topping up credits
        or fixing a key takes effect on the very next click
"""

from __future__ import annotations

from dataclasses import dataclass
from typing import Callable

from app.adapters.owner_lookup import (
    ChainedOwnerLookup,
    OwnerContactResult,
    OwnerQuery,
    build_owner_lookup,
)
from app.config import settings
from app.services.owner_result_store import OwnerResultStore
from app.services.phone_lookup_service import RateLimited, SlidingWindowRateLimiter

_MISS = OwnerContactResult(person_name="")


@dataclass(frozen=True)
class OwnerLookupAnswer:
    result: OwnerContactResult  # a miss is person_name '' with no phones/emails
    looked_up_at: str  # ISO UTC date of the (paid) lookup that produced it
    cached: bool  # True = served from the store, nothing charged now


class OwnerLookupService:
    """Business-logic facade for the instant owner route. One instance per process."""

    # O(p) time, O(p) space — p = provider names (the chain factory builds one provider each)
    def __init__(
        self,
        provider_names: list[str],
        rate_limiter: SlidingWindowRateLimiter,
        store: OwnerResultStore,
        chain_factory: Callable[[list[str]], ChainedOwnerLookup] = build_owner_lookup,
    ):
        self._chain = chain_factory(provider_names)
        self._limiter = rate_limiter
        self._store = store

    @classmethod
    # O(s) time, O(s) space — s = length of the providers setting string
    def from_settings(cls, store: OwnerResultStore) -> "OwnerLookupService":
        return cls(
            # O(s) time, O(s) space — s = length of the providers setting string
            provider_names=[p.strip().lower() for p in settings.owner_lookup_providers.split(",") if p.strip()],
            rate_limiter=SlidingWindowRateLimiter(settings.owner_lookup_rate_per_minute),
            store=store,
        )

    @property
    # O(p) time, O(p) space — p = configured providers
    def provider_names(self) -> tuple[str, ...]:
        return self._chain.provider_names

    async def lookup(self, query: OwnerQuery, client_id: str, refresh: bool = False) -> OwnerLookupAnswer:
        """O(log n + p) time, O(1) space — n = saved answers (SQLite index); p = provider calls on a miss."""
        if not refresh:
            saved = self._store.get(query)
            if saved is not None:
                result, looked_up_at, _source = saved
                return OwnerLookupAnswer(result, looked_up_at, cached=True)
        if not self._limiter.allow(client_id):
            raise RateLimited()
        result = await self._chain.lookup(query) or _MISS
        stamp = self._store.put(query, result, source=f"{result.provider or 'miss'}-instant")
        return OwnerLookupAnswer(result, stamp, cached=False)
