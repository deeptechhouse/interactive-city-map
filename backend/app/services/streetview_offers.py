"""Single-use passes that tie every PAID Street View photo to a real offer.

WHY (review finding, 2026-10-04): the photo endpoint only checked that the request came
from our own pop-up page — but any website could OPEN that page (window.open / a link)
with any coordinates, and the page's own <img> then looked "same-origin" and was billed.
That skipped the user's rule entirely (paid only after a search, only when the free photo
is missing or poor).

HOW: routes/images.py's _paid_offer — the one place that applies the rule — mints a pass
when it offers a photo. The pop-up must present it; /photo redeems it ONCE, just before the
paid request. No pass → no charge. Passes are HMAC-signed with a secret that lives only in
this process's memory, are bound to the building's coordinates, and expire.

    token = "<expiry>.<nonce>.<signature>"     signature = HMAC(secret, lat|lon|expiry|nonce)

ARCHITECTURE: OfferPasses is stateful (used-nonce memory) and thread-safe; pure HMAC
    helpers inside. A server restart forgets the secret, so old passes simply stop working
    (the card fetches a fresh offer).
"""

from __future__ import annotations

import hashlib
import hmac
import os
import threading
import time

# ADJUSTABLE: how long an offer stays usable. Long enough to read the card and click;
# short so a leaked pass is worthless soon. Above ~1 h there's no benefit.
PASS_TTL_S = 30 * 60


# O(1) time, O(1) space — n = 1 key string
def _place(lat: float, lon: float) -> str:
    return f"{lat:.6f},{lon:.6f}"


class OfferPasses:
    """Mint and redeem single-use passes. O(1) amortised per call."""

    # O(1) time, O(1) space — n = 1 secret
    def __init__(self, secret: bytes | None = None, ttl_s: int = PASS_TTL_S) -> None:
        self._secret = secret or os.urandom(32)  # never written anywhere
        self._ttl = ttl_s
        self._used: dict[str, float] = {}  # nonce → expiry (forgotten after it expires)
        self._lock = threading.Lock()

    # O(1) time, O(1) space — n = 1 signature
    def _sign(self, place: str, expiry: int, nonce: str) -> str:
        msg = f"{place}|{expiry}|{nonce}".encode()
        return hmac.new(self._secret, msg, hashlib.sha256).hexdigest()[:32]

    # O(1) time, O(1) space — n = 1 pass
    def mint(self, lat: float, lon: float) -> str:
        expiry = int(time.time()) + self._ttl
        nonce = os.urandom(8).hex()
        return f"{expiry}.{nonce}.{self._sign(_place(lat, lon), expiry, nonce)}"

    # O(1) time, O(1) space — n = 1 pass checked
    def is_valid(self, token: str, lat: float, lon: float) -> bool:
        """Signed for this place, not expired, not used yet. Does NOT consume it."""
        try:
            expiry_s, nonce, sig = token.split(".")
            expiry = int(expiry_s)
        except ValueError:
            return False
        if expiry < time.time() or nonce in self._used:
            return False
        return hmac.compare_digest(sig, self._sign(_place(lat, lon), expiry, nonce))

    # O(u) time, O(u) space — u = passes used in the last PASS_TTL_S (pruned here)
    def redeem(self, token: str, lat: float, lon: float) -> bool:
        """Consume the pass — True exactly once per valid pass."""
        with self._lock:
            if not self.is_valid(token, lat, lon):
                return False
            now = time.time()
            # Expired nonces can be forgotten: their passes fail the expiry check anyway.
            # O(u) time, O(u) space — u = remembered nonces
            expired = [n for n, exp in self._used.items() if exp < now]
            # O(u) time, O(1) space — u = expired nonces
            for old in expired:
                del self._used[old]
            expiry_s, nonce, _ = token.split(".")
            self._used[nonce] = float(expiry_s)
            return True
