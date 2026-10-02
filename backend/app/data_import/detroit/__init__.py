"""Detroit-specific importers.

ROADMAP
    Each module subclasses the shared importer (or BaseImporter) and overrides only what
    differs for Detroit — usually transform(), because Detroit's sources are ArcGIS
    FeatureServers with different field names than Chicago's Socrata datasets.
    All field names live in field_maps.py, so a renamed upstream column is a one-line fix.

    import_buildings      SEMCOG footprints (EPSG:2898 → 4326), Detroit field map
    import_zoning         Zoning_1 FeatureServer, Detroit code → zone_class
    import_parcels        Assessor parcel_file_current (owner, class, PIN)
    import_boundaries     DPD precincts, council districts, Census ZCTAs
    import_parks          D3 Parks_Landmarks → parks table (NOT parcels)
    import_business_licenses  BSEED active licences → business_licenses
    import_major_streets  curated arterial list → major_streets
    import_railroad_row   parcels owned by railroads → railroad_row (Chicago-parity layer)
    import_permits        BSEED building permits → interior enrichment
    enrich                post-import spatial joins (zoning→buildings, POIs→buildings,
                          licences→buildings, parcels→buildings owner)

STATUS — SKELETON (2026-10-02). Nothing outside this package imports it.
"""
