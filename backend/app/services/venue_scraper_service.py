"""Crawls venue websites to discover floor plan images.

Respects ``robots.txt``, enforces per-domain rate limiting, and
scores candidate images based on keyword relevance in URLs, alt
text, and page context.
"""

from __future__ import annotations

import time
from urllib.parse import urljoin, urlparse
from urllib.robotparser import RobotFileParser

import httpx
from bs4 import BeautifulSoup


class VenueScraperService:
    """Discovers floor plan images by crawling venue websites."""

    RATE_LIMIT_SECONDS: float = 1.0
    USER_AGENT: str = "CityMapBot/1.0 (+https://github.com/interactive-city-map)"
    MIN_IMAGE_SIZE: int = 50 * 1024  # 50 KB minimum for floor plan candidates

    FLOOR_PLAN_KEYWORDS: set[str] = {
        "floor", "plan", "layout", "map", "diagram", "blueprint", "floorplan",
    }
    EXCLUDE_KEYWORDS: set[str] = {
        "logo", "icon", "avatar", "banner", "social", "favicon",
    }
    VALID_EXTENSIONS: set[str] = {
        ".png", ".jpg", ".jpeg", ".gif", ".webp", ".svg", ".pdf",
    }
    ASPECT_RATIO_RANGE: tuple[float, float] = (0.3, 3.0)

    # Page-link keywords that suggest floor plan content nearby
    _PRIORITY_LINK_KEYWORDS: set[str] = {
        "floor", "plan", "layout", "gallery", "photo", "virtual",
        "tour", "map", "venue", "room", "space", "event",
    }

    def __init__(self) -> None:
        self._last_request_time: dict[str, float] = {}
        self._robots_cache: dict[str, RobotFileParser] = {}

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def crawl(self, url: str, max_pages: int = 10) -> list[dict]:
        """Crawl a venue website looking for floor plan images.

        Args:
            url: Starting URL.
            max_pages: Maximum number of pages to visit.

        Returns:
            List of candidate dicts sorted by descending score.  Each
            dict has keys: ``url``, ``alt_text``, ``page_url``, ``score``.
        """
        if not self._check_robots(url):
            return []

        domain = urlparse(url).netloc
        visited: set[str] = set()
        candidates: list[dict] = []
        to_visit: list[str] = [url]

        headers = {"User-Agent": self.USER_AGENT}

        with httpx.Client(timeout=30, follow_redirects=True, headers=headers) as client:
            while to_visit and len(visited) < max_pages:
                current_url = to_visit.pop(0)
                if current_url in visited:
                    continue
                visited.add(current_url)

                self._rate_limit(domain)

                try:
                    response = client.get(current_url)
                    if response.status_code != 200:
                        continue
                    if "text/html" not in response.headers.get("content-type", ""):
                        continue
                except Exception:
                    continue

                soup = BeautifulSoup(response.text, "html.parser")

                # Evaluate images on this page
                for img in soup.find_all("img"):
                    src = img.get("src", "")
                    if not src:
                        continue
                    img_url = urljoin(current_url, src)
                    alt = (img.get("alt", "") or "").lower()

                    score = self._score_candidate(img_url, alt, current_url)
                    if score > 0:
                        candidates.append({
                            "url": img_url,
                            "alt_text": alt,
                            "page_url": current_url,
                            "score": score,
                        })

                # Discover same-domain links, prioritising likely floor-plan pages
                for anchor in soup.find_all("a", href=True):
                    link = urljoin(current_url, anchor["href"])
                    if urlparse(link).netloc != domain or link in visited:
                        continue
                    link_text = (anchor.get_text() or "").lower()
                    if any(kw in link_text or kw in link for kw in self._PRIORITY_LINK_KEYWORDS):
                        to_visit.insert(0, link)
                    else:
                        to_visit.append(link)

        candidates.sort(key=lambda c: c["score"], reverse=True)
        return candidates

    def download_image(self, url: str) -> tuple[bytes | None, str]:
        """Download an image and return ``(data, content_type)``.

        Returns ``(None, "")`` if the download fails or the image is
        smaller than :attr:`MIN_IMAGE_SIZE`.
        """
        domain = urlparse(url).netloc
        self._rate_limit(domain)

        try:
            with httpx.Client(timeout=30, headers={"User-Agent": self.USER_AGENT}) as client:
                response = client.get(url)
                if response.status_code != 200:
                    return None, ""

                content_type = response.headers.get("content-type", "")
                data = response.content

                if len(data) < self.MIN_IMAGE_SIZE:
                    return None, ""

                return data, content_type
        except Exception:
            return None, ""

    # ------------------------------------------------------------------
    # Internals
    # ------------------------------------------------------------------

    def _check_robots(self, url: str) -> bool:
        """Check ``robots.txt`` for crawl permission."""
        parsed = urlparse(url)
        base = f"{parsed.scheme}://{parsed.netloc}"

        if base not in self._robots_cache:
            rp = RobotFileParser()
            try:
                rp.set_url(f"{base}/robots.txt")
                rp.read()
            except Exception:
                # Unreachable robots.txt — default to allow
                rp = RobotFileParser()
            self._robots_cache[base] = rp

        return self._robots_cache[base].can_fetch(self.USER_AGENT, url)

    def _rate_limit(self, domain: str) -> None:
        """Enforce per-domain rate limiting."""
        now = time.time()
        if domain in self._last_request_time:
            elapsed = now - self._last_request_time[domain]
            if elapsed < self.RATE_LIMIT_SECONDS:
                time.sleep(self.RATE_LIMIT_SECONDS - elapsed)
        self._last_request_time[domain] = time.time()

    def _score_candidate(self, img_url: str, alt_text: str, page_url: str) -> float:
        """Score an image URL as a floor plan candidate.

        Returns 0 if the image is definitely not a floor plan candidate.
        """
        url_lower = img_url.lower()

        # Must have a valid image extension
        if not any(url_lower.endswith(ext) for ext in self.VALID_EXTENSIONS):
            return 0.0

        # Reject obvious non-floor-plan images
        if any(kw in url_lower or kw in alt_text for kw in self.EXCLUDE_KEYWORDS):
            return 0.0

        score = 0.0
        combined = f"{url_lower} {alt_text} {page_url.lower()}"

        for kw in self.FLOOR_PLAN_KEYWORDS:
            if kw in combined:
                score += 1.0

        # Bonus for high-confidence phrases
        if "floor" in combined and "plan" in combined:
            score += 2.0
        if "layout" in combined:
            score += 1.5

        return score
