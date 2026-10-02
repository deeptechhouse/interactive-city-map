"""Dayton's entry for city_registry: which importer handles each layer.

PURPOSE
    city_registry.importers_for(slug) = DEFAULT_IMPORTERS overlaid with a city's overrides
    (Detroit plan P2). This module is Dayton's override map. It lives here, not in
    city_registry.py, so adding Dayton needs exactly one line there:
        CITY_OVERRIDES["dayton"] = dayton_importer_overrides()
    A layer mapped to None is skipped for Dayton.

ORDER MATTERS: parcels → buildings → zoning → boundaries → … → enrich. Enrichment joins
    rows the earlier importers loaded. city_registry owns the order, and this map only swaps
    classes.

STATUS — SKELETON. The classes are imported lazily inside dayton_importer_overrides(),
    so importing this module cannot fail on a machine without shapely/GDAL.
"""

from app.data_import.base_importer import BaseImporter

ImporterOverrides = dict[str, type[BaseImporter] | None]

# Layers Dayton never imports. Each value is the reason it is skipped.
DAYTON_SKIPPED_LAYERS: dict[str, str] = {
    "dlba_properties": "Detroit Land Bank only; Montgomery County land bank unverified (plan D8)",
    "blight_violations": "no blight block in dayton.yaml; code-enforcement source unverified",
    "council_districts": "Dayton's City Commission is elected at-large, so there are no districts",
    "streets": "replaced by DaytonMajorStreetsImporter (the shared one is a Cook County stub)",
}


def dayton_importer_overrides() -> ImporterOverrides:
    """O(l) time, O(l) space — l = overridden layers (~10).

    layer_name → Dayton importer class, or None to skip. Built on each call so the importer
    modules are only imported when an import actually runs.
    """
    raise NotImplementedError("skeleton: dayton_importer_overrides")
