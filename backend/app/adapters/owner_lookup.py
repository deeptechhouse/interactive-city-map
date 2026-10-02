"""Owner skip-trace adapters — phone numbers and emails for a building's OWNER.

PURPOSE
    Cook County records give the owner's *name* and *mailing address* (free). To call or
    email the owner we need a skip-trace service, which matches a property address to
    the person(s) who own it — including the people behind an LLC — and returns their
    phones (with Do-Not-Call flags) and emails. In use: Tracerfy ($0.10 per instant
    lookup, misses free). BatchData is implemented but NOT enabled — it has no
    pay-per-call pricing (smallest plan $2,000/month, checked 2026-10-02); enable it via
    OWNER_LOOKUP_PROVIDERS only if a plan is bought.

    Not done here: caching / rate limiting (OwnerLookupService) or deciding when to
    spend money (the UI only calls this when the user presses "Find owner phone & email").

FLOW
    OwnerLookupService.lookup()
      → ChainedOwnerLookup.lookup()
          → TracerfyOwnerLookup.lookup()    # POST /v1/api/trace/lookup/  (sync)
          → BatchDataOwnerLookup.lookup()   # only if enabled in config (see above)

COMPLIANCE — results carry DPPA/GLBA permissible-use obligations, and phones flagged
    ``dnc`` (Do Not Call registry) must not get unsolicited sales calls. The DNC flag is
    passed through untouched so the UI and CSV can show it. Never drop it.

TO ADD A PROVIDER: subclass OwnerLookupAdapter, register in ``_OWNER_FACTORIES``, add
    its key to config.py.
"""

from __future__ import annotations

from abc import ABC, abstractmethod
from dataclasses import dataclass, field
from typing import Any, Callable, Optional

import httpx

from app.adapters.http_json import post_json as _post_json, raise_if_all_failed, real_key
from app.config import settings


@dataclass(frozen=True)
class OwnerQuery:
    """The property we want the owner of. Skip tracers key on the PROPERTY address."""

    street: str
    city: str
    state: str
    zip: str = ""
    owner_name: str = ""  # county owner of record — used only as a hint / for display
    # A PERSON's name to trace at this address (Tracerfy "normal" batch, 1 credit/hit).
    # Both empty → owner discovery from the address ("advanced", 2 credits/hit).
    # The frontend only fills these when it's confident (contacts/ownerNames.ts).
    first_name: str = ""
    last_name: str = ""

    @property
    def has_person_name(self) -> bool:
        return bool(self.first_name.strip() and self.last_name.strip())


def property_key(street: str, city: str, state: str) -> str:
    """Normalised "STREET|CITY|STATE" — THE key for one property everywhere: the saved
    results store, and matching batch-result CSV rows back to submitted buildings. ZIP is
    left out on purpose (the county sometimes omits it; street + city + state is enough).
    O(n) — n = address length.
    """
    return "|".join(" ".join((x or "").upper().split()) for x in (street, city, state))


@dataclass(frozen=True)
class OwnerPhone:
    number: str
    # "Mobile" / "Landline", plus why it's flagged when it is: "Mobile · TCPA · litigator"
    type: str = ""
    # Do not cold-call: on the DNC registry, TCPA-flagged, or the person is a known
    # TCPA litigator. One flag on purpose — every reason means the same thing to the user.
    dnc: bool = False


@dataclass(frozen=True)
class OwnerContactResult:
    """Best person found for the property. Phones/emails are ordered best-first."""

    person_name: str
    phones: tuple[OwnerPhone, ...] = field(default_factory=tuple)
    emails: tuple[str, ...] = field(default_factory=tuple)
    provider: str = ""
    # False when the source never checked Do-Not-Call status (Tracerfy BATCH results have
    # no DNC columns). The UI then shows "DNC not checked" instead of implying "safe".
    dnc_checked: bool = True
    # How it was found: "address" (owner discovery), "name" (a given person traced at the
    # address — trust it only as far as the name was right), "instant". '' = unknown/old.
    method: str = ""

    @property
    def is_hit(self) -> bool:
        return bool(self.phones or self.emails)


class OwnerLookupAdapter(ABC):
    """Port: skip-trace one property. Returns None on a miss; raises httpx errors on failure."""

    @property
    @abstractmethod
    def name(self) -> str: ...

    @property
    def is_configured(self) -> bool:
        return True

    @abstractmethod
    async def lookup(self, query: OwnerQuery) -> Optional[OwnerContactResult]: ...


