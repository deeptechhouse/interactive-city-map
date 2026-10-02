"""Dayton arterial streets → major_streets (labels on the map).

WHY: the shared import_streets is a "TIGER for Cook County" stub, and the fork never loaded
    major_streets. Chicago's rows were inserted by hand (new_city_guide §7). Here they come
    from the City's street centerlines, filtered by road class.

UNPROVEN: the road-class field name and values in MapLayers_Citywide/312. Read `?f=json`
    first. If no class field exists, fall back to a curated name list (Main, Third, Salem,
    Keowee, Wayne, Brown, Gettysburg, Linden, Smithville, …) and record the decision here.

STATUS — SKELETON (2026-10-02). Wired in through dayton/plan.py.
"""

from pathlib import Path

from app.data_import.base_importer import BaseImporter


class DaytonMajorStreetsImporter(BaseImporter):
    layer_name = "major_streets"

    def download(self) -> Path:
        """O(n) time, O(n) space — n = centerline segments returned for the arterial classes.

        One paged ArcGIS query, filtered server-side by road class.
        """
        raise NotImplementedError("skeleton: DaytonMajorStreetsImporter.download")

    def transform(self, raw_path: Path) -> list[dict]:
        """O(n) time, O(s) space — n = segments; s = distinct street names (dict merge by name).

        Merge segments per street name into one MultiLineString.
        """
        raise NotImplementedError("skeleton: DaytonMajorStreetsImporter.transform")

    def load(self, records: list[dict]) -> int:
        """O(s) time, O(s) space — s = streets.

        Delete this city's rows, then insert.
        """
        raise NotImplementedError("skeleton: DaytonMajorStreetsImporter.load")
