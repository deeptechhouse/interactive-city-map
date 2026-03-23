#!/usr/bin/env python3
"""Standalone CLI for venue floor plan scraping."""

import argparse
import sys

sys.path.insert(0, ".")

from app.database import sync_session_factory
from app.data_import.interior.venue_scraper_runner import VenueScraperRunner


def main() -> None:
    parser = argparse.ArgumentParser(description="Run venue floor plan scraping")
    parser.add_argument("--city-id", required=True, help="UUID of the city")
    parser.add_argument("--max-targets", type=int, default=None, help="Max targets to process")
    parser.add_argument("--dry-run", action="store_true", help="Query POIs but skip crawling")
    parser.add_argument("--category", default=None, help="Filter to a single venue category")
    args = parser.parse_args()

    with sync_session_factory() as session:
        runner = VenueScraperRunner(session)
        stats = runner.run(
            city_id=args.city_id,
            max_targets=args.max_targets,
            dry_run=args.dry_run,
            category_filter=args.category,
        )
        print(f"Results: {stats}")


if __name__ == "__main__":
    main()
