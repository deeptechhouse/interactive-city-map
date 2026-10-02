"""Per-city importer selection for run.py — which importer class handles each layer.

PURPOSE
    run.py used to run one fixed IMPORTER_ORDER with the same classes for every city. That
    is why the Detroit blight importer would also run for Chicago and write Detroit blight
    rows under Chicago's city_id (backend audit 2026-10-02). This module is the single
    answer to "what does run.py import for <city>?".

TWO PIPELINES, ONE RULE EACH
    * Chicago → run.py with CHICAGO_IMPORTERS below (its original order, minus the three
      Detroit-only layers). Pinned by tests/test_city_registry.py — change it on purpose.
    * Detroit, Dayton → scripts/load_city_db.py (app/data_import/db_load.py), which writes
      the rows of the city's StaticPlan. Their importers are only correct together with
      the plan's enrich joins, so run.py refuses them instead of half-importing.

TO ADD A CITY: give it a StaticPlan and load it with scripts/load_city_db.py; add it to
    PLAN_LOADED_CITIES so run.py points people there.
"""

from app.data_import.base_importer import BaseImporter
from app.data_import.import_buildings import BuildingsImporter
from app.data_import.import_parcels import ParcelsImporter
from app.data_import.import_pois import POIsImporter
from app.data_import.import_railroads import RailroadsImporter
from app.data_import.import_streets import StreetsImporter
from app.data_import.import_transit import TransitImporter
from app.data_import.import_waterways import WaterwaysImporter
from app.data_import.import_zoning import ZoningImporter

ImporterPlan = list[tuple[str, type[BaseImporter]]]

# Chicago, in dependency order: parcels → buildings → zoning → … Order matters because
# later steps join rows the earlier ones loaded. Deliberately absent (Detroit-only):
# neighborhoods, dlba_properties, blight_violations.
CHICAGO_IMPORTERS: ImporterPlan = [
    ("parcels", ParcelsImporter),
    ("buildings", BuildingsImporter),
    ("zoning", ZoningImporter),
    ("railroads", RailroadsImporter),
    ("transit", TransitImporter),
    ("waterways", WaterwaysImporter),
    ("pois", POIsImporter),
    ("streets", StreetsImporter),
]

# Cities loaded from their StaticPlan by scripts/load_city_db.py, never by run.py.
PLAN_LOADED_CITIES = frozenset({"detroit", "dayton"})


class UseCityLoaderError(ValueError):
    """run.py was asked for a city whose rows come from scripts/load_city_db.py."""


def importers_for(city_slug: str) -> ImporterPlan:
    """O(l) time, O(l) space — l = layers in the plan (8).

    Ordered (layer_name, importer_class) pairs run.py runs for a city.
    """
    if city_slug == "chicago":
        return list(CHICAGO_IMPORTERS)
    if city_slug in PLAN_LOADED_CITIES:
        raise UseCityLoaderError(
            f"{city_slug} is loaded with: "
            f".venv-db/bin/python -m scripts.load_city_db --city {city_slug}"
        )
    raise UseCityLoaderError(
        f"no importer plan for {city_slug!r} — give it a StaticPlan (see module docstring)"
    )
