"""Detroit-specific importers.

ROADMAP
    Each module subclasses the shared importer (or BaseImporter) and overrides only what
    differs for Detroit — usually transform(), because Detroit's sources are ArcGIS
    FeatureServers with different field names than Chicago's Socrata datasets.
    All field names live in field_maps.py (verified live 2026-10-02).

    static_plan           STATIC_PLAN for scripts/export_city_static.py (+ enrich joins)
    frontend_vocab        writes frontend/src/cities/detroit/vocab.generated.ts
    common                cached ArcGIS pull, ring splitting, MultiPolygon, stable ids
    import_buildings      SEMCOG footprints, Detroit sub-areas 501–555, multipart split
    import_zoning         Zoning_1, Detroit code → zone_class
    import_parcels        Assessor parcel_file_current — owner attributes only (static)
    import_boundaries     DPD precincts, council districts (2026), TIGER ZCTAs ∩ city
    import_parks          D3 Parks_Landmarks → parks (NOT parcels)
    import_area_overrides neighborhoods / DLBA / NHD waterways field fixes
    import_major_streets  OSM arterials + freeways, merged per label, clipped to city

    STILL SKELETON: import_business_licenses, import_railroad_row, import_permits, enrich
    (the PostGIS UPDATE joins). The static build does its joins in static_plan instead.

STATUS — static-mode build implemented (2026-10-02). Database load() for the new
    BaseImporter subclasses raises until the Phase 2 migrations exist.
"""
