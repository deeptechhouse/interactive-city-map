"""Phone-number lookup adapters for businesses found at a selected building.

PURPOSE
    The contact list (frontend ``contacts/``) already knows each business's name and
    street address from Chicago's free business-licence data. None of the free public
    datasets carry phone numbers, so this module asks a paid places provider for them.

    This module deliberately does NOT: look up building *owners* (no provider has owner
    phones — that would need a skip-trace service, which was rejected 2026-10-01), cache
    results (``PhoneLookupService`` does that), or decide provider order (config does).

FLOW
    PhoneLookupService.lookup()
      → ChainedPhoneLookup.lookup()          # tries each provider in order
          → GooglePlacesPhoneLookup.lookup()  # POST places:searchText
          → FoursquarePhoneLookup.lookup()    # GET /places/search
      → names_match() guards every hit, so a neighbour's phone is never returned.

ARCHITECTURE
    ``PhoneLookupAdapter`` is the port; each provider is an adapter behind it (§6 —
    swapping providers touches only this file + config). ``build_phone_lookup()`` is the
    factory that turns a provider-name list from config into a chain.

    TO ADD A PROVIDER: subclass PhoneLookupAdapter, implement ``lookup`` and ``name``,
    register it in ``_PROVIDER_FACTORIES`` at the bottom, add its key to ``config.py``.
"""

from __future__ import annotations

import re
from abc import ABC, abstractmethod
from dataclasses import dataclass
from typing import Callable, Optional

import httpx  # async HTTP client, already a backend dependency (errors caught in the chain)

from app.adapters.http_json import get_json as _get_json, post_json as _post_json, raise_if_all_failed, real_key
from app.config import settings


@dataclass(frozen=True)
class PhoneMatch:
    """A phone number a provider returned for a business (immutable DTO)."""

    phone: str
    matched_name: str
    provider: str
    website: str = ""  # same billing tier as the phone on both providers — free extra


@dataclass(frozen=True)
class BusinessQuery:
    """What we know about the business we want a phone number for (immutable DTO)."""

    name: str
    address: str
    lat: Optional[float] = None
    lon: Optional[float] = None
    city: str = "Chicago"
    state: str = "IL"


# Words that appear in nearly every business name and so prove nothing about a match.
# ADJUSTABLE: add words here if unrelated businesses are being accepted as matches.
_STOP_WORDS = frozenset(
    # City names are noise when matching a business name to a place listing.
    {"the", "and", "of", "inc", "llc", "ltd", "co", "corp", "company", "a", "chicago", "detroit", "dayton", "&"}
)


# O(n) time, O(n) space — n = characters in text
def _tokens(text: str) -> set[str]:
    """Lower-case significant words in ``text``.

    O(n) time, O(n) space — n = characters in text.
    """
    # O(n) time, O(n) space — n = characters in text (findall + one pass over its words)
    return {w for w in re.findall(r"[a-z0-9]+", text.lower()) if w not in _STOP_WORDS and len(w) > 1}


# O(a + b) time, O(a + b) space — a = length of wanted; b = length of found
def names_match(wanted: str, found: str) -> bool:
    """True when ``found`` plausibly names the same business as ``wanted``.

    Quality gate (fail closed): providers always return *something* near the point,
    often the shop next door. Without this check a neighbour's phone would land in the
    CSV under the wrong business. One shared significant word is enough because licence
    names ("COREY'S NYC BAGEL DELI") and listing names ("Corey's NYC Bagel") rarely
    share every word.

    O(a + b) time, O(a + b) space — a, b = lengths of the two names.
    """
    return bool(_tokens(wanted) & _tokens(found))


class PhoneLookupAdapter(ABC):
    """Port: find a phone number for one business. Returns None when not found."""

    @property
    @abstractmethod
    # O(1) time, O(1) space — n = none (constant provider id)
    def name(self) -> str:
        """Short provider id used in config and in the response (``google``...)."""

    @property
    # O(1) time, O(1) space — n = none (constant flag)
    def is_configured(self) -> bool:
        """False when the adapter has no API key — the chain skips it silently."""
        return True

    @abstractmethod
    # O(1) time, O(1) space — n = none (abstract, each adapter states its own bound)
    async def lookup(self, query: BusinessQuery) -> Optional[PhoneMatch]:
        """Return the provider's phone for ``query`` or None. Must not raise on 'no match'."""


