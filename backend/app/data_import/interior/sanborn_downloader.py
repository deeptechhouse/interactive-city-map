"""Downloads Sanborn fire insurance map sheets from Library of Congress IIIF API."""

from __future__ import annotations

from pathlib import Path

import httpx
import structlog

from app.adapters.storage import StorageAdapter


class SanbornDownloader:
    """Discovers and downloads Sanborn map sheets via the LOC API."""

    LOC_API = "https://www.loc.gov/collections/sanborn-maps/"
    IIIF_SUFFIX = "/full/max/0/default.jpg"
    USER_AGENT = "CityMapBot/1.0 (+https://github.com/interactive-city-map)"

    def __init__(self, storage: StorageAdapter, output_dir: str = "data/sanborn") -> None:
        self._storage = storage
        self._output_dir = Path(output_dir)
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._logger = structlog.get_logger()

    def search_sheets(self, city: str, state: str) -> list[dict]:
        """Query LOC for Sanborn sheets matching city/state.

        Returns:
            List of dicts with keys: id, title, year, iiif_url.
        """
        params = {
            "q": f"{city} {state}",
            "fo": "json",
            "c": 100,
            "sp": 1,
        }
        headers = {"User-Agent": self.USER_AGENT}
        sheets: list[dict] = []

        try:
            with httpx.Client(timeout=30, headers=headers) as client:
                response = client.get(self.LOC_API, params=params)
                response.raise_for_status()
                data = response.json()

                results = data.get("results", [])
                for item in results:
                    item_id = item.get("id", "")
                    title = item.get("title", "")
                    date_str = item.get("date", "")

                    # Extract IIIF URL from the item's image_url or resources
                    image_url = item.get("image_url", [])
                    iiif_url = image_url[0] if image_url else None

                    if iiif_url:
                        sheets.append({
                            "id": item_id,
                            "title": title,
                            "year": date_str,
                            "iiif_url": iiif_url,
                        })

        except Exception as exc:
            self._logger.error("sanborn.search_failed", city=city, state=state, error=str(exc))

        self._logger.info("sanborn.search_complete", city=city, sheets_found=len(sheets))
        return sheets

    def download_sheet(self, sheet: dict) -> str | None:
        """Download a single sheet via IIIF.

        Returns:
            Local file path or None on failure.
        """
        iiif_url = sheet.get("iiif_url", "")
        if not iiif_url:
            return None

        # Build full IIIF image URL if not already a direct image link
        if not iiif_url.endswith((".jpg", ".jpeg", ".png", ".tif")):
            download_url = iiif_url.rstrip("/") + self.IIIF_SUFFIX
        else:
            download_url = iiif_url

        sheet_id = sheet.get("id", "unknown").replace("/", "_").strip("_")
        filename = f"{sheet_id}.jpg"
        output_path = self._output_dir / filename

        headers = {"User-Agent": self.USER_AGENT}

        try:
            with httpx.Client(timeout=60, headers=headers) as client:
                response = client.get(download_url)
                response.raise_for_status()

                output_path.write_bytes(response.content)
                self._logger.info(
                    "sanborn.sheet_downloaded",
                    sheet_id=sheet_id,
                    size_bytes=len(response.content),
                )
                return str(output_path)

        except Exception as exc:
            self._logger.error(
                "sanborn.download_failed",
                sheet_id=sheet_id,
                url=download_url,
                error=str(exc),
            )
            return None

    def download_city(
        self, city: str, state: str, max_sheets: int | None = None
    ) -> dict:
        """Download all Sanborn sheets for a city.

        Returns:
            Stats dict with sheets_found, sheets_downloaded, errors.
        """
        stats = {"sheets_found": 0, "sheets_downloaded": 0, "errors": 0}

        sheets = self.search_sheets(city, state)
        stats["sheets_found"] = len(sheets)

        to_download = sheets[:max_sheets] if max_sheets else sheets

        for sheet in to_download:
            result = self.download_sheet(sheet)
            if result is not None:
                stats["sheets_downloaded"] += 1
            else:
                stats["errors"] += 1

        self._logger.info("sanborn.city_complete", city=city, **stats)
        return stats
