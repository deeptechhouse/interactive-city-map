"""Refuse paid lookups whose location contradicts itself — before any provider is called.

PURPOSE
    Tracerfy (owner skip trace, 1–5 credits per hit), Google Places and Foursquare all
    bill per request. With three cities on one map, the expensive failure is a request
    that names one city but describes a building in another — e.g. a Detroit building
    sent as "Chicago, IL" (the owner-batch route did exactly that until 2026-10-02,
    TDD §13 F-1). The frontend now sends the right city; this module is the server-side
    backstop so a future client bug costs a 422, not credits.

WHAT IT CHECKS (only contradictions it can prove — never a legitimate request)
    check_point  map coordinates must lie near the city they claim (known cities only).
                 Owner-company phone lookups send no coordinates (the company's office
                 may be anywhere), so they are never blocked.
    check_zip    a ZIP must belong to the state it is sent with (known states only).
    Unknown cities/states pass: the guard cannot prove them wrong.

ARCHITECTURE
    Pure functions returning None (ok) or a human-readable reason. routes/contacts.py
    turns a reason into HTTP 422 before calling any service.

TO ADD A CITY: add its (name, state) → centre to KNOWN_CITIES and, for a new state, its
    ZIP3 range to STATE_ZIP3.
"""

import math

# (city, state) → (lat, lon) of the city centre. Keys are lower-case city, upper-case state.
KNOWN_CITIES: dict[tuple[str, str], tuple[float, float]] = {
    ("chicago", "IL"): (41.8781, -87.6298),
    ("detroit", "MI"): (42.3314, -83.0458),
    ("dayton", "OH"): (39.7589, -84.1916),
}

# ADJUSTABLE: how far (km) a building may be from its city's centre. Must cover the city
# limits plus the edge of each static map (Chicago's box reaches ~35 km from the Loop).
# Detroit ↔ Chicago are ~380 km apart and Dayton ↔ Detroit ~280 km, so 60 km never
# confuses two cities.
MAX_CITY_RADIUS_KM = 60.0

# State → (first, last) 3-digit ZIP prefix (USPS). Source: USPS ZIP prefix allocation.
STATE_ZIP3: dict[str, tuple[int, int]] = {
    "IL": (600, 629),
    "MI": (480, 499),
    "OH": (430, 459),
}


def _distance_km(lat1: float, lon1: float, lat2: float, lon2: float) -> float:
    """O(1) time, O(1) space — n = 2 points (haversine great-circle distance)."""
    p1, p2 = math.radians(lat1), math.radians(lat2)
    dp, dl = p2 - p1, math.radians(lon2 - lon1)
    a = math.sin(dp / 2) ** 2 + math.cos(p1) * math.cos(p2) * math.sin(dl / 2) ** 2
    return 6371.0 * 2 * math.asin(math.sqrt(a))


def check_point(city: str, state: str, lat: float | None, lon: float | None) -> str | None:
    """O(1) time, O(1) space — n = 1 lookup + 1 distance.

    Reason the coordinates can't belong to (city, state), or None when consistent,
    unknown, or no coordinates were sent.
    """
    if lat is None or lon is None:
        return None
    centre = KNOWN_CITIES.get((city.strip().lower(), state.strip().upper()))
    if centre is None:
        return None
    distance = _distance_km(lat, lon, *centre)
    if distance > MAX_CITY_RADIUS_KM:
        return (
            f"Location is {distance:.0f} km from {city.strip()}, {state.strip().upper()} — "
            "the request names the wrong city, so no paid lookup was made."
        )
    return None


def check_zip(state: str, zip_code: str) -> str | None:
    """O(1) time, O(1) space — n = 1 prefix comparison.

    Reason the ZIP can't be in `state`, or None when consistent, unknown, or empty.
    """
    zip_code = (zip_code or "").strip()
    span = STATE_ZIP3.get(state.strip().upper())
    if not zip_code or span is None or not zip_code[:3].isdigit():
        return None
    if not span[0] <= int(zip_code[:3]) <= span[1]:
        return (
            f"ZIP {zip_code} is not in {state.strip().upper()} — the request names the wrong "
            "state, so no paid lookup was made."
        )
    return None


def check_city_slug(slug: str, lat: float | None, lon: float | None) -> str | None:
    """O(c) time, O(1) space — c = known cities (3).

    The map's city slug ('detroit') must agree with the coordinates too — it chooses the
    provider order, and a Chicago slug on a Detroit building is the same wrong-city bug.
    """
    if lat is None or lon is None:
        return None
    # O(c) time, O(1) space — c = known cities
    for (name, state), _centre in KNOWN_CITIES.items():
        if name == slug.strip().lower():
            return check_point(name, state, lat, lon)
    return None
