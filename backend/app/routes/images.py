"""Building-image endpoints for the contact list (adapters/building_images.py).

    GET /api/v1/images/building?city=&lat=&lon=&pin=&searched=
        Free images for one building: street-level facade + aerial candidates, each with
        its credit line, plus a free "open Google Street View" link. Nothing is stored.
        searched=true (the building has been through a lookup) + paid photos switched on +
        the free street photo missing or poor (building_images.paid_streetview_reason) →
        Google's FREE metadata check runs and `streetview` says whether a paid photo exists.
        Otherwise Google is not contacted at all. (Rule asked for 2026-10-02.)

    GET /api/v1/images/streetview/usage
        This month's paid-photo count for the contact list's usage line:
        {"enabled", "used", "cap", "month"}. Reads our counter only — never calls Google.

    GET /api/v1/images/streetview/page?lat=&lon=&title=
        A standalone HTML page meant to be opened as a SEPARATE POP-UP WINDOW. When the paid
        Street View photo is enabled it shows it there (no map on that page — Google's terms
        forbid Google imagery beside a non-Google map); otherwise it explains and links to
        Google Maps (free).

    GET /api/v1/images/streetview/photo?lat=&lon=
        The paid Street View Static image, proxied so the key stays on this server. Checks
        Google's FREE metadata endpoint first, so "no imagery here" never costs anything.
        Sent with Cache-Control: no-store (Google forbids caching).

Mounted by both servers (map_server.py static mode, main.py / db_map_server.py database
mode) — the images come from the internet either way, not from our database.
"""

import html
import sys
import time
from collections import deque

import httpx
from fastapi import APIRouter, HTTPException, Query, Request
from fastapi.responses import HTMLResponse, Response

from app.adapters.building_images import (
    MAX_FACADE_AGE_YEARS,
    BuildingImageService,
    BuildingRef,
    ImageCandidate,
    google_maps_streetview_link,
    paid_streetview_reason,
)
from app.adapters.http_json import real_key
from app.config import settings
from app.services.streetview_offers import OfferPasses
from app.services.streetview_usage import StreetViewUsage

router = APIRouter(tags=["images"])

_service: BuildingImageService | None = None


# O(1) time, O(1) space — n = 1 shared service (its answer cache lives across requests).
def get_image_service() -> BuildingImageService:
    global _service
    if _service is None:
        _service = BuildingImageService(settings.mapillary_access_token)
    return _service


# O(1) time, O(1) space — n = 1 service swapped. Test hook: None resets to settings.
def set_image_service(service: BuildingImageService | None) -> None:
    global _service
    _service = service


_CITY = r"^[a-z_-]{1,40}$"


@router.get("/images/building")
# O(s) time, O(s) space — s = free sources for the city (≤ 3).
async def building_images(
    city: str = Query(..., pattern=_CITY),
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    pin: str = Query("", pattern=r"^[\d\- ]{0,20}$"),
    searched: bool = Query(False, description="the building has been through a lookup"),
):
    ref = BuildingRef(city=city, lat=lat, lon=lon, pin=pin)
    found = await get_image_service().find(ref)
    answer = found.to_json()
    answer["streetview_paid_enabled"] = _streetview_key() != ""
    answer["streetview"] = await _paid_offer(lat, lon, found.facade) if searched else None
    return answer


# O(1) time, O(1) space — n = ≤ 1 free metadata call.
async def _paid_offer(lat: float, lon: float, facades: list[ImageCandidate]) -> dict | None:
    """Offer the paid photo only when it's on, the free photo is missing/poor, Google
    actually has outdoor imagery here (free check), and this month's cap isn't reached."""
    key = _streetview_key()
    reason = paid_streetview_reason(facades, time.gmtime().tm_year) if key else ""
    if not reason:
        return None  # a good free photo (or the feature off) → Google never asked
    if _usage().used() >= settings.google_streetview_monthly_cap:
        note = "this month's free Street View photos are used up"
        return {"available": False, "reason": reason, "date": "", "note": note}
    meta = await _metadata(lat, lon, key)
    if meta.get("status") != "OK":
        note = _NOT_OK_NOTES.get(meta.get("status", ""), "Google Street View didn't answer")
        return {"available": False, "reason": reason, "date": "", "note": note}
    date = str(meta.get("date", ""))
    this_year = time.gmtime().tm_year
    if reason.startswith("free photo is from") and date[:4].isdigit():
        if this_year - int(date[:4]) > MAX_FACADE_AGE_YEARS:
            # The free photo is old, but Google's here is old too — don't pay for that.
            note = f"Google's Street View here is also old ({date})"
            return {"available": False, "reason": reason, "date": date, "note": note}
    # The ONLY place a paid photo is offered — so the pass minted here is what makes a
    # photo billable at all (services/streetview_offers.py).
    token = _passes().mint(lat, lon)
    return {"available": True, "reason": reason, "date": date, "note": "", "token": token}


