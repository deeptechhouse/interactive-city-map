"""Dayton, OH-specific importers, ported from the retired Dayton fork into the shared app.

PURPOSE
    Dayton was a separate repo (../Dayton_interactive_map) forked from an early Chicago
    commit. Its working Dayton code (ArcGIS REST pagination, police and neighborhood
    importers, the railroad right-of-way generator, the parcel-enrichment popup) moves here
    so that every city runs through one pipeline and one database (rows keyed by city_id).

ROADMAP
    Each module subclasses the shared importer, or BaseImporter, and overrides only what
    differs for Dayton. All upstream field names live in field_maps.py.

    field_maps            City of Dayton / Montgomery County / NHD field names (unverified)
    import_parcels        Montgomery County Auditor parcels (~272K): owner, appraisal, sale
    import_buildings      City of Dayton footprints (MapLayers_Citywide/307), with
                          Microsoft footprints as the fallback
    import_zoning         MapLayers_Citywide/203, Dayton code → zone_class (Dayton codes only;
                          drops the fork's mixed Chicago/Dayton prefix map)
    import_boundaries     DPD areas → police_precincts; 97 neighborhoods → neighborhoods
                          (NOT `wards`); Census ZCTAs 453xx/454xx → zip_codes
    import_parks          OSM leisure=park → parks table (NOT parcels)
    import_major_streets  MapLayers_Citywide/312 filtered to arterials → major_streets
    import_railroad_row   port of the fork's scripts/generate_railroad_row.py
    enrich                post-import spatial joins, including the parcel → building
                          enrichment the fork ran by hand and never committed (commit 8a2ac00)
    plan                  dayton_importer_overrides(), read by city_registry.importers_for

    Transit needs no Dayton module: the shared import_transit GTFS path handles GDRTA once
    dayton.yaml names the feed with a `*_gtfs_url` key (plan D1).

STATUS — SKELETON (2026-10-02). Nothing outside this package imports it.
"""