class GooglePlacesPhoneLookup(PhoneLookupAdapter):
    """Google Places API (New) Text Search.

    COST (checked 2026-10-01): asking for ``nationalPhoneNumber`` bills the call at the
    *Enterprise* Text Search SKU — 1,000 free calls/month, then $35 per 1,000. The field
    mask below is therefore kept to the minimum: adding fields can move the call to a
    pricier SKU.
    """

    _URL = "https://places.googleapis.com/v1/places:searchText"
    # websiteUri sits in the same Enterprise SKU as nationalPhoneNumber, so asking for it
    # doesn't change the price; anything beyond these three fields might.
    _FIELD_MASK = (
        "places.displayName,places.formattedAddress,places.nationalPhoneNumber,places.websiteUri"
    )
    # ADJUSTABLE: bias radius in metres. Smaller = fewer wrong-building hits; below ~50 m
    # Google may return nothing for large buildings whose pin sits at the far corner.
    _BIAS_RADIUS_M = 150.0

    # O(1) time, O(1) space — n = none (stores a key and a client)
    def __init__(self, api_key: str = "", client: Optional[httpx.AsyncClient] = None):
        self._api_key = real_key(api_key or settings.google_places_api_key)
        self._client = client  # injectable for tests; None = make one per call

    @property
    # O(1) time, O(1) space — n = none (constant provider id)
    def name(self) -> str:
        return "google"

    @property
    # O(1) time, O(1) space — n = none (truthiness of a stored key)
    def is_configured(self) -> bool:
        return bool(self._api_key)

    def _body(self, query: BusinessQuery) -> dict:
        """O(1) time, O(1) space — n = none (fixed-size request body). Build the searchText body."""
        body: dict = {
            "textQuery": f"{query.name}, {query.address}, {query.city}, {query.state}",
            "maxResultCount": 1,  # we only want the best hit; more results cost the same but add noise
        }
        if query.lat is not None and query.lon is not None:
            body["locationBias"] = {
                "circle": {
                    "center": {"latitude": query.lat, "longitude": query.lon},
                    "radius": self._BIAS_RADIUS_M,
                }
            }
        return body

    async def lookup(self, query: BusinessQuery) -> Optional[PhoneMatch]:
        """O(a + b) time, O(a + b) space — a = query name length; b = returned name length.

        One HTTP call (counted as O(1) work); maxResultCount = 1, so only one place is checked.
        """
        headers = {
            "X-Goog-Api-Key": self._api_key,
            "X-Goog-FieldMask": self._FIELD_MASK,
            "Content-Type": "application/json",
        }
        data = await _post_json(self._client, self._URL, headers, self._body(query))
        places = data.get("places") or []
        if not places:
            return None
        place = places[0]
        found_name = (place.get("displayName") or {}).get("text", "")
        phone = place.get("nationalPhoneNumber", "")
        if not phone or not names_match(query.name, found_name):
            return None
        return PhoneMatch(
            phone=phone, matched_name=found_name, provider=self.name, website=place.get("websiteUri", "")
        )