# Google metadata statuses → what the card says. REQUEST_DENIED is the one to fix: the key
# needs "Street View Static API" enabled in Google Cloud (found 2026-10-04 on this key).
_NOT_OK_NOTES = {
    "ZERO_RESULTS": "no Google Street View here",
    "NOT_FOUND": "no Google Street View here",
    "REQUEST_DENIED": "the Google key doesn't have the Street View Static API enabled",
    "OVER_QUERY_LIMIT": "Google Street View is busy — try again later",
}


# --------------------------------------------------------------------------- paid Street View


# O(1) time, O(1) space — n = 1 key chosen.
def _streetview_key() -> str:
    """The key for the paid photo, or "" when the feature is off / unconfigured."""
    if not settings.google_streetview_enabled:
        return ""
    return real_key(settings.google_streetview_api_key) or real_key(settings.google_places_api_key)


_recent: deque[float] = deque()
_usage_store: StreetViewUsage | None = None
_pass_store: OfferPasses | None = None


# O(1) time, O(1) space — n = 1 shared pass book (its secret lives only in memory).
def _passes() -> OfferPasses:
    global _pass_store
    if _pass_store is None:
        _pass_store = OfferPasses()
    return _pass_store


# O(1) time, O(1) space — n = 1 shared counter.
def _usage() -> StreetViewUsage:
    global _usage_store
    if _usage_store is None:
        _usage_store = StreetViewUsage()
    return _usage_store


# O(1) time, O(1) space — n = 1 counter swapped. Test hook: None resets to the default file.
def set_usage_store(store: StreetViewUsage | None) -> None:
    global _usage_store
    _usage_store = store


# O(r) time, O(r) space — r = calls in the last minute (≤ the per-minute cap).
def _allow_paid_call() -> bool:
    """Sliding one-minute window shared by every client — a runaway guard, since each
    photo past Google's free 10,000/month costs money."""
    now = time.monotonic()
    # O(r) time, O(1) space — r = expired entries dropped
    while _recent and now - _recent[0] > 60:
        _recent.popleft()
    if len(_recent) >= settings.google_streetview_rate_per_minute:
        return False
    if not _usage().try_spend(settings.google_streetview_monthly_cap):
        return False  # stay inside Google's free 10,000/month
    _recent.append(now)
    return True


# O(1) time, O(1) space — n = 1 free request.
async def _metadata(lat: float, lon: float, key: str) -> dict:
    """Google's FREE Street View metadata (unlimited, never billed): {"status": "OK",
    "date": …} when outdoor imagery exists, else Google's status (ZERO_RESULTS,
    REQUEST_DENIED, …) or {} on a network error. Same source filter as the paid request."""
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            meta = await client.get(
                f"{_SV}/metadata",
                params={"location": f"{lat:.6f},{lon:.6f}", "source": "outdoor", "key": key},
            )
        data = meta.json() if meta.status_code == 200 else {}
    except (httpx.HTTPError, ValueError):
        return {}
    return data if isinstance(data, dict) else {}


_SV = "https://maps.googleapis.com/maps/api/streetview"


@router.get("/images/streetview/usage")
# O(1) time, O(1) space — n = 1 small counter file read.
async def streetview_usage():
    from app.services.streetview_usage import _this_month

    used = _usage().used()
    unknown = used == sys.maxsize  # counter file unreadable → paid photos are blocked
    return {
        "enabled": _streetview_key() != "",
        "used": None if unknown else used,
        "cap": settings.google_streetview_monthly_cap,
        "month": _this_month(),
    }


