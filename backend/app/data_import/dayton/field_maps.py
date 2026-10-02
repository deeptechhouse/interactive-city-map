"""Upstream field names for every Dayton source, in one place.

WHY: the fork hard-coded field names inside each importer. Its parcel enrichment used
    10-character shapefile (DBF) names (owner_ad_2, mailing__3). One map per source turns a
    renamed upstream column into a one-line fix.

VERIFIED 2026-10-02 against each live layer's `?f=json` field list plus a 2-row sample
    (see the per-map comments). Every map below has verified=True.

TRAPS (found during that check — read before touching these maps)
    - Montgomery County parcels: the services6.arcgis.com "Montgomery_County_Parcels"
      FeatureServer the fork's yaml named is Montgomery County, NEW YORK (MUNI=Amsterdam,
      MAIL_STATE=NY, 25,336 rows). It is NOT Dayton's county. The real Montgomery County,
      OH data is the City's MapLayers_Citywide/MapServer/9: parcel polygons joined to the
      Auditor's CAMA table (WEB_CAMA), 273,627 rows county-wide.
    - That join layer qualifies every field name ("GISADMIN.WEB_CAMA.OWNER_NAME") in both
      `where` clauses and the returned attributes. Use the full name.
    - Building footprints (307) carry NO address and no year built: NUMSTORIES is 0 on the
      rows sampled. Address, owner and year come from the parcel join (enrich.py).
    - Zoning (203): `DISTRICT` holds the PRE-2006 codes (B-2, R-4…). The current code is
      `NEW_ZONE` (it drives the City's own renderer). `NAME` is a park name or
      "City of Dayton", not a district name.
    - Police areas: 4 features (COUNT, 2026-10-02), named by `District`. `Id` is 0 for the
      airport area, so it can't be used as a key.
    - Neighborhoods (310): 97 features, but 31 are "<TOWN> - OUTSIDE CITY" fillers.
      66 real Dayton neighborhoods remain after the filter.
    - Streets (312): there is no road-class *name*. FUNCT_CLAS holds FHWA codes
      (11 interstate, 12 freeway, 14 principal arterial, 16 minor arterial, 17 collector,
      19 local).

SHARED TYPE: FieldMap/pick live in app/data_import/field_map.py. Dayton has no imports
    from detroit/.
"""

from app.data_import.field_map import FieldMap

DAYTON_GIS = "https://maps.daytonohio.gov/gisservices/rest/services"
CITYWIDE = f"{DAYTON_GIS}/Viewer/MapLayers_Citywide/MapServer"

# 307 "Building Footprint" — polygon, EPSG:3735, maxRecordCount 1000, pagination yes.
# 338,321 county-wide; 230,328 intersect the profile bbox (2026-10-02).
DAYTON_BUILDINGS = FieldMap(
    source=f"{CITYWIDE}/307",
    fields={
        "source_id": ("GlobalID", "OBJECTID_1", "OBJECTID"),
        "floors": ("NUMSTORIES",),
        "height_ft": ("BLDGHEIGHT",),
        # "MAIN" on every row sampled; other values UNPROVEN.
        "building_type": ("CTYSTRUCT",),
    },
    verified=True,
)