class FoursquarePhoneLookup(PhoneLookupAdapter):
    """Foursquare Places API (2025+ host ``places-api.foursquare.com``).

    The legacy ``api.foursquare.com/v3`` endpoints were deprecated 2026-05-15, so this
    adapter targets the new host + versioned header. ``tel`` is a *Pro* field (not
    Premium) — billed at the Pro rate; new accounts get 500 free Pro calls.

    Verified live 2026-10-02 (Corey's NYC Bagel Deli, 1001 W North Ave → same number as
    Google). If lookups later return nothing with a valid key, Foursquare has probably
    bumped the API: check ``_API_VERSION`` and the ``results[].tel`` field name first.
    """

    _URL = "https://places-api.foursquare.com/places/search"
    _API_VERSION = "2025-06-17"
    # ADJUSTABLE: search radius in metres (Foursquare minimum is 1). See Google note above.
    _RADIUS_M = 150

    # O(1) time, O(1) space — n = none (stores a key and a client)
    def __init__(self, api_key: str = "", client: Optional[httpx.AsyncClient] = None):
        self._api_key = real_key(api_key or settings.foursquare_api_key)
        self._client = client

    @property
    # O(1) time, O(1) space — n = none (constant provider id)
    def name(self) -> str:
        return "foursquare"

    @property
    # O(1) time, O(1) space — n = none (truthiness of a stored key)
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def lookup(self, query: BusinessQuery) -> Optional[PhoneMatch]:
        """O(r) time, O(r) space — r = results returned (≤ 5, the ``limit`` param).

        One HTTP call (counted as O(1) work), then a scan of at most 5 results.
        """
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "X-Places-Api-Version": self._API_VERSION,
            "Accept": "application/json",
        }
        params: dict = {"query": query.name, "limit": 5, "fields": "name,tel,website,location"}
        if query.lat is not None and query.lon is not None:
            params["ll"] = f"{query.lat},{query.lon}"
            params["radius"] = self._RADIUS_M
        else:
            params["near"] = f"{query.address}, {query.city}, {query.state}"

        data = await _get_json(self._client, self._URL, headers, params)
        # O(r) time, O(1) space — r = results (≤ 5), each names_match costs the name length.
        # First result whose name matches AND has a phone wins.
        for place in data.get("results") or []:
            phone = place.get("tel", "")
            found_name = place.get("name", "")
            if phone and names_match(query.name, found_name):
                return PhoneMatch(
                    phone=phone, matched_name=found_name, provider=self.name, website=place.get("website", "")
                )
        return None


class ChainedPhoneLookup(PhoneLookupAdapter):
    """Try each configured provider in order; first match wins.

    This is how "Google first, Foursquare as fallback" works: the second provider is
    only billed when the first found nothing. Provider errors (bad key, quota, network)
    are swallowed per provider so one outage doesn't blank the whole lookup.
    """

    # O(p) time, O(p) space — p = providers passed in
    def __init__(self, providers: list[PhoneLookupAdapter]):
        # O(p) time, O(p) space — p = providers. Unconfigured providers (no key) are dropped up front.
        self._providers = tuple(p for p in providers if p.is_configured)

    @property
    # O(p) time, O(p) space — p = configured providers
    def name(self) -> str:
        # O(p) time, O(p) space — p = configured providers (joined into one id string)
        return "+".join(p.name for p in self._providers) or "none"

    @property
    # O(1) time, O(1) space — n = none (truthiness of the provider tuple)
    def is_configured(self) -> bool:
        return bool(self._providers)

    @property
    # O(p) time, O(p) space — p = configured providers
    def provider_names(self) -> tuple[str, ...]:
        """Names of the providers that will actually be called, in order."""
        # O(p) time, O(p) space — p = configured providers
        return tuple(p.name for p in self._providers)

    async def lookup(self, query: BusinessQuery) -> Optional[PhoneMatch]:
        """O(p) time, O(p) space — p = configured providers (≤ 2 today).

        Worst case is p HTTP calls (each counted as O(1) work); space is the error list.

        Raises ProviderUnavailable when every provider ERRORED (see http_json.py) so the
        failure is reported, not cached as "no phone".
        """
        errors: list[tuple[str, Exception]] = []
        answered = False
        # O(p) time, O(p) space — p = configured providers (errors list grows ≤ p)
        for provider in self._providers:
            try:
                match = await provider.lookup(query)
            except httpx.HTTPError as err:
                # Quota / auth / network failure on this provider: fall through to the next.
                errors.append((provider.name, err))
                continue
            answered = True
            if match:
                return match
        raise_if_all_failed(errors, answered)
        return None


_PROVIDER_FACTORIES: dict[str, Callable[[], PhoneLookupAdapter]] = {
    "google": GooglePlacesPhoneLookup,
    "foursquare": FoursquarePhoneLookup,
}


# O(p) time, O(p) space — p = names in the list
def build_phone_lookup(provider_names: list[str]) -> ChainedPhoneLookup:
    """Factory: provider-name list from config → chain. Unknown names are ignored.

    O(p) time, O(p) space — p = names in the list.
    """
    # O(p) time, O(p) space — p = names in the list (dict membership is constant-time)
    providers = [
        _PROVIDER_FACTORIES[n]() for n in provider_names if n in _PROVIDER_FACTORIES
    ]
    return ChainedPhoneLookup(providers)