def digits_phone(raw: Any) -> str:
    """'5125550100' / '+1-512-555-0100' → '(512) 555-0100'; other shapes returned as-is. O(n)."""
    text = str(raw or "").strip()
    digits = "".join(ch for ch in text if ch.isdigit())
    if len(digits) == 11 and digits.startswith("1"):
        digits = digits[1:]
    if len(digits) == 10:
        return f"({digits[:3]}) {digits[3:6]}-{digits[6:]}"
    return text


def _sort_phones(phones: list[OwnerPhone]) -> tuple[OwnerPhone, ...]:
    """Callable-first: non-DNC numbers ahead of DNC ones, provider rank kept otherwise.

    Python's sort is stable, so equal keys keep the provider's order. O(p log p).
    """
    return tuple(sorted(phones, key=lambda p: p.dnc))


class TracerfyOwnerLookup(OwnerLookupAdapter):
    """Tracerfy Instant Trace (docs checked 2026-10-02:
    tracerfy.com/skip-tracing-api-documentation). Synchronous; 5 credits per hit, 0 on
    a miss. ``find_owner: true`` asks for the owner of the property address.
    """

    _URL = "https://tracerfy.com/v1/api/trace/lookup/"

    def __init__(self, api_key: str = "", client: Optional[httpx.AsyncClient] = None):
        self._api_key = real_key(api_key or settings.tracerfy_api_key)
        self._client = client

    @property
    def name(self) -> str:
        return "tracerfy"

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def lookup(self, query: OwnerQuery) -> Optional[OwnerContactResult]:
        """One HTTP call. O(p + e) parsing — p phones, e emails in the reply."""
        body = {
            "address": query.street,
            "city": query.city,
            "state": query.state,
            "zip": query.zip,
            "find_owner": True,
        }
        headers = {"Authorization": f"Bearer {self._api_key}", "Content-Type": "application/json"}
        data = await _post_json(self._client, self._URL, headers, body)
        if not data.get("hit"):
            return None
        # Living people only; prefer the one flagged as property owner, else the first.
        persons = [p for p in data.get("persons") or [] if not p.get("deceased")]
        person = next((p for p in persons if p.get("property_owner")), persons[0] if persons else None)
        if not person:
            return None
        # Tracerfy docs (2026-10-02): phones with dnc OR tcpa, or any phone of a person with
        # litigator=true, "should not be called for telemarketing or cold outreach".
        litigator = bool(person.get("litigator"))

        def to_phone(p: dict) -> OwnerPhone:
            reasons = [r for r, on in (("TCPA", p.get("tcpa")), ("litigator", litigator)) if on]
            label = " · ".join(x for x in [str(p.get("type") or ""), *reasons] if x)
            return OwnerPhone(digits_phone(p.get("number")), label, bool(p.get("dnc")) or bool(reasons))

        phones = [
            to_phone(p)
            for p in sorted(person.get("phones") or [], key=lambda p: p.get("rank") or 99)
            if p.get("number")
        ]
        emails = [
            str(e.get("email"))
            for e in sorted(person.get("emails") or [], key=lambda e: e.get("rank") or 99)
            if e.get("email")
        ]
        result = OwnerContactResult(
            person_name=str(person.get("full_name") or "").strip(),
            phones=_sort_phones(phones),
            emails=tuple(emails),
            provider=self.name,
        )
        return result if result.is_hit else None


