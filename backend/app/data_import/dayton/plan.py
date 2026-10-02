"""Dayton's entry for city_registry: which importer handles each layer (PostGIS path).

PURPOSE
    city_registry.importers_for(slug) = DEFAULT_IMPORTERS overlaid with a city's overrides.
    This module is Dayton's override map. It lives here, not in city_registry.py, so adding
    Dayton needs exactly one line there:
        CITY_OVERRIDES["dayton"] = dayton_importer_overrides()
    A layer mapped to None is skipped for Dayton.

    The static build does NOT use this map. It reads static_plan.STATIC_PLAN, which names
    the same importer classes.

ORDER MATTERS: parcels → buildings → zoning → boundaries → … → enrich. Enrichment joins
    rows the earlier importers loaded. city_registry owns the order; this map only swaps
    classes.

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
