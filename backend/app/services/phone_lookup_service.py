"""Phone lookup orchestration: per-city provider order, caching, rate limiting.

PURPOSE
    Sits between the ``/contacts/phone`` route and the paid provider adapters. Its whole
    job is to keep paid calls rare and predictable:
      * picks the provider chain for the requested city (Chicago → Google first),
      * caches every answer — including "no phone found" — so the same business is
        never billed twice while the server is up,
      * rate-limits per client so a runaway script can't run up a bill.

    It does NOT talk HTTP to providers (adapters do) or parse requests (the route does).

FLOW
    routes/contacts.py → PhoneLookupService.lookup(city, query, client_id)
        → SlidingWindowRateLimiter.allow(client_id)   # raise RateLimited if over
        → _cache hit?  return it
        → ChainedPhoneLookup.lookup(query)              # adapters/phone_lookup.py
        → store in _cache, return

ARCHITECTURE
    Pure orchestration + two small in-memory helpers. The cache and limiter are
    process-local: fine for the single-process dev/prod setup today. If the backend is
    ever scaled to several workers, swap both for Redis behind the same methods.
"""

from __future__ import annotations

import time
from collections import OrderedDict, deque
from dataclasses import dataclass
from typing import Callable, Optional

from app.adapters.phone_lookup import (
    BusinessQuery,
    ChainedPhoneLookup,
    PhoneMatch,
    build_phone_lookup,
)
from app.config import settings


class RateLimited(Exception):
    """Raised when a client exceeds its lookups-per-minute budget."""


@dataclass(frozen=True)
class PhoneLookupResult:
    """Response DTO: ``phone`` is '' when nothing matched."""

    phone: str
    matched_name: str
    provider: str
    cached: bool
    website: str = ""


def parse_city_providers(raw: str) -> dict[str, list[str]]:
    """Parse ``"chicago=google,foursquare;detroit=foursquare"`` into a dict.

    Malformed segments are skipped rather than raising — a typo in .env should degrade
    to the default order, not take the endpoint down.
    O(n) time, O(n) space — n = length of the string.
    """
    result: dict[str, list[str]] = {}
    for segment in raw.split(";"):  # O(segments)
        if "=" not in segment:
            continue
        city, providers = segment.split("=", 1)
        names = [p.strip().lower() for p in providers.split(",") if p.strip()]
        if city.strip() and names:
            result[city.strip().lower()] = names
    return result


class SlidingWindowRateLimiter:
    """Allow at most ``limit`` events per ``window_s`` seconds per client id.

    Each client keeps a deque of event timestamps; old ones are popped from the left.
    allow(): amortised O(1) time — each timestamp is appended and popped once.
    Space: O(c · limit) — c = active clients.
    """

    def __init__(self, limit: int, window_s: float = 60.0, clock: Callable[[], float] = time.monotonic):
        self._limit = limit
        self._window_s = window_s
        self._clock = clock  # injectable so tests don't have to sleep
        self._events: dict[str, deque[float]] = {}

    def allow(self, client_id: str) -> bool:
        now = self._clock()
        events = self._events.setdefault(client_id, deque())
        # Amortised O(1): drop timestamps that have left the window.
        while events and now - events[0] >= self._window_s:
            events.popleft()
        if len(events) >= self._limit:
            return False
        events.append(now)
        return True


class LruCache:
    """Tiny bounded LRU map. get/put O(1) time; O(max_size) space."""

    def __init__(self, max_size: int):
        self._max = max_size
        self._data: OrderedDict[tuple, PhoneLookupResult] = OrderedDict()

    def get(self, key: tuple) -> Optional[PhoneLookupResult]:
        if key not in self._data:
            return None
        self._data.move_to_end(key)
        return self._data[key]

    def put(self, key: tuple, value: PhoneLookupResult) -> None:
        self._data[key] = value
        self._data.move_to_end(key)
        if len(self._data) > self._max:
            self._data.popitem(last=False)  # evict least recently used


# ADJUSTABLE: how many distinct businesses to remember. ~200 bytes each, so 10k ≈ 2 MB.
_CACHE_SIZE = 10_000


class PhoneLookupService:
    """Business-logic facade used by the route. One instance per process."""

    def __init__(
        self,
        default_providers: list[str],
        city_providers: dict[str, list[str]],
        rate_limiter: SlidingWindowRateLimiter,
        chain_factory: Callable[[list[str]], ChainedPhoneLookup] = build_phone_lookup,
    ):
        self._default = default_providers
        self._by_city = city_providers
        self._limiter = rate_limiter
        self._chain_factory = chain_factory
        self._chains: dict[str, ChainedPhoneLookup] = {}  # built lazily, one per city
        self._cache = LruCache(_CACHE_SIZE)

    @classmethod
    def from_settings(cls) -> "PhoneLookupService":
        """Wiring from config.py — the only place settings are read."""
        return cls(
            default_providers=[p.strip() for p in settings.phone_lookup_providers.split(",") if p.strip()],
            city_providers=parse_city_providers(settings.phone_lookup_providers_by_city),
            rate_limiter=SlidingWindowRateLimiter(settings.phone_lookup_rate_per_minute),
        )

    def _chain_for(self, city: str) -> ChainedPhoneLookup:
        """O(1) amortised — chains are built once per city then reused."""
        key = city.lower()
        if key not in self._chains:
            self._chains[key] = self._chain_factory(self._by_city.get(key, self._default))
        return self._chains[key]

    def providers_for(self, city: str) -> tuple[str, ...]:
        """Configured (keyed) providers for a city — lets the UI say 'no phone source set up'."""
        return self._chain_for(city).provider_names

    @staticmethod
    def _cache_key(city: str, query: BusinessQuery) -> tuple:
        # Normalised name + address (+ the address's own city, since owner companies are
        # looked up at their mailing address, often outside Chicago): the same business
        # from two buildings or two sessions hits one entry. Coordinates are left out.
        return (
            city.lower(),
            query.name.strip().lower(),
            query.address.strip().lower(),
            query.city.strip().lower(),
        )

    async def lookup(self, city: str, query: BusinessQuery, client_id: str) -> PhoneLookupResult:
        """Cached lookup. O(1) on a cache hit; O(p) provider calls on a miss."""
        key = self._cache_key(city, query)
        cached = self._cache.get(key)
        if cached is not None:
            # Cache hits are free, so they don't count against the rate limit.
            return PhoneLookupResult(
                cached.phone, cached.matched_name, cached.provider, cached=True, website=cached.website
            )

        if not self._limiter.allow(client_id):
            raise RateLimited()

        match: Optional[PhoneMatch] = await self._chain_for(city).lookup(query)
        result = (
            PhoneLookupResult(match.phone, match.matched_name, match.provider, cached=False, website=match.website)
            if match
            else PhoneLookupResult("", "", "", cached=False)
        )
        self._cache.put(key, result)  # cache misses too: "no phone" is also a paid answer
        return result
