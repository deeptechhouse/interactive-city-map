"""Per-city importer selection — which importer class handles each layer for a city.

PURPOSE
    run.py runs one fixed IMPORTER_ORDER with the same classes for every city. That is
    why the Detroit blight importer would also run for Chicago and write Detroit blight
    rows under Chicago's city_id (backend audit 2026-10-02), and why Detroit buildings
    would be read with Chicago field names. This module lets a city swap or add
    importers without editing the shared ones.

STATUS — SKELETON. run.py does not import this yet. Phase 2 changes run.py in one place:
    `for layer, cls in importers_for(slug): ...` instead of IMPORTER_ORDER/IMPORTER_CLASSES.
    Chicago's entry must reproduce today's order exactly, minus the Detroit-only layers.

ARCHITECTURE
    DEFAULT_IMPORTERS (shared, city-neutral) + CITY_OVERRIDES[slug] (replace or add).
    A layer mapped to None is skipped for that city (Chicago: blight, dlba, neighborhoods).

TO ADD A CITY: add CITY_OVERRIDES["<slug>"] = {...}. Shared importers stay untouched.
"""

from app.data_import.base_importer import BaseImporter

ImporterPlan = list[tuple[str, type[BaseImporter]]]


def importers_for(city_slug: str) -> ImporterPlan:
    """O(l) time, O(l) space — l = layers in the plan (~20).

    Ordered (layer_name, importer_class) pairs for a city.
    Order matters: parcels → buildings → zoning → … → enrichment, because enrichment
    spatially joins rows the earlier importers loaded.
    """
    raise NotImplementedError(f"skeleton: importers_for({city_slug!r})")
