"""Upstream field names for every Detroit source, in one place.

PURPOSE
    The shared importers read Chicago's field names (bldg_addr, zone_class, …). Detroit's
    ArcGIS layers use different names and casing. Every Detroit importer reads its columns
    through these maps with field_map.pick(), so a renamed upstream column is a one-line fix.

VERIFIED 2026-10-02 — each map below was checked against the live layer's `?f=json`
    field list plus a 2-row sample query. What the old guesses got wrong is noted per map
    so nobody "fixes" it back.

TO ADD A FIELD: add `"our_column": ("UPSTREAM_NAME",)` to the map, read it with pick().
"""

from app.data_import.field_map import FieldMap, pick  # noqa: F401 — re-exported

# SEMCOG Building_Footprints__2020 / FeatureServer/60 (EPSG:2898, maxRecordCount 2000,
# 1,671,189 rows region-wide). Old guesses ADDRESS/YEAR_BUILT/STORIES/BLDG_TYPE were all
# wrong-cased; the real names are lower case. `ref_name` is a landmark name, mostly null.
# `build_type` is a SEMCOG integer code (81 = 218,481 of Detroit's rows, so almost
# certainly single-family) — UNPROVEN: no published domain on the layer, so not exported.
SEMCOG_BUILDINGS = FieldMap(
    source="SEMCOG Building_Footprints__2020 / layer 60",
    fields={
        "source_id": ("gid",),
        "address": ("address",),
        "name": ("ref_name",),
        "year_built": ("year_built",),
        "floors": ("stories",),
        "apn": ("apn",),
    },
    verified=True,  # 2026-10-02
)

# Zoning_1 / FeatureServer/0 (native wkid 102690, maxRecordCount 1000, 28,364 polygons —
# parcel-grain, not dissolved districts). Codes are undashed: R1, B4, SD2, MKT …
# The old guess ZDESC/DESCRIPTION does not exist; the description is ZDESCR_N.
DETROIT_ZONING = FieldMap(
    source="Zoning_1 / layer 0",
    fields={
        "zone_code": ("ZONING_REV",),
        "zone_name": ("ZDESCR_N",),
    },
    verified=True,  # 2026-10-02
)

# parcel_file_current / FeatureServer/0 (377,940 rows, maxRecordCount 1000). The old guess
# `parcel_number` is wrong: the PIN is `parcel_id`. Not shipped as a static layer (size);
# the browser contact source (frontend contacts.ts) queries it live instead.
DETROIT_PARCELS = FieldMap(
    source="parcel_file_current / layer 0",
    fields={
        "pin": ("parcel_id",),
        "address": ("address",),
        "owner_name": ("taxpayer_1",),
        "owner_name_2": ("taxpayer_2",),
        "owner_street": ("taxpayer_address",),
        "owner_city": ("taxpayer_city",),
        "owner_state": ("taxpayer_state",),
        "owner_zip": ("taxpayer_zip_code",),
        "property_class": ("property_class_description", "property_class"),
        "use_code": ("use_code_description", "use_code"),
    },
    verified=True,  # 2026-10-02
)

# USGS NHD MapServer/6 "Flowline - Large Scale". TRAP: the yaml asks for GNIS_NAME/FTYPE
# in upper case, but on 2026-10-02 the service answered with LOWER-case keys (gnis_name,
# ftype). It has flipped before, so both spellings are listed. 917 flowlines in the bbox,
# 727 of them unnamed (drains/ditches).
NHD_FLOWLINES = FieldMap(
    source="USGS NHD MapServer/6",
    fields={"name": ("gnis_name", "GNIS_NAME"), "ftype": ("ftype", "FTYPE")},
    verified=True,  # 2026-10-02
)

# DPD_Precincts_Reid2 / FeatureServer/0 — 12 polygons. A KML import: the only useful field
# is `name`, a zero-padded string ("09", "10"). No station address on the layer.
DPD_PRECINCTS = FieldMap(
    source="DPD_Precincts_Reid2 / layer 0",
    fields={"precinct": ("name",)},
    verified=True,  # 2026-10-02
)

# city_council_districts_2026 / FeatureServer/0 — 7 polygons, effective 2026-01-01.
# district_number is a SmallInteger. There is NO council-member field on the layer.
COUNCIL_DISTRICTS = FieldMap(
    source="city_council_districts_2026 / layer 0",
    fields={"district_number": ("district_number",), "district_name": ("district_name",)},
    verified=True,  # 2026-10-02
)

# Census TIGERweb ACS2023 MapServer/2 "2020 Census ZIP Code Tabulation Areas".
# City_of_Detroit_Zip_Code_List is not used: the yaml's fallback_url is the polygon source.
TIGER_ZCTA = FieldMap(
    source="TIGERweb tigerWMS_ACS2023 / layer 2",
    fields={"zip_code": ("ZCTA5", "BASENAME")},
    verified=True,  # 2026-10-02
)

# D3 Parks_Landmarks / FeatureServer/0 — 390 polygons. Type values seen 2026-10-02:
# Park 369, Cemetery 14, Golf 4, Airport 1, Convention 1, Fort 1.
D3_PARKS = FieldMap(
    source="D3 Parks_Landmarks / layer 0",
    fields={"name": ("FULLNAME",), "park_type": ("Type",)},
    verified=True,  # 2026-10-02
)

# DLBA_Owned_Properties / FeatureServer/0 — 56,896 POINTS (not parcels). The shared
# DLBAImporter reads address/status/property_type, none of which exist here, so every
# Detroit row imported with null address and status. The address is in `name`.
DLBA_PROPERTIES = FieldMap(
    source="DLBA_Owned_Properties / layer 0",
    fields={
        "address": ("name",),
        "status": ("inventory_status_socrata",),
        "parcel_id": ("parcel_id",),
        "neighborhood": ("neighborhood",),
        "council_district": ("council_district",),
    },
    verified=True,  # 2026-10-02
)

# Current_City_of_Detroit_Neighborhoods / FeatureServer/0 — 205 polygons.
# council_district is a Double (4.0), so callers must int() it before stringifying.
DETROIT_NEIGHBORHOODS = FieldMap(
    source="Current_City_of_Detroit_Neighborhoods / layer 0",
    fields={
        "name": ("nhood_name",),
        "council_district": ("council_district",),
        "website": ("Website",),
    },
    verified=True,  # 2026-10-02
)

# bseed_active_business_licenses / FeatureServer/0 — 1,409 points (2026-10-02).
BSEED_LICENSES = FieldMap(
    source="bseed_active_business_licenses / layer 0",
    fields={
        "business_name": ("business_name",),
        "address": ("address",),
        "license_type": ("license_type",),
        "parcel_id": ("parcel_id",),
    },
    verified=True,  # 2026-10-02
)
