"""Dayton parks → parks table (draft migration 005), never the parcels table.

WHY: the fork's dayton.yaml declared an Overpass `parks` source that run.py never read.
    Its ParkLayer then painted the unfiltered `parcels` source-layer green. The parks
    need their own table.

SOURCE: OSM Overpass `leisure=park` inside the profile bbox (39.65,-84.35,39.85,-84.05).
    UNPROVEN: Five Rivers MetroParks may publish an authoritative layer. Check it in plan D1
    and prefer it if it exists, keeping OSM as the fallback.

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DaytonParksImporter(BaseImporter):
    layer_name = "parks"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = park features in the bbox (low hundreds).

        One Overpass query (ways and relations, with geometry), cached.
        """
        raise NotImplementedError("skeleton: DaytonParksImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(n) space — n = park features.

        Assemble polygons from OSM ways/relations and drop unnamed ones under 500 m².
        ADJUSTABLE: the 500 m² floor. Raise it to declutter, lower it to keep pocket parks.
        """
        raise NotImplementedError("skeleton: DaytonParksImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(n) time, O(n) space — n = records.

        Delete this city's parks, then insert.
        """
        raise NotImplementedError("skeleton: DaytonParksImporter.load")
