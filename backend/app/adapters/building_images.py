"""Building images for the contact list — free public sources first, per city.

PURPOSE (asked 2026-10-02): "images definitely help inform me" — show what a building
looks like next to its contact-list entry, without paying where a free source exists.
Researched and fact-checked the same day (sources and licences below were probed live).

    city      street-level FACADE (free)                       AERIAL (free)
    chicago   Cook County Assessor field photo, by 14-digit    Cook County CookOrtho2025
              PIN (2006–08; ~60 % of PINs have one)             (~15 cm), NAIP fallback
    detroit   City of Detroit "Detroit Street View" 360°       Detroit 2024 6-inch tiles,
              frames on Mapillary (needs a free token)          NAIP fallback
    dayton    Mapillary crowd photos (needs a free token;       Montgomery County 2024,
              coverage thin)                                    NAIP fallback

    Everywhere: a free "open Google Street View" link (Google's own site, Maps URLs — no
    API, no key, no charge). The PAID Street View Static photo is optional, off by default
    (settings.google_streetview_enabled) and only ever shown in its own pop-up window:
    Google's terms forbid showing Google imagery on the same screen as a non-Google map,
    and the main map is MapLibre (Maps ToS 3.2.3(e), Service Terms 14.2).

WHAT THIS DELIBERATELY DOES NOT DO
    * store any image. URLs are built (or looked up) per request and shown live:
      Cook County publishes no reuse licence; Mapillary thumbnail URLs expire (~30 days);
      Google forbids caching. Only an in-memory TTL cache of the ANSWER exists.
    * call another city's sources. CITY_SOURCES is keyed by city slug — a Detroit
      building can never trigger a Chicago request (city separation, top priority).

ARCHITECTURE
    BuildingRef / ImageCandidate     data
    ImageSource (Protocol)           one free source; find() returns 0+ candidates
    CookAssessorPhotos, MapillaryPhotos, *Aerial    concrete sources
    CITY_SOURCES                     slug → ordered sources (facade first, then aerial)
    BuildingImageService             runs a city's sources, caches the answer briefly

TO ADD A SOURCE: implement find(), add it to CITY_SOURCES for its city only.
"""

from __future__ import annotations

import asyncio
import math
import re
import time
from collections import OrderedDict
from dataclasses import asdict, dataclass, field
from typing import Protocol
from urllib.parse import urlencode

import httpx

from app.adapters.http_json import real_key


@dataclass(frozen=True)
class BuildingRef:
    """What we know about one building on the list."""

    city: str
    lat: float
    lon: float
    pin: str = ""  # Cook County 14-digit PIN (Chicago only); other cities: ""
    address: str = ""


@dataclass(frozen=True)
class ImageCandidate:
    """One image to show. `url` is loaded by the browser directly (never stored)."""

    kind: str  # "facade" (street-level) or "aerial" (top-down)
    source: str  # short label shown under the image
    url: str
    attribution: str  # credit line the licence requires
    link: str = ""  # where the credit links / "view larger"
    captured: str = ""  # capture date/year when known
    note: str = ""
    captured_year: int | None = None  # for the quality rule (facade_is_poor)
    distance_m: float | None = None  # camera → building, street-level photos only


class SourceFailedError(Exception):
    """A source couldn't answer right now (timeout, 429, 5xx) — NOT "this building has no
    photo". The service caches such answers for a minute instead of an hour, so a slow
    county server or a Mapillary rate limit never hides a photo for long."""


# O(1) time, O(1) space — n = 1 status checked
def _raise_if_transient(resp: httpx.Response, source: str) -> None:
    if resp.status_code == 429 or resp.status_code >= 500:
        raise SourceFailedError(f"{source}: HTTP {resp.status_code}")


class ImageSource(Protocol):
    """One free image source. find() returns [] for "no image" and raises SourceFailedError
    when the source couldn't be asked (so the miss isn't cached for long)."""

    name: str

    # O(k) time, O(k) space — k = images the source returns (contract, 0–1 in practice)
    async def find(self, ref: BuildingRef, client: httpx.AsyncClient) -> list[ImageCandidate]: ...


# --------------------------------------------------------------------------- helpers


def bbox_around(lat: float, lon: float, half_m: float) -> tuple[float, float, float, float]:
    """O(1) time, O(1) space — n = 4 numbers. (minLon, minLat, maxLon, maxLat) ± half_m metres."""
    dlat = half_m / 111_320.0
    dlon = half_m / (111_320.0 * max(math.cos(math.radians(lat)), 0.01))
    return (lon - dlon, lat - dlat, lon + dlon, lat + dlat)


