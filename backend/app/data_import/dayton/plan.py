"""Dayton's importer override map — layer → importer class, None = skipped for Dayton.

STATUS (2026-10-02): NOT used to load the database. Dayton reaches PostGIS through its
    StaticPlan (static_plan.py) via scripts/load_city_db.py → db_load.py, which keeps the
    plan's enrich joins; city_registry.importers_for("dayton") refuses and points there.
    This map is kept as the documented record of which Dayton class replaces each shared
    importer and why a layer is skipped (DAYTON_SKIPPED_LAYERS); tests read it.

The classes are imported lazily inside dayton_importer_overrides(), so importing this
module cannot fail on a machine without shapely.
"""

from app.data_import.base_importer import BaseImporter

ImporterOverrides = dict[str, type[BaseImporter] | None]

# Layers Dayton never imports. Each value is the reason it is skipped.
DAYTON_SKIPPED_LAYERS: dict[str, str] = {
    "dlba_properties": "Detroit Land Bank only; Montgomery County land bank unverified (plan D8)",
    "blight_violations": "no blight block in dayton.yaml; code-enforcement source unverified",
    "council_districts": "Dayton's City Commission is elected at-large, so there are no districts",
    "streets": "replaced by DaytonMajorStreetsImporter (the shared one is a Cook County stub)",
    "railroad_row": "deferred: the port of the fork's generator is not written yet",
}


def dayton_importer_overrides() -> ImporterOverrides:
    """O(l) time, O(l) space — l = overridden layers (~13).

    layer_name → Dayton importer class, or None to skip. Built on each call so the importer
    modules are only imported when an import actually runs.
    """
    from app.data_import.dayton.import_boundaries import DaytonBoundariesImporter
    from app.data_import.dayton.import_buildings import DaytonBuildingsImporter
    from app.data_import.dayton.import_major_streets import DaytonMajorStreetsImporter
    from app.data_import.dayton.import_parcels import DaytonParcelsImporter
    from app.data_import.dayton.import_parks import DaytonParksImporter
    from app.data_import.dayton.import_waterways import DaytonWaterwaysImporter
    from app.data_import.dayton.import_zoning import DaytonZoningImporter

    overrides: ImporterOverrides = {
        "parcels": DaytonParcelsImporter,
        "buildings": DaytonBuildingsImporter,
        "zoning": DaytonZoningImporter,
        "boundaries": DaytonBoundariesImporter,
        "parks": DaytonParksImporter,
        "major_streets": DaytonMajorStreetsImporter,
        "waterways": DaytonWaterwaysImporter,
    }
    # O(s) time, O(s) space — s = skipped layers (5)
    overrides.update({layer: None for layer in DAYTON_SKIPPED_LAYERS})
    return overrides