class BatchDataOwnerLookup(OwnerLookupAdapter):
    """BatchData property skip trace — POST https://api.batchdata.com/api/v1/property/skip-trace.

    UNVERIFIED (2026-10-02): BatchData's public docs show two different payload shapes
    (``requests[].propertyAddress{street,city,state,zip}`` → ``results.persons[]`` with
    ``phoneNumbers[]``/``emails[]``, and a flat ``[{address, city, state, zip_code}]`` →
    ``results[]`` with ``mobile_phone``/``email``). We SEND the documented ``requests``
    form and PARSE either reply shape. Confirm against a live key, then delete whichever
    branch of ``_parse`` never fires.
    """

    _URL = "https://api.batchdata.com/api/v1/property/skip-trace"

    def __init__(self, api_key: str = "", client: Optional[httpx.AsyncClient] = None):
        self._api_key = real_key(api_key or settings.batchdata_api_key)
        self._client = client

    @property
    def name(self) -> str:
        return "batchdata"

    @property
    def is_configured(self) -> bool:
        return bool(self._api_key)

    async def lookup(self, query: OwnerQuery) -> Optional[OwnerContactResult]:
        body = {
            "requests": [
                {
                    "propertyAddress": {
                        "street": query.street,
                        "city": query.city,
                        "state": query.state,
                        "zip": query.zip,
                    }
                }
            ]
        }
        headers = {
            "Authorization": f"Bearer {self._api_key}",
            "Content-Type": "application/json",
            "Accept": "application/json",
        }
        data = await _post_json(self._client, self._URL, headers, body)
        result = self._parse(data)
        return result if result and result.is_hit else None

    def _parse(self, data: dict) -> Optional[OwnerContactResult]:
        """Accept either documented reply shape. O(p + e)."""
        results = data.get("results")
        # Shape A: {"results": {"persons": [{name, phoneNumbers, emails}]}}
        if isinstance(results, dict) and isinstance(results.get("persons"), list):
            persons = results["persons"]
            if not persons:
                return None
            person = persons[0]
            name = person.get("name") or {}
            full = name.get("full") or " ".join(x for x in (name.get("first"), name.get("last")) if x)
            phones = [
                OwnerPhone(digits_phone(p.get("number")), str(p.get("type") or ""), bool(p.get("dnc")))
                for p in person.get("phoneNumbers") or []
                if p.get("number")
            ]
            emails = [
                str(e.get("email") if isinstance(e, dict) else e)
                for e in person.get("emails") or []
                if (e.get("email") if isinstance(e, dict) else e)
            ]
            return OwnerContactResult(str(full or "").strip(), _sort_phones(phones), tuple(emails), self.name)
        # Shape B: {"results": [{owner_name, mobile_phone, landline_phone, email, dnc_status}]}
        if isinstance(results, list) and results:
            r = results[0]
            dnc = bool(r.get("dnc_status"))
            phones = [
                OwnerPhone(digits_phone(r[k]), label, dnc)
                for k, label in (("mobile_phone", "Mobile"), ("landline_phone", "Landline"))
                if r.get(k)
            ]
            emails = (str(r["email"]),) if r.get("email") else ()
            return OwnerContactResult(str(r.get("owner_name") or "").strip(), _sort_phones(phones), emails, self.name)
        return None


class ChainedOwnerLookup(OwnerLookupAdapter):
    """Providers in order; first hit wins. Later providers are only billed on a miss."""

    def __init__(self, providers: list[OwnerLookupAdapter]):
        self._providers = tuple(p for p in providers if p.is_configured)  # O(p)

    @property
    def name(self) -> str:
        return "+".join(p.name for p in self._providers) or "none"

    @property
    def is_configured(self) -> bool:
        return bool(self._providers)

    @property
    def provider_names(self) -> tuple[str, ...]:
        return tuple(p.name for p in self._providers)

    async def lookup(self, query: OwnerQuery) -> Optional[OwnerContactResult]:
        """O(p) HTTP calls worst case — p = configured providers (≤ 2).

        Raises ProviderUnavailable when every provider ERRORED (e.g. Tracerfy HTTP 402,
        out of credits) — never report or cache that as "no match".
        """
        errors: list[tuple[str, Exception]] = []
        answered = False
        for provider in self._providers:
            try:
                result = await provider.lookup(query)
            except httpx.HTTPError as err:
                errors.append((provider.name, err))  # outage / auth / credits → try the next
                continue
            answered = True
            if result:
                return result
        raise_if_all_failed(errors, answered)
        return None


_OWNER_FACTORIES: dict[str, Callable[[], OwnerLookupAdapter]] = {
    "tracerfy": TracerfyOwnerLookup,
    "batchdata": BatchDataOwnerLookup,
}


def build_owner_lookup(provider_names: list[str]) -> ChainedOwnerLookup:
    """Config names → chain; unknown names ignored. O(p)."""
    return ChainedOwnerLookup([_OWNER_FACTORIES[n]() for n in provider_names if n in _OWNER_FACTORIES])