# 9 "Parcels" — parcel polygon ⋈ WEB_CAMA ⋈ CAMA_LANDUSECODES. maxRecordCount 1000,
# pagination yes, but spatial (envelope) queries fail with "Unable to complete operation"
# (2026-10-02), so the whole county is downloaded and clipped locally.
_CAMA = "GISADMIN.WEB_CAMA."
_POLY = "GISADMIN.mc_parcel_polygon_e."
MONTGOMERY_PARCELS = FieldMap(
    source=f"{CITYWIDE}/9",
    fields={
        "pin": (f"{_CAMA}PARID", f"{_POLY}TAXPINNO"),
        "address": (f"{_CAMA}PARLOC",),
        "zip": (f"{_POLY}LOC_ZIP",),
        "owner_name": (f"{_CAMA}OWNER_NAME", f"{_POLY}OWNER1"),
        # Owner block: street line, optional second line (PO BOX / c/o), "CITY, ST  ZIP".
        "owner_street": (f"{_CAMA}OWNER_ADDR", f"{_CAMA}OWNER_AD_1"),
        "owner_city_line": (f"{_CAMA}OWNER_AD_2",),
        # Tax-bill mailing block, same shape.
        "mailing_street": (f"{_CAMA}MAILING_AD", f"{_CAMA}MAILING__2"),
        "mailing_city_line": (f"{_CAMA}MAILING__3",),
        "appraised_value": (f"{_CAMA}APPRTOTAL",),  # text with thousands commas: "33,470"
        "sale_date": (f"{_CAMA}SALE_DATE",),  # text "MM/DD/YYYY"
        "sale_price": (f"{_CAMA}SALE_PRICE",),
        "property_class": (f"{_CAMA}CLASS",),  # R / C / I / E …
        "land_use": ("GISADMIN.CAMA_LANDUSECODES.Field4", f"{_CAMA}LUC"),
        "dwelling_year": (f"{_CAMA}DWEL_YRBLT",),  # 0 when not a dwelling
        "commercial_year": (f"{_CAMA}COMM_YRBLT",),  # 0 when not commercial
        "dwelling_stories": (f"{_CAMA}DWEL_STORI",),
        "commercial_stories": (f"{_CAMA}COMM_STORI",),
    },
    verified=True,
)

# 203 "Zoning District" — 970 polygons, EPSG:3735. 26 distinct NEW_ZONE codes.
DAYTON_ZONING = FieldMap(
    source=f"{CITYWIDE}/203",
    fields={
        "zone_code": ("NEW_ZONE",),
        "legacy_code": ("DISTRICT",),  # pre-2006 code, kept as a property only
        "feature_name": ("NAME",),
    },
    verified=True,
)

# Police/PoliceAreas/MapServer/0 "District" — 4 polygons, already EPSG:4326.
DAYTON_POLICE_AREAS = FieldMap(
    source=f"{DAYTON_GIS}/Police/PoliceAreas/MapServer/0",
    fields={"name": ("District",)},
    verified=True,
)

# 310 "Neighborhood" — 97 polygons (66 inside the city). HOOD is UPPER CASE.
DAYTON_NEIGHBORHOODS = FieldMap(
    source=f"{CITYWIDE}/310",
    fields={"name": ("HOOD",), "priority_board": ("PRI_BOARD", "PRIBD")},
    verified=True,
)

# 312 "Centerline" — 81,061 polylines county-wide; 7,649 arterials in the city envelope.
DAYTON_STREETS = FieldMap(
    source=f"{CITYWIDE}/312",
    fields={"name": ("GEONAME",), "road_class": ("FUNCT_CLAS",)},
    verified=True,
)

# USGS NHD "Flowline - Large Scale" (MapServer/6). maxRecordCount 2000. 560 flowlines in
# the bbox (174 named). The JSON field list is lower case (gnis_name) but other NHD
# services return GNIS_NAME, so both are listed.
NHD_FLOWLINES = FieldMap(
    source="https://hydro.nationalmap.gov/arcgis/rest/services/nhd/MapServer/6",
    fields={"name": ("gnis_name", "GNIS_NAME"), "waterway_type": ("ftype", "FTYPE")},
    verified=True,
)

# Census TIGERweb 2020 ZCTAs (PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1). 27 ZCTAs with a
# 453/454 prefix touch the city envelope.
TIGER_ZCTA = FieldMap(
    source="https://tigerweb.geo.census.gov/arcgis/rest/services/TIGERweb/"
    "PUMA_TAD_TAZ_UGA_ZCTA/MapServer/1",
    fields={"zip_code": ("ZCTA5", "GEOID")},
    verified=True,
)
