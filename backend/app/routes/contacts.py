"""Contact-list endpoints: phone lookup for a business at a selected building.

PURPOSE
    The frontend gets owner + business *names* straight from the free public datasets
    (works even in static mode). The one thing it can't do in the browser is a paid phone
    lookup, because that needs an API key — so this route exists only to keep the
    Google / Foursquare keys on the server (§27: no secrets in client bundles).

FLOW
    GET /api/v1/contacts/phone?city=chicago&name=...&address=...&lat=..&lon=..
      → validate inputs (FastAPI Query constraints)
      → PhoneLookupService.lookup()  (services/phone_lookup_service.py)
      → {"phone", "matched_name", "provider", "cached"}

    POST /api/v1/contacts/owner/batch   {"items": [{street, zip, first_name?, last_name?}], "refresh": false}
    GET  /api/v1/contacts/owner/batch/{job_id}
      → OwnerBatchService (services/owner_batch_service.py) → Tracerfy batch queues
      THE path the map's GUI uses: items WITH a person's name → 1-credit name trace
      (misses retried by address); without → 2-credit address trace. Results saved with
      their date.

    GET /api/v1/contacts/owner?street=..&locality=..&region=..&zip=..&refresh=false
      → OwnerLookupService (services/owner_lookup_service.py) → Tracerfy instant
      Instant path, 5 credits per hit — wired but hidden in the GUI since 2026-10-02.
      Owner results are saved permanently (services/owner_result_store.py).

    GET /api/v1/contacts/providers?city=chicago → which providers have keys, so the UI
    can explain an empty phone column instead of looking broken.
"""

import re
from typing import Optional

from fastapi import APIRouter, HTTPException, Path, Query, Request
from pydantic import BaseModel, Field

from app.adapters.http_json import ProviderUnavailable
from app.adapters.owner_lookup import OwnerContactResult, OwnerQuery
from app.adapters.tracerfy_batch import TracerfyBatchClient
from app.adapters.phone_lookup import BusinessQuery
from app.services.owner_batch_service import MAX_BATCH_ITEMS, BatchNotFound, OwnerBatchService
from app.services.owner_lookup_service import OwnerLookupService
from app.services.owner_result_store import OwnerResultStore
from app.services.phone_lookup_service import PhoneLookupService, RateLimited

router = APIRouter(tags=["contacts"])

# One service per process so the cache and rate limiter are shared across requests.
_service: Optional[PhoneLookupService] = None
_owner_service: Optional[OwnerLookupService] = None
_batch_service: Optional[OwnerBatchService] = None
_store: Optional[OwnerResultStore] = None


def _get_store() -> OwnerResultStore:
    """One SQLite store per process, shared by the instant and batch paths."""
    global _store
    if _store is None:
        _store = OwnerResultStore()
    return _store


def get_phone_service() -> PhoneLookupService:
    """Lazy singleton — built on first use so tests can swap it via ``set_phone_service``."""
    global _service
    if _service is None:
        _service = PhoneLookupService.from_settings()
    return _service


def set_phone_service(service: Optional[PhoneLookupService]) -> None:
    """Test hook: inject a service with fake providers (None resets to settings)."""
    global _service
    _service = service


def get_owner_service() -> OwnerLookupService:
    """Lazy singleton, like get_phone_service."""
    global _owner_service
    if _owner_service is None:
        _owner_service = OwnerLookupService.from_settings(_get_store())
    return _owner_service


def set_owner_service(service: Optional[OwnerLookupService]) -> None:
    """Test hook (None resets to settings)."""
    global _owner_service
    _owner_service = service


def get_batch_service() -> OwnerBatchService:
    global _batch_service
    if _batch_service is None:
        _batch_service = OwnerBatchService(TracerfyBatchClient(), _get_store())
    return _batch_service


def set_batch_service(service: Optional[OwnerBatchService]) -> None:
    """Test hook (None resets to settings)."""
    global _batch_service
    _batch_service = service


def _provider_error(err: ProviderUnavailable) -> HTTPException:
    """Map a provider failure to a clear client error. 402 = the paid account is empty."""
    if err.status == 402:
        return HTTPException(
            status_code=402,
            detail=f"{err.provider.title()} account is out of credits — add credits on their website.",
        )
    if err.status in (401, 403):
        return HTTPException(status_code=502, detail=f"{err.provider.title()} rejected the API key — check .env.")
    if 400 <= err.status < 500:
        # The request itself was refused — pass the provider's reason through, trimmed.
        return HTTPException(status_code=502, detail=f"{err.provider.title()} rejected the request: {err.detail[:200]}")
    return HTTPException(status_code=502, detail=f"{err.provider.title()} is not responding — try again shortly.")


# Input bounds: names/addresses longer than this are not real licence data, and capping
# them keeps a crafted request from building huge provider queries.
_MAX_TEXT = 200


@router.get("/contacts/phone")
async def lookup_phone(
    request: Request,
    name: str = Query(..., min_length=1, max_length=_MAX_TEXT),
    address: str = Query(..., min_length=1, max_length=_MAX_TEXT),
    city: str = Query("chicago", pattern=r"^[a-z_-]{1,40}$"),
    lat: Optional[float] = Query(None, ge=-90, le=90),
    lon: Optional[float] = Query(None, ge=-180, le=180),
    # The address's own city/state — needed when looking up an OWNER COMPANY at its
    # mailing address (often outside Chicago). Defaults suit businesses in the building.
    locality: str = Query("Chicago", min_length=1, max_length=80),
    region: str = Query("IL", pattern=r"^[A-Za-z]{2}$"),
):
    """Find a phone number for one business. Returns phone '' when none matched."""
    service = get_phone_service()
    client_id = request.client.host if request.client else "unknown"
    query = BusinessQuery(
        name=name.strip(), address=address.strip(), lat=lat, lon=lon,
        city=locality.strip(), state=region.upper(),
    )
    try:
        result = await service.lookup(city, query, client_id)
    except RateLimited:
        raise HTTPException(status_code=429, detail="Too many phone lookups — try again in a minute.")
    except ProviderUnavailable as err:
        raise _provider_error(err)
    return {
        "phone": result.phone,
        "matched_name": result.matched_name,
        "provider": result.provider,
        "cached": result.cached,
        "website": result.website,
    }


