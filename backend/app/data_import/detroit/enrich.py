"""Post-import spatial joins for Detroit — the steps Chicago ran by hand.

docs/new_city_guide.html §5 lists them as ad-hoc SQL. Here they are code, so they run
the same way every time and can be tested. Every UPDATE is filtered by city_id.

    tag_buildings_with_zoning     building centroid ∈ zoning polygon
    tag_buildings_with_parcels    building centroid ∈ parcel → parcel_pin, owner_name
    link_pois_to_buildings        POI point ∈ building polygon
    attach_business_licenses      licence point ∈ building → metadata.businesses

Each is one set-based UPDATE … FROM using the GIST indexes: O(n log m) in the database,
not a Python double loop.

STATUS — SKELETON.
"""


def tag_buildings_with_zoning(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = buildings; m = zoning polygons (GIST probe each).

    Returns rows updated.
    """
    raise NotImplementedError("skeleton: tag_buildings_with_zoning")


def tag_buildings_with_parcels(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = buildings; m = parcels (GIST probe each)."""
    raise NotImplementedError("skeleton: tag_buildings_with_parcels")


def link_pois_to_buildings(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = POIs; m = buildings (GIST probe each)."""
    raise NotImplementedError("skeleton: link_pois_to_buildings")


def attach_business_licenses(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = licences; m = buildings (GIST probe each)."""
    raise NotImplementedError("skeleton: attach_business_licenses")


def run_all(db_url: str, city_id: str) -> dict[str, int]:
    """O(1) time, O(1) space — s = 4 enrichment steps, run in dependency order."""
    raise NotImplementedError("skeleton: run_all")