@router.get("/images/streetview/photo")
# O(b) time, O(b) space — b = bytes of one image (passed through, never stored).
async def streetview_photo(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    token: str = Query("", max_length=120),
):
    key = _streetview_key()
    if not key:
        raise HTTPException(status_code=404, detail="Paid Street View photos are turned off.")
    # Only our own pop-up page may spend money: an <img> on some other website pointed at
    # this URL would otherwise bill a photo per page view. Browsers send Sec-Fetch-Site.
    if request.headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
        raise HTTPException(
            status_code=403, detail="Street View photos load only from this app's pop-up."
        )
    # No valid pass from a real offer (search done + free photo missing/poor) → no charge.
    if not _passes().is_valid(token, lat, lon):
        raise HTTPException(status_code=403, detail="Open the photo from the contact list.")
    location = f"{lat:.6f},{lon:.6f}"
    # The free metadata check MUST ask exactly what the paid request asks (source=outdoor),
    # or an indoor-only spot passes the check and then bills a grey "no imagery" tile.
    common = {"location": location, "source": "outdoor", "key": key}
    try:
        async with httpx.AsyncClient(timeout=10.0) as client:
            meta = await client.get(f"{_SV}/metadata", params=common)
            if meta.status_code != 200 or meta.json().get("status") != "OK":
                raise HTTPException(
                    status_code=404, detail="Google has no Street View here (nothing charged)."
                )
            if not _allow_paid_call():
                raise HTTPException(
                    status_code=429,
                    detail="Street View limit reached (per minute, or this month's free 10,000).",
                )
            if not _passes().redeem(token, lat, lon):  # used meanwhile (another tab)
                raise HTTPException(status_code=403, detail="This photo was already opened.")
            # No heading: Google points the camera from the nearest panorama toward
            # `location`. return_error_code → a 404 instead of a billed grey placeholder.
            img = await client.get(
                _SV, params={**common, "size": "640x420", "fov": "80", "return_error_code": "true"}
            )
    except (httpx.HTTPError, ValueError):
        raise HTTPException(status_code=502, detail="Google Street View is not responding.")
    if img.status_code != 200:
        raise HTTPException(status_code=502, detail="Google Street View did not return an image.")
    return Response(
        content=img.content,
        media_type=img.headers.get("content-type", "image/jpeg"),
        headers={"Cache-Control": "no-store"},
    )


@router.get("/images/streetview/page", response_class=HTMLResponse)
# O(1) time, O(1) space — n = 1 small HTML page.
async def streetview_page(
    request: Request,
    lat: float = Query(..., ge=-90, le=90),
    lon: float = Query(..., ge=-180, le=180),
    title: str = Query("", max_length=200),
    token: str = Query("", max_length=120),
):
    # Opened by another website (link / window.open / frame)? Refuse — the page is meant
    # to be opened from this app's contact list only.
    if request.headers.get("sec-fetch-site", "same-origin") not in ("same-origin", "none"):
        raise HTTPException(status_code=403, detail="Open Street View from the contact list.")
    safe_title = html.escape(title or "Building")
    maps_link = html.escape(google_maps_streetview_link(lat, lon))
    if _streetview_key():
        body = (
            f'<img src="photo?lat={lat:.6f}&amp;lon={lon:.6f}&amp;token={html.escape(token)}" '
            f'alt="Google Street View of {safe_title}" '
            "onerror=\"this.replaceWith(Object.assign(document.createElement('p'),"
            "{textContent:'No Google Street View photo here (nothing was charged).'}))\">"
            '<p class="credit">Imagery © Google</p>'
        )
    else:
        body = (
            "<p>Paid Street View photos are turned off. "
            "The free link below opens Google's own Street View.</p>"
        )
    page = f"""<!doctype html><html lang="en"><head><meta charset="utf-8">
<meta name="viewport" content="width=device-width,initial-scale=1">
<title>{safe_title} — Street View</title>
<style>
body{{margin:0;padding:16px;background:#0d1117;color:#c9d1d9;font:14px system-ui,sans-serif}}
img{{max-width:100%;border-radius:6px;display:block}} a{{color:#58a6ff}}
.credit{{color:#8b949e;font-size:12px}}
</style>
</head><body><h1 style="font-size:16px">{safe_title}</h1>{body}
<p><a href="{maps_link}" target="_blank" rel="noopener noreferrer">
Open in Google Maps Street View ↗</a></p>
</body></html>"""
    # no-store: Google forbids caching. The framing/opener headers stop another site from
    # embedding this page or keeping a handle to the window to re-aim it.
    return HTMLResponse(
        page,
        headers={
            "Cache-Control": "no-store",
            "X-Frame-Options": "DENY",
            "Content-Security-Policy": "frame-ancestors 'none'",
            "Cross-Origin-Opener-Policy": "same-origin",
            "Referrer-Policy": "no-referrer",
        },
    )
