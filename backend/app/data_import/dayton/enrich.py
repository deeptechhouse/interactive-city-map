"""Post-import spatial joins for Dayton.

WHY: the fork's commit 8a2ac00 claims 335,825 buildings were enriched with owner, sale
    and appraisal data. Only the popup that reads that data was committed, not the join.
    The enrichment can't be reproduced. Here the join is code, filtered by city_id,
    idempotent and testable.

    tag_buildings_with_parcels  building centroid ∈ parcel → parcel_pin, owner_name,
                                metadata{owner_address, mailing_address, appraised_value,
                                sale_date, sale_price} (clean keys, never the DBF names)
    tag_buildings_with_zoning   building centroid ∈ zoning polygon → zoning_code
    link_pois_to_buildings      POI point ∈ building polygon → building_id

Each is one set-based UPDATE … FROM that uses the GIST indexes: O(n log m) in the database,
not a Python double loop.

STATUS — SKELETON.
"""


def tag_buildings_with_parcels(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = buildings; m = parcels (one GIST probe each).

    Returns the number of rows updated.
    """
    raise NotImplementedError("skeleton: tag_buildings_with_parcels")


def tag_buildings_with_zoning(db_url: str, city_id: str) -> int:
    """O(n log m) time, O(1) space — n = buildings; m = zoning polygons.

    Returns the number of rows updated.
    """
    raise NotImplementedError("skeleton: tag_buildings_with_zoning")


def link_pois_to_buildings(db_url: str, city_id: str) -> int:
    """O(p log n) time, O(1) space — p = POIs; n = buildings.

    Returns the number of rows updated.
    """
    raise NotImplementedError("skeleton: link_pois_to_buildings")


def run_all(db_url: str, city_id: str) -> dict[str, int]:
    """O(n log m) time, O(1) space — n = buildings; m = the largest joined table.

    Runs the joins in dependency order and returns step name → rows updated.
    """
    raise NotImplementedError("skeleton: run_all")
