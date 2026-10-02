"""Upstream field names for every Detroit source, in one place.

WHY: the shared importers read Chicago's field names (bldg_addr, zone_class,
    lowercase gnis_name…). Detroit's sources use different names and casing — e.g. the
    NHD request asks for GNIS_NAME/FTYPE in upper case while import_waterways reads
    lower case, so every Detroit waterway would import with a null name.

UNPROVEN — every value below is a best guess until checked against the live layer's
    `?f=json` field list. Phase 2 step 1 is to fetch each layer's metadata, correct this
    file, and record the check date beside each map. Anything still unchecked keeps its
    `VERIFIED = False`, and the importer logs a warning when it runs.

STATUS — SKELETON.
"""

from dataclasses import dataclass


@dataclass(frozen=True)
class FieldMap:
    """Our column name → upstream field name(s), first non-empty wins."""

    source: str
    fields: dict[str, tuple[str, ...]]
    verified: bool = False  # flip to True with a dated comment once checked live


SEMCOG_BUILDINGS = FieldMap(
    source="SEMCOG Building_Footprints__2020 / layer 60",
    fields={
        "address": ("ADDRESS", "SITE_ADDR"),
        "year_built": ("YEAR_BUILT", "YR_BUILT"),
        "floors": ("STORIES", "NUM_STORIES"),
        "building_type": ("BLDG_TYPE", "TYPE"),  # 26 SEMCOG classes — UNDECODED
    },
)

DETROIT_ZONING = FieldMap(
    source="Zoning_1 / layer 0",
    fields={
        "zone_code": ("ZONING_REV", "ZONING", "zoning_rev"),
        "zone_name": ("ZDESC", "DESCRIPTION"),
    },
)

DETROIT_PARCELS = FieldMap(
    source="parcel_file_current / layer 0",
    fields={
        "pin": ("parcel_number", "PARCELNO"),
        "address": ("address", "ADDRESS"),
        "owner_name": ("taxpayer_1", "TAXPAYER_1"),
        "property_class": ("property_class", "PROPCLASS"),
        "use_code": ("use_code_desc", "USECODE"),
    },
)

NHD_FLOWLINES = FieldMap(
    source="USGS NHD MapServer/6",
    fields={"name": ("GNIS_NAME", "gnis_name"), "ftype": ("FTYPE", "ftype")},
)


def pick(props: dict, field_map: FieldMap, column: str) -> str | None:
    """O(k) time, O(1) space — k = candidate upstream names for the column (≤ 3).

    First non-empty upstream value for `column`, else None.
    """
    raise NotImplementedError("skeleton: pick")