@router.get("/contacts/owner")
async def lookup_owner(
    request: Request,
    street: str = Query(..., min_length=1, max_length=_MAX_TEXT),
    locality: str = Query("Chicago", min_length=1, max_length=80),
    region: str = Query("IL", pattern=r"^[A-Za-z]{2}$"),
    zip: str = Query("", pattern=r"^(\d{5}(-\d{4})?)?$"),
    owner_name: str = Query("", max_length=_MAX_TEXT),
    refresh: bool = Query(False, description="Ignore the saved answer and pay for a fresh lookup"),
):
    """INSTANT skip trace of a PROPERTY address (5 credits per hit). Saved permanently."""
    query = OwnerQuery(
        street=street.strip(), city=locality.strip(), state=region.upper(), zip=zip, owner_name=owner_name.strip()
    )
    client_id = request.client.host if request.client else "unknown"
    try:
        answer = await get_owner_service().lookup(query, client_id, refresh=refresh)
    except RateLimited:
        raise HTTPException(status_code=429, detail="Too many owner lookups — try again in a minute.")
    except ProviderUnavailable as err:
        raise _provider_error(err)
    return {**_owner_json(answer.result, answer.looked_up_at), "cached": answer.cached}


def _owner_json(result: OwnerContactResult, looked_up_at: str) -> dict:
    """Wire format for one owner result (instant and batch share it)."""
    return {
        "person_name": result.person_name,
        "phones": [{"number": p.number, "type": p.type, "dnc": p.dnc} for p in result.phones],
        "emails": list(result.emails),
        "provider": result.provider,
        "dnc_checked": result.dnc_checked,
        "method": result.method,
        "looked_up_at": looked_up_at,
    }


# A person's name part: letters (incl. accented), apostrophes, hyphens, periods, spaces.
_NAME_PART = r"^[^\W\d_][^\W\d_ .'-]*(?:[ .'-]+[^\W\d_]+)*\.?$"


class BatchItem(BaseModel):
    street: str = Field(..., min_length=1, max_length=_MAX_TEXT)
    zip: str = Field("", pattern=r"^(\d{5}(-\d{4})?)?$")
    # Optional trusted owner name → cheaper 1-credit name trace. Both or neither.
    first_name: str = Field("", max_length=60)
    last_name: str = Field("", max_length=60)


class BatchRequest(BaseModel):
    items: list[BatchItem] = Field(..., min_length=1, max_length=MAX_BATCH_ITEMS)
    refresh: bool = False  # re-buy answers that are already saved


def _valid_name(part: str) -> bool:
    return bool(re.match(_NAME_PART, part.strip()))


def _batch_json(status) -> dict:
    return {
        "job_id": status.job_id,
        "pending": status.pending,
        "submitted": status.submitted,
        "by_name": status.by_name,
        "results": [
            {"street": r.query.street, "zip": r.query.zip, "cached": r.cached, **_owner_json(r.result, r.looked_up_at)}
            for r in status.results
        ],
    }


@router.post("/contacts/owner/batch")
async def start_owner_batch(request: Request, body: BatchRequest):
    """Look up many building owners in ONE Tracerfy batch (2 credits per hit).
    Saved answers come back immediately; the rest arrive via the job_id poll."""
    service = get_batch_service()
    if not service.is_configured:
        raise HTTPException(status_code=503, detail="Owner batch lookup needs TRACERFY_API_KEY in .env.")
    # Chicago only today — the map's contact list only resolves Chicago buildings.
    queries = []
    for i in body.items:
        first, last = i.first_name.strip(), i.last_name.strip()
        if not (first and last and _valid_name(first) and _valid_name(last)):
            first = last = ""  # half a name, or not a name → owner discovery by address
        queries.append(
            OwnerQuery(street=i.street.strip(), city="Chicago", state="IL", zip=i.zip, first_name=first, last_name=last)
        )
    client_id = request.client.host if request.client else "unknown"
    try:
        status = await service.start(queries, client_id, refresh=body.refresh)
    except ValueError as err:
        raise HTTPException(status_code=422, detail=str(err))
    except RateLimited:
        raise HTTPException(status_code=429, detail="Too many batches — wait a few minutes.")
    except ProviderUnavailable as err:
        raise _provider_error(err)
    return _batch_json(status)


@router.get("/contacts/owner/batch/{job_id}")
async def poll_owner_batch(job_id: str = Path(..., pattern=r"^[0-9a-f]{32}$")):
    """Poll a batch. ``pending`` until Tracerfy finishes; then every result, saved."""
    try:
        status = await get_batch_service().poll(job_id)
    except BatchNotFound:
        raise HTTPException(status_code=404, detail="Batch not found.")
    except ProviderUnavailable as err:
        raise _provider_error(err)
    return _batch_json(status)


@router.get("/contacts/providers")
async def phone_providers(city: str = Query("chicago", pattern=r"^[a-z_-]{1,40}$")):
    """List the phone providers that are configured (have keys) for ``city``, in order."""
    return {
        "city": city,
        "providers": list(get_phone_service().providers_for(city)),
        "owner_providers": list(get_owner_service().provider_names),
    }