def bearing_deg(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """O(1) time, O(1) space — n = 1 bearing. Compass bearing from point 1 to point 2."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dl = math.radians(lon2 - lon1)
    y = math.sin(dl) * math.cos(p2)
    x = math.cos(p1) * math.sin(p2) - math.sin(p1) * math.cos(p2) * math.cos(dl)
    return (math.degrees(math.atan2(y, x)) + 360.0) % 360.0


def angle_gap(a: float, b: float) -> float:
    """O(1) time, O(1) space — n = 1 angle. Smallest difference between two headings."""
    d = abs(a - b) % 360.0
    return 360.0 - d if d > 180.0 else d


def tile_xy(lat: float, lon: float, z: int) -> tuple[int, int]:
    """O(1) time, O(1) space — n = 1 tile. Web Mercator XYZ tile containing the point."""
    n = 2**z
    x = int((lon + 180.0) / 360.0 * n)
    lat_r = math.radians(lat)
    y = int((1.0 - math.asinh(math.tan(lat_r)) / math.pi) / 2.0 * n)
    return x, y


def _export_url(base: str, ref: BuildingRef, half_m: float, extra: dict[str, str]) -> str:
    """O(1) time, O(1) space — n = 1 URL. ArcGIS exportImage/export for a box around the point."""
    w, s, e, n = bbox_around(ref.lat, ref.lon, half_m)
    params = {
        "bbox": f"{w:.6f},{s:.6f},{e:.6f},{n:.6f}",
        "bboxSR": "4326",
        "imageSR": "3857",
        "size": "400,400",
        "format": "jpg",
        "f": "image",
        **extra,
    }
    return f"{base}?{urlencode(params)}"


# ADJUSTABLE: half-width of aerial thumbnails in metres. 60 m shows the building and its
# neighbours; below ~30 m a large building no longer fits, above ~120 m it's too small.
AERIAL_HALF_M = 60.0

# --------------------------------------------------------------------------- facade sources

# Cook County serves assessor photos from CloudFront, which answers 403 to non-browser
# user agents (verified 2026-10-02) — the HEAD check below must look like a browser.
# The <img> in the page is loaded by the real browser, so it needs nothing special.
_BROWSER_UA = "Mozilla/5.0 (Macintosh) interactive-city-map/0.2"
_PIN_RE = re.compile(r"^\d{14}$")


class CookAssessorPhotos:
    """Cook County Assessor field photos (Chicago). Free; no published reuse licence →
    shown live from the county's server, never downloaded or stored."""

    name = "cook_assessor"
    _BASE = "https://prodassets.cookcountyassessoril.gov/s3fs-public/pin_detail"

    @classmethod
    def candidate_urls(cls, pin: str) -> list[str]:
        """O(1) time, O(1) space — n = 2 URLs. The extension's CASE varies by PIN (.JPG for
        most, .jpg for some) and the wrong case is a 404, so both are tried."""
        folder = f"{cls._BASE}/{pin[0:3]}-{pin[3:5]}/{pin[5:8]}/{pin}_AA"
        return [f"{folder}.JPG", f"{folder}.jpg"]

    async def find(self, ref: BuildingRef, client: httpx.AsyncClient) -> list[ImageCandidate]:
        """O(1) time, O(1) space — n = ≤ 2 HEAD requests (free)."""
        pin = re.sub(r"\D", "", ref.pin)
        if not _PIN_RE.match(pin):
            return []
        # O(1) time, O(1) space — n = 2 extensions
        for url in self.candidate_urls(pin):
            try:
                resp = await client.head(url, headers={"User-Agent": _BROWSER_UA})
            except httpx.HTTPError as err:
                raise SourceFailedError(f"cook_assessor: {err!r}") from err
            _raise_if_transient(resp, "cook_assessor")
            if resp.status_code == 200:
                return [
                    ImageCandidate(
                        kind="facade",
                        source="Cook County Assessor",
                        url=url,
                        attribution="Photo: Cook County Assessor's Office",
                        link=f"https://www.cookcountyassessoril.gov/pin/{pin}",
                        captured="2006–2008 (date printed on photo)",
                        # The newest year the county's photo run used — so the quality
                        # rule never calls a photo older than it might really be.
                        captured_year=2008,
                    )
                ]
        return []


class MapillaryPhotos:
    """Street-level photos from Mapillary (CC BY-SA). Detroit: prefer the City of Detroit's
    own account (Detroit Street View); Dayton: any contributor. Needs a FREE token
    (settings.mapillary_access_token) — without one this source quietly returns []."""

    name = "mapillary"
    _URL = "https://graph.mapillary.com/images"
    # ADJUSTABLE: search radius (Mapillary's maximum is 50 m).
    RADIUS_M = 50

    def __init__(self, token: str, creator: str = "") -> None:
        """O(1) time, O(1) space — n = 2 settings. creator = Mapillary username to prefer
        ("codgis" = City of Detroit GIS; UNVERIFIED that the v4 name is unchanged)."""
        self._token = token
        self._creator = creator

    async def _search(
        self, ref: BuildingRef, client: httpx.AsyncClient, creator: str
    ) -> list[dict]:
        """O(k) time, O(k) space — k = images returned (≤ 20)."""
        params = {
            "access_token": self._token,
            "fields": "id,thumb_1024_url,captured_at,compass_angle,computed_geometry,is_pano",
            "lat": f"{ref.lat:.6f}",
            "lng": f"{ref.lon:.6f}",
            "radius": str(self.RADIUS_M),
            "limit": "20",
        }
        if creator:
            params["creator_username"] = creator
        try:
            resp = await client.get(self._URL, params=params)
        except httpx.HTTPError as err:
            raise SourceFailedError(f"mapillary: {err!r}") from err
        _raise_if_transient(resp, "mapillary")
        if resp.status_code != 200:
            return []  # 4xx other than 429: e.g. a bad token — a real "no", not transient
        data = resp.json().get("data", [])
        return data if isinstance(data, list) else []

    @staticmethod
    def best_facing(ref: BuildingRef, images: list[dict]) -> dict | None:
        """O(k) time, O(1) space — k = images. The frame whose camera points most nearly at
        the building, ties broken by distance — every 360° panorama "faces" the building,
        so without the distance tie-break a pano 50 m away on another street could win.
        Non-panorama frames without a compass angle are skipped (direction unknown)."""
        best, best_key = None, (181.0, float("inf"))
        cos_lat = math.cos(math.radians(ref.lat))
        # O(k) time, O(1) space — k = images
        for img in images:
            coords = (img.get("computed_geometry") or {}).get("coordinates")
            if not img.get("thumb_1024_url") or not coords:
                continue
            if img.get("is_pano"):
                gap = 0.0
            elif img.get("compass_angle") is None:
                continue
            else:
                gap = angle_gap(
                    float(img["compass_angle"]), bearing_deg(coords[1], coords[0], ref.lat, ref.lon)
                )
            # equirectangular metres — plenty accurate inside a 50 m search radius
            dist = math.hypot((coords[0] - ref.lon) * cos_lat, coords[1] - ref.lat) * 111_320.0
            if (gap, dist) < best_key:
                best, best_key = img, (gap, dist)
        return best

    async def find(self, ref: BuildingRef, client: httpx.AsyncClient) -> list[ImageCandidate]:
        """O(k) time, O(k) space — k = images returned (≤ 2 free API calls)."""
        if not self._token:
            return []
        img = (
            self.best_facing(ref, await self._search(ref, client, self._creator))
            if self._creator
            else None
        )
        from_creator = img is not None  # credit the City only when its own frame is shown
        if img is None:
            img = self.best_facing(ref, await self._search(ref, client, ""))
        if img is None:
            return []
        captured, captured_year = "", None
        if isinstance(img.get("captured_at"), int | float):
            when = time.gmtime(img["captured_at"] / 1000)
            captured, captured_year = time.strftime("%Y-%m", when), when.tm_year
        lon0, lat0 = img["computed_geometry"]["coordinates"][:2]
        distance = (
            math.hypot((lon0 - ref.lon) * math.cos(math.radians(ref.lat)), lat0 - ref.lat)
            * 111_320.0
        )
        return [
            ImageCandidate(
                kind="facade",
                source="Detroit Street View (Mapillary)" if from_creator else "Mapillary",
                url=img["thumb_1024_url"],
                attribution="© Mapillary contributors, CC BY-SA",
                link=f"https://www.mapillary.com/app/?pKey={img['id']}",
                captured=captured,
                captured_year=captured_year,
                distance_m=round(distance, 1),
            )
        ]


# --------------------------------------------------------------------------- aerial sources


class ExportAerial:
    """An ArcGIS exportImage/export endpoint → a deterministic, keyless image URL. No request
    is made here; the browser loads the URL directly."""

    def __init__(
        self,
        name: str,
        base: str,
        attribution: str,
        captured: str,
        extra: dict[str, str] | None = None,
    ) -> None:
        """O(1) time, O(1) space — n = 4 settings."""
        self.name = name
        self._base = base
        self._attribution = attribution
        self._captured = captured
        self._extra = extra or {}

    async def find(self, ref: BuildingRef, client: httpx.AsyncClient) -> list[ImageCandidate]:
        """O(1) time, O(1) space — n = 1 URL built."""
        url = _export_url(self._base, ref, AERIAL_HALF_M, self._extra)
        return [
            ImageCandidate("aerial", self.name, url, self._attribution, captured=self._captured)
        ]


class TileAerial:
    """A Web Mercator XYZ tile cache (TilesOnly — no export) → the one tile holding the
    building. ADJUSTABLE zoom: 19 ≈ 75 m across at Detroit's latitude."""

    def __init__(self, name: str, template: str, attribution: str, captured: str, zoom: int = 19):
        """O(1) time, O(1) space — n = 4 settings."""
        self.name = name
        self._template = template
        self._attribution = attribution
        self._captured = captured
        self._zoom = zoom

    async def find(self, ref: BuildingRef, client: httpx.AsyncClient) -> list[ImageCandidate]:
        """O(1) time, O(1) space — n = 1 URL built."""
        x, y = tile_xy(ref.lat, ref.lon, self._zoom)
        url = self._template.format(z=self._zoom, x=x, y=y)
        return [
            ImageCandidate("aerial", self.name, url, self._attribution, captured=self._captured)
        ]


# Public domain, all three cities — the fallback aerial everywhere.
NAIP = ExportAerial(
    "USDA NAIP (USGS)",
    "https://imagery.nationalmap.gov/arcgis/rest/services/USGSNAIPImagery/ImageServer/exportImage",
    "USGS, USDA, The National Map",
    "recent NAIP year",
)
COOK_ORTHO = ExportAerial(
    "Cook County 2025 aerial",
    "https://gis.cookcountyil.gov/imagery/rest/services/CookOrtho2025/ImageServer/exportImage",
    "Imagery: Cook County GIS",
    "2025",
    {"bandIds": "0,1,2"},
)
DETROIT_2024 = TileAerial(
    "Detroit 2024 aerial (6 in)",
    "https://tiles.arcgis.com/tiles/qvkbeam7Wirps6zC/arcgis/rest/services/"
    "2024Sp_Wayne_6in_MiSAIL_tileCache/MapServer/tile/{z}/{y}/{x}",
    "Imagery: City of Detroit / Wayne County (MiSAIL)",
    "2024-03",
)
MONTGOMERY_2024 = ExportAerial(
    "Montgomery County 2024 aerial",
    "https://gis.mcohio.org/server/rest/services/Imagery/AUDGIS_MrSID/MapServer/export",
    "Imagery: Montgomery County Auditor GIS",
    "2024",
    {"layers": "show:11"},  # layer 11 = MrSID_2024 (layer 0 = 2022)
)


def city_sources(city: str, mapillary_token: str) -> list[ImageSource]:
    """O(1) time, O(1) space — s = ≤ 4 sources. The ONLY place a city's sources are chosen —
    each city lists its own; an unknown city gets the national aerial only."""
    if city == "chicago":
        return [CookAssessorPhotos(), COOK_ORTHO, NAIP]
    if city == "detroit":
        return [MapillaryPhotos(mapillary_token, creator="codgis"), DETROIT_2024, NAIP]
    if city == "dayton":
        return [MapillaryPhotos(mapillary_token), MONTGOMERY_2024, NAIP]
    return [NAIP]


def google_maps_streetview_link(lat: float, lon: float) -> str:
    """O(1) time, O(1) space — n = 1 URL. Google Maps URLs (free, no key): opens Street View
    on Google's own site — allowed anywhere, nothing is fetched or stored by us."""
    return "https://www.google.com/maps/@?" + urlencode(
        {"api": "1", "map_action": "pano", "viewpoint": f"{lat:.6f},{lon:.6f}"}
    )


# --------------------------------------------------------------------------- quality rule

# ADJUSTABLE: a free street-level photo older than this is "poor" — the paid Street View
# photo is then offered too (asked 2026-10-02: paid only when free is missing or poor).
# Cook County's photos are from 2006–08, so at 10 years every Chicago one counts as old;
# raise to ~25 to treat them as good and offer Google only where there's no photo at all.
MAX_FACADE_AGE_YEARS = 10
# ADJUSTABLE: a Mapillary photo taken farther than this from the building is "poor"
# (likely another frontage). The search radius itself is 50 m.
MAX_FACADE_DISTANCE_M = 35.0


def facade_is_poor(c: ImageCandidate, this_year: int) -> str:
    """O(1) time, O(1) space — n = 1 photo. Why the free photo is poor, or "" if it's fine."""
    if c.captured_year is not None and this_year - c.captured_year > MAX_FACADE_AGE_YEARS:
        return f"free photo is from {c.captured_year}"
    if c.distance_m is not None and c.distance_m > MAX_FACADE_DISTANCE_M:
        return f"free photo was taken {round(c.distance_m)} m away"
    return ""


def paid_streetview_reason(facades: list[ImageCandidate], this_year: int) -> str:
    """O(f) time, O(1) space — f = free facade photos (0–1).

    Why the paid Street View photo should be offered for this building, or "" when a good
    free photo exists (then Google is never asked at all).
    """
    if not facades:
        return "no free street-level photo"
    # O(f) time, O(1) space — f = facades
    reasons = [facade_is_poor(c, this_year) for c in facades]
    # O(f) time, O(1) space — f = reasons
    return "" if any(r == "" for r in reasons) else reasons[0]


# --------------------------------------------------------------------------- service


@dataclass
class BuildingImages:
    facade: list[ImageCandidate] = field(default_factory=list)
    aerial: list[ImageCandidate] = field(default_factory=list)
    google_maps_url: str = ""
    mapillary_configured: bool = False

    def to_json(self) -> dict:
        """O(c) time, O(c) space — c = candidates."""
        return {
            # O(c) time, O(c) space — c = facade candidates
            "facade": [asdict(c) for c in self.facade],
            # O(c) time, O(c) space — c = aerial candidates
            "aerial": [asdict(c) for c in self.aerial],
            "google_maps_url": self.google_maps_url,
            "mapillary_configured": self.mapillary_configured,
        }


class BuildingImageService:
    """Runs a city's free sources and caches the answer in memory for a short while (never
    on disk: Mapillary URLs expire and nothing here is ours to keep)."""

    # ADJUSTABLE: how long an answer is reused. Mapillary URLs live ~30 days, so an hour is
    # safe; longer saves a few free calls but risks showing a stale "no photo".
    TTL_S = 3600
    # ADJUSTABLE: how long an answer with a FAILED source is reused (then retried).
    FAILED_TTL_S = 60
    MAX_ENTRIES = 2000

    def __init__(self, mapillary_token: str = "", timeout_s: float = 8.0) -> None:
        """O(1) time, O(1) space — n = 2 settings."""
        self._token = real_key(mapillary_token)
        self._timeout = timeout_s
        self._cache: OrderedDict[tuple, tuple[float, BuildingImages]] = (
            OrderedDict()
        )  # key → (expiry, answer)

    async def find(self, ref: BuildingRef) -> BuildingImages:
        """O(s) time, O(s) space — s = sources for the city (≤ 3, run concurrently)."""
        key = (ref.city, ref.pin, round(ref.lat, 5), round(ref.lon, 5))
        hit = self._cache.get(key)
        if hit and time.monotonic() < hit[0]:  # hit[0] = expiry time
            self._cache.move_to_end(key)
            return hit[1]
        sources = city_sources(ref.city, self._token)
        async with httpx.AsyncClient(timeout=self._timeout, follow_redirects=True) as client:
            # O(s) time, O(s) space — s = sources (concurrent)
            found = await asyncio.gather(
                *(s.find(ref, client) for s in sources), return_exceptions=True
            )
        result = BuildingImages(
            google_maps_url=google_maps_streetview_link(ref.lat, ref.lon),
            mapillary_configured=bool(self._token),
        )
        failed = False
        # O(c) time, O(1) space — c = candidates across sources
        for group in found:
            if isinstance(group, BaseException):
                failed = True  # one source failing never hides the others
                continue
            # bigo-lint: disable=BIGO006 — amortised: each candidate is visited once overall (c)
            # O(g) time, O(1) space — g = candidates from this source (0–1)
            for cand in group:
                (result.facade if cand.kind == "facade" else result.aerial).append(cand)
        ttl = self.FAILED_TTL_S if failed else self.TTL_S
        self._cache[key] = (time.monotonic() + ttl, result)
        if len(self._cache) > self.MAX_ENTRIES:
            self._cache.popitem(last=False)
        return result
