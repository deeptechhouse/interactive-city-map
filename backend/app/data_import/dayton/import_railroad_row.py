"""Dayton railroad right-of-way → railroad_row (Chicago-parity layer).

PURPOSE
    A port of the fork's scripts/generate_railroad_row.py (450 lines; 27 features as of
    2026-03-25). That script wrote a TypeScript data file directly. Here the same three
    sources become a table, and the static exporter produces the frontend asset, so it can
    be re-run and tested like every other layer:
      1. Railroad-owned parcels (now from the parcels table, after DaytonParcelsImporter;
         the fork queried City MapServer/9 live)
      2. OSM railway ways, buffered to approximate ROW corridors
      3. OSM landuse=railway areas (yards)

TRAPS
    - The fork buffered in DEGREES (0.00027° ≈ 30 m). That is wrong east–west at 39.7°N,
      where 30 m ≈ 0.00035° of longitude. Buffer in a metric CRS (EPSG:3735, Ohio South ft,
      or UTM 16N) and reproject back.
    - ADJUSTABLE: ROW_BUFFER_M = 30. Wider merges parallel tracks into one corridor.
    - Owner matching: keep the fork's owner-name patterns (CSX, NORFOLK SOUTHERN, …) in
      one tuple, and log parcels whose owner contains "RAIL" but match no pattern.

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter

ROW_BUFFER_M = 30  # ADJUSTABLE: 15–60 m. Above ~60 m, adjacent industrial lots merge in.


class DaytonRailroadRowImporter(BaseImporter):
    layer_name = "railroad_row"

    def download(self) -> Path:
        """O(w + a) time, O(w + a) space — w = OSM railway ways; a = landuse=railway areas.

        Two Overpass queries. Parcels come from the DB, not the network.
        """
        raise NotImplementedError("skeleton: DaytonRailroadRowImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n log n) time, O(n) space — n = input polygons (unary_union is the floor).

        Union railroad-owned parcels, buffered tracks and yards, then dissolve by owner.
        """
        raise NotImplementedError("skeleton: DaytonRailroadRowImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = dissolved corridors.

        Delete this city's rows, then insert.
        """
        raise NotImplementedError("skeleton: DaytonRailroadRowImporter.load")
