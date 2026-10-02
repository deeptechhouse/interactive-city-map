"""Upstream field names for every Dayton source, in one place.

WHY: the fork hard-coded field names inside each importer. Its parcel enrichment used
    10-character shapefile (DBF) names (owner_ad_2, mailing__3), which the FeatureServer
    may not share. One map per source turns a renamed upstream column into a one-line fix.

UNPROVEN: every value below is a best guess until it is checked against the live layer's
    `?f=json` field list. Plan D1 step 2 fetches each layer's metadata, corrects this file,
    and records the check date beside each map. Anything still unchecked keeps
    `verified=False`, and the importer logs a warning when it runs.

SHARED TYPE: FieldMap/pick live in app/data_import/field_map.py (promoted from the
    Detroit package 2026-10-02, combined plan W1). Dayton has no imports from detroit/.

STATUS — SKELETON.
"""

from app.data_import.field_map import FieldMap

DAYTON_GIS = "https://maps.daytonohio.gov/gisservices/rest/services"

DAYTON_BUILDINGS = FieldMap(
    source=f"{DAYTON_GIS}/Viewer/MapLayers_Citywide/MapServer/307",
    fields={
        "address": ("ADDRESS", "SITE_ADDR", "FULLADDR"),
        "year_built": ("YEAR_BUILT", "YRBUILT"),
        "floors": ("STORIES", "NUM_FLOORS"),
        "building_type": ("BLDG_TYPE", "TYPE"),
    },
)

MONTGOMERY_PARCELS = FieldMap(
    source="services6.arcgis.com/EbVsqZ18sv1kVJ3k Montgomery_County_Parcels/FeatureServer/0",
    fields={
        "pin": ("PARID", "PARCELID", "PIN"),
        "address": ("SITUS", "LOCATION", "ADDRESS"),
        "owner_name": ("OWNER", "OWNER1", "OWNERNAME"),
        # These are clean output keys. The fork's DBF equivalents are noted for the D1 check.
        "owner_address": ("OWNER_ADDR", "OWNADDR"),  # fork: owner_addr + owner_ad_2
        "mailing_address": ("MAILING_AD", "MAILADDR"),  # fork: mailing_ad + mailing__3
        "appraised_value": ("APPRTOT", "TOTAPPR", "APPRAISED"),
        "sale_date": ("SALEDT", "SALE_DATE"),
        "sale_price": ("PRICE", "SALE_PRICE"),
        "property_class": ("CLASS", "LUC", "LANDUSE"),
    },
)

DAYTON_ZONING = FieldMap(
    source=f"{DAYTON_GIS}/Viewer/MapLayers_Citywide/MapServer/203",
    fields={
        "zone_code": ("ZONING", "ZONE_CODE", "ZONE"),
        "zone_name": ("ZONE_DESC", "DESCRIPTION"),
    },
)

DAYTON_POLICE_AREAS = FieldMap(
    source=f"{DAYTON_GIS}/Police/PoliceAreas/MapServer/0",
    fields={"number": ("DISTRICT", "AREA", "NAME"), "name": ("NAME", "DISTRICT")},
)

DAYTON_NEIGHBORHOODS = FieldMap(
    source=f"{DAYTON_GIS}/Viewer/MapLayers_Citywide/MapServer/310",
    fields={"name": ("NAME", "NEIGHBORHOOD", "NBHD_NAME")},
)

DAYTON_STREETS = FieldMap(
    source=f"{DAYTON_GIS}/Viewer/MapLayers_Citywide/MapServer/312",
    fields={"name": ("FULLNAME", "STREET_NAME", "NAME"), "road_class": ("CLASS", "FUNC_CLASS")},
)
