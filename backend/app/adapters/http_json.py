"""Shared plumbing for the paid lookup adapters (phone_lookup.py, owner_lookup.py).

Kept tiny on purpose: the only place these adapters touch the network, so tests inject
an ``httpx.AsyncClient`` with a ``MockTransport`` instead of patching module globals.
"""

from __future__ import annotations

from typing import Optional

import httpx

class ProviderUnavailable(Exception):
    """Every configured provider FAILED (error, not "no match") for one lookup.

    Trap (2026-10-02): a Tracerfy account with 0 credits answered HTTP 402; the chain
    swallowed it as "no match", the service CACHED that miss, and the UI said "No match"
    — and kept saying it after credits were added, until a server restart. A failure must
    never look like (or be cached as) a genuine miss: chains raise this instead.

    ``status`` is the last provider's HTTP status (0 for network errors), so the route can
    tell "out of credits" (402) from "provider down".
    """

    def __init__(self, provider: str, status: int, detail: str = ""):
        super().__init__(f"{provider} failed with HTTP {status}: {detail[:200]}")
        self.provider = provider
        self.status = status
        self.detail = detail


# O(1) time, O(1) space
def raise_if_all_failed(errors: list[tuple[str, Exception]], answered: bool) -> None:
    """Chain helper: raise ProviderUnavailable when no provider gave a real answer."""
    if answered or not errors:
        return
    name, err = errors[-1]
    status = err.response.status_code if isinstance(err, httpx.HTTPStatusError) else 0
    detail = err.response.text if isinstance(err, httpx.HTTPStatusError) else str(err)
    raise ProviderUnavailable(name, status, detail)


# ADJUSTABLE: per-request timeout in seconds. Raise if providers time out on slow links;
# the frontend waits for every lookup at a building, so keep it well under ~10 s.
TIMEOUT_S = 8.0


def real_key(key: str) -> str:
    """Return ``key`` unless it is empty or still the .env.example placeholder.

    Trap (2026-10-02): .env was copied from .env.example with FOURSQUARE_API_KEY left as
    "your_foursquare_api_key_here"; the adapter treated that as configured, so every lookup
    burned a request on a guaranteed 401 and Foursquare silently returned nothing.
    O(1).
    """
    key = (key or "").strip()
    return "" if not key or key.startswith("your_") else key


# O(b) time, O(b) space — b = response size
async def post_json(client: Optional[httpx.AsyncClient], url: str, headers: dict, body) -> dict:
    """POST and decode JSON; raises httpx.HTTPStatusError on 4xx/5xx."""
    if client is not None:
        resp = await client.post(url, headers=headers, json=body)
    else:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            resp = await c.post(url, headers=headers, json=body)
    resp.raise_for_status()
    return resp.json()


# O(b) time, O(b) space — b = response size
async def get_json(client: Optional[httpx.AsyncClient], url: str, headers: dict, params: dict) -> dict:
    """GET and decode JSON; raises httpx.HTTPStatusError on 4xx/5xx."""
    if client is not None:
        resp = await client.get(url, headers=headers, params=params)
    else:
        async with httpx.AsyncClient(timeout=TIMEOUT_S) as c:
            resp = await c.get(url, headers=headers, params=params)
    resp.raise_for_status()
    return resp.json()
