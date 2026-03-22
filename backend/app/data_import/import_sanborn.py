"""Import Sanborn fire insurance map sheets from the Library of Congress.

Downloads high-resolution images of Chicago Sanborn maps via the LoC JSON API
and IIIF Image API. Saves images organized by year/sheet and produces a
manifest JSON file cataloguing all downloaded sheets with metadata.

This importer does NOT load data into the database — Sanborn sheets are raster
images that must be manually georeferenced in QGIS before they become map tiles.
The output of this script feeds into the georeference_to_pmtiles.sh pipeline.
"""

import json
import time
from pathlib import Path

import httpx
import structlog

logger = structlog.get_logger(__name__)

LOC_API_BASE = "https://www.loc.gov"
LOC_SEARCH_URL = f"{LOC_API_BASE}/collections/sanborn-maps/"
# IIIF parameters for high-res download (full region, max size, no rotation, default quality)
IIIF_PARAMS = "full/max/0/default.jpg"
# Delay between API requests to respect LoC rate limits
REQUEST_DELAY_S = 1.0


class SanbornImporter:
    """Downloads Sanborn fire insurance map sheets from the Library of Congress.

    Attributes:
        _city: City name to search for (e.g. "chicago").
        _output_dir: Root directory where downloaded sheets are saved.
        _log: Bound structured logger for this importer instance.
        _client: Reusable HTTP client for the session.
    """

    def __init__(self, city: str, output_dir: str):
        self._city = city.lower()
        self._output_dir = Path(output_dir)
        self._output_dir.mkdir(parents=True, exist_ok=True)
        self._log = logger.bind(layer="sanborn", city=self._city)
        self._client: httpx.Client | None = None

    # ------------------------------------------------------------------
    # Public API
    # ------------------------------------------------------------------

    def run(self, max_sheets: int = 50) -> int:
        """Download up to *max_sheets* Sanborn maps. Returns count downloaded."""
        self._log.info("import_start", max_sheets=max_sheets)
        t0 = time.time()

        try:
            self._client = httpx.Client(timeout=120.0, follow_redirects=True)
            sheets = self.search_sheets()
            self._log.info("sheets_found", total=len(sheets))

            downloaded = 0
            manifest_entries: list[dict] = []
            for sheet in sheets[:max_sheets]:
                try:
                    path = self.download_sheet(sheet)
                    manifest_entries.append({
                        "title": sheet.get("title", ""),
                        "date": sheet.get("date", ""),
                        "url": sheet.get("url", ""),
                        "image_url": sheet.get("image_url", ""),
                        "local_path": str(path),
                    })
                    downloaded += 1
                    self._log.info(
                        "sheet_downloaded",
                        progress=f"{downloaded}/{min(max_sheets, len(sheets))}",
                        title=sheet.get("title", "")[:80],
                    )
                except Exception:
                    self._log.exception("sheet_download_failed", title=sheet.get("title", ""))
                time.sleep(REQUEST_DELAY_S)

            self._write_manifest(manifest_entries)
            elapsed = round(time.time() - t0, 1)
            self._log.info("import_complete", downloaded=downloaded, elapsed_s=elapsed)
            return downloaded
        finally:
            if self._client:
                self._client.close()
                self._client = None

    def search_sheets(self) -> list[dict]:
        """Search the LoC API for Sanborn map sheets matching the target city.

        Paginates through all result pages, extracting title, date, URL,
        and IIIF image URL for each sheet.
        """
        all_sheets: list[dict] = []
        page = 1

        while True:
            params = {
                "fo": "json",
                "q": self._city,
                "sp": str(page),
                "c": "50",  # results per page
            }
            url = LOC_SEARCH_URL
            self._log.info("searching", page=page)

            resp = self._api_get(url, params=params)
            if resp is None:
                break

            results = resp.get("results", [])
            if not results:
                break

            for item in results:
                sheet_info = self._parse_search_result(item)
                if sheet_info:
                    all_sheets.append(sheet_info)

            # Check for next page
            pagination = resp.get("pagination", {})
            total_pages = pagination.get("total", 1)
            if page >= total_pages:
                break
            page += 1
            time.sleep(REQUEST_DELAY_S)

        return all_sheets

    def download_sheet(self, sheet_info: dict) -> Path:
        """Download a single Sanborn sheet image to a year-organized directory.

        Args:
            sheet_info: Dict with keys 'title', 'date', 'url', 'image_url'.

        Returns:
            Path to the downloaded image file.

        Raises:
            ValueError: If no image URL is available for the sheet.
            httpx.HTTPStatusError: If the download request fails.
        """
        image_url = sheet_info.get("image_url", "")
        if not image_url:
            raise ValueError(f"No image URL for sheet: {sheet_info.get('title', 'unknown')}")

        # Organize by decade extracted from date
        date_str = sheet_info.get("date", "unknown")
        year_folder = self._extract_year_folder(date_str)
        dest_dir = self._output_dir / year_folder
        dest_dir.mkdir(parents=True, exist_ok=True)

        # Build a safe filename from the title
        safe_title = self._safe_filename(sheet_info.get("title", "sheet"))
        dest_path = dest_dir / f"{safe_title}.jpg"

        if dest_path.exists():
            self._log.info("already_downloaded", path=str(dest_path))
            return dest_path

        assert self._client is not None
        resp = self._client.get(image_url)
        resp.raise_for_status()
        dest_path.write_bytes(resp.content)

        return dest_path

    # ------------------------------------------------------------------
    # Private helpers
    # ------------------------------------------------------------------

    def _api_get(self, url: str, params: dict | None = None) -> dict | None:
        """Make a GET request to the LoC API and return parsed JSON."""
        assert self._client is not None
        try:
            resp = self._client.get(url, params=params)
            resp.raise_for_status()
            return resp.json()
        except httpx.HTTPStatusError:
            self._log.exception("api_request_failed", url=url[:120])
            return None

    def _parse_search_result(self, item: dict) -> dict | None:
        """Extract sheet metadata from a single LoC search result item.

        Returns None if the item cannot be parsed into a usable sheet record.
        """
        title = item.get("title", "")
        date = item.get("date", "")
        item_url = item.get("url", "") or item.get("id", "")

        # The LoC API provides image URLs in the 'image_url' field or
        # within the 'resources' list. We prefer the IIIF endpoint for
        # high-resolution downloads.
        image_url = ""
        resources = item.get("resources", [])
        if resources:
            for resource in resources:
                iiif_service = resource.get("image", "")
                if iiif_service:
                    # Build IIIF URL: {service_base}/{IIIF_PARAMS}
                    image_url = f"{iiif_service}/{IIIF_PARAMS}"
                    break

        # Fall back to the item-level image_url if no IIIF endpoint found
        if not image_url:
            image_url = item.get("image_url", "")
            if isinstance(image_url, list) and image_url:
                image_url = image_url[0]

        if not image_url:
            return None

        return {
            "title": title,
            "date": date,
            "url": item_url,
            "image_url": image_url,
        }

    def _extract_year_folder(self, date_str: str) -> str:
        """Convert a date string like '1895' or '1905-1910' into a folder name."""
        if not date_str:
            return "unknown_era"
        # Take the first 4-digit year found
        for part in date_str.replace("-", " ").split():
            if len(part) == 4 and part.isdigit():
                year = int(part)
                decade = (year // 10) * 10
                return f"{decade}s"
        return date_str.replace(" ", "_").replace("/", "_")[:20]

    @staticmethod
    def _safe_filename(title: str) -> str:
        """Convert an arbitrary title into a filesystem-safe filename."""
        safe = title.lower().strip()
        # Replace problematic characters
        for ch in r'\/:"*?<>|':
            safe = safe.replace(ch, "_")
        safe = safe.replace(" ", "_")
        # Collapse multiple underscores and trim length
        while "__" in safe:
            safe = safe.replace("__", "_")
        return safe[:120].strip("_") or "sheet"

    def _write_manifest(self, entries: list[dict]) -> None:
        """Write a manifest.json file cataloguing all downloaded sheets."""
        manifest_path = self._output_dir / "manifest.json"
        manifest = {
            "city": self._city,
            "total_sheets": len(entries),
            "generated_at": time.strftime("%Y-%m-%dT%H:%M:%SZ", time.gmtime()),
            "sheets": entries,
        }
        manifest_path.write_text(json.dumps(manifest, indent=2))
        self._log.info("manifest_written", path=str(manifest_path), sheets=len(entries))


# ------------------------------------------------------------------
# CLI entry point
# ------------------------------------------------------------------

def main() -> None:
    """CLI entry point for downloading Sanborn maps."""
    import argparse

    parser = argparse.ArgumentParser(
        description="Download Sanborn fire insurance map sheets from the Library of Congress"
    )
    parser.add_argument(
        "--city",
        default="chicago",
        help="City name to search for (default: chicago)",
    )
    parser.add_argument(
        "--output-dir",
        default="./data/sanborn",
        help="Output directory for downloaded sheets (default: ./data/sanborn)",
    )
    parser.add_argument(
        "--max-sheets",
        type=int,
        default=50,
        help="Maximum number of sheets to download (default: 50)",
    )
    args = parser.parse_args()

    importer = SanbornImporter(city=args.city, output_dir=args.output_dir)
    count = importer.run(max_sheets=args.max_sheets)
    print(f"\nDownloaded {count} Sanborn sheets to {args.output_dir}")


if __name__ == "__main__":
    main()
