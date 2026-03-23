"""CLI entry point: python -m app.data_import.interior"""

import argparse
import sys

import structlog

from app.database import sync_session_factory


def main() -> None:
    parser = argparse.ArgumentParser(description="Interior maps data import")
    sub = parser.add_subparsers(dest="command")

    # Scrape subcommand
    scrape = sub.add_parser("scrape", help="Run venue scraping")
    scrape.add_argument("--city", required=True, help="City UUID")
    scrape.add_argument("--max-targets", type=int, default=None, help="Max targets to process")
    scrape.add_argument("--dry-run", action="store_true", help="Query POIs but skip crawling")
    scrape.add_argument("--category", default=None, help="Filter to a single venue category")

    # Sanborn subcommand
    sanborn = sub.add_parser("sanborn", help="Download Sanborn map sheets")
    sanborn.add_argument("--city", required=True, help="City name (e.g. 'Chicago')")
    sanborn.add_argument("--state", default="Illinois", help="State name")
    sanborn.add_argument("--max-sheets", type=int, default=None, help="Max sheets to download")

    # Permits subcommand
    permits = sub.add_parser("permits", help="Import building permits")
    permits.add_argument("--city", required=True, help="City name")
    permits.add_argument("--max-permits", type=int, default=5000, help="Max permits to fetch")

    args = parser.parse_args()

    structlog.configure(
        processors=[
            structlog.stdlib.add_log_level,
            structlog.dev.ConsoleRenderer(),
        ],
        wrapper_class=structlog.stdlib.BoundLogger,
        context_class=dict,
        logger_factory=structlog.PrintLoggerFactory(),
    )
    logger = structlog.get_logger()

    if not args.command:
        parser.print_help()
        sys.exit(1)

    with sync_session_factory() as session:
        if args.command == "scrape":
            from app.data_import.interior.venue_scraper_runner import VenueScraperRunner

            runner = VenueScraperRunner(session)
            stats = runner.run(
                city_id=args.city,
                max_targets=args.max_targets,
                dry_run=args.dry_run,
                category_filter=args.category,
            )
            logger.info("scrape.complete", **stats)

        elif args.command == "sanborn":
            from app.adapters.storage import get_storage_adapter
            from app.data_import.interior.sanborn_downloader import SanbornDownloader

            storage = get_storage_adapter()
            downloader = SanbornDownloader(storage)
            stats = downloader.download_city(
                city=args.city,
                state=args.state,
                max_sheets=args.max_sheets,
            )
            logger.info("sanborn.complete", **stats)

        elif args.command == "permits":
            from app.data_import.interior.permit_importer import PermitImporter

            importer = PermitImporter(session)
            stats = importer.import_city(max_permits=args.max_permits)
            logger.info("permits.complete", **stats)


if __name__ == "__main__":
    main()
