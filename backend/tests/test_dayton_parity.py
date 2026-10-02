"""Dayton parity acceptance tests, skipped until each phase lands.

Each test names its plan phase. A phase is done only when its tests are un-skipped and
passing (docs/dayton_parity/dayton_parity_plan.html, acceptance gates).
"""

import pytest

pending = pytest.mark.skip(reason="Dayton parity skeleton — implement in the named phase")


@pending
def test_d2_dayton_importer_plan_skips_detroit_only_layers():
    """importers_for('dayton') has no blight, dlba or council_districts importer."""


@pending
def test_d2_parcels_importer_is_not_the_cook_county_stub():
    """A recorded Montgomery County page loads more than 0 parcels with unique PINs."""


@pending
def test_d2_zoning_never_uses_chicago_prefixes():
    """classify_dayton_zone('C1') == 'other', never Chicago's 'commercial' rule."""


@pending
def test_d2_zoning_classes_match_frontend_keys():
    """Every zone_class the importer can emit exists in DAYTON_ZONE_CLASSES."""


@pending
def test_d2_neighborhoods_load_into_neighborhoods_not_wards():
    """DaytonBoundariesImporter writes neighborhoods, police_precincts, zip_codes only."""


@pending
def test_d2_gdrta_gtfs_goes_through_shared_gtfs_path():
    """dayton.yaml's *_gtfs_url key makes import_transit take the GTFS path, not CTA/Socrata."""


@pending
def test_d2_railroad_row_buffer_is_metric():
    """A 30 m buffer around an east–west track is ~30 m wide, not ~23 m."""


@pending
def test_d2_enrichment_updates_only_dayton_rows():
    """Every enrich.* UPDATE leaves Chicago and Detroit rows untouched (city_id filter)."""


@pending
def test_d2_enrichment_writes_clean_metadata_keys():
    """metadata has owner_address/mailing_address, never owner_ad_2/mailing__3."""


@pending
def test_d3_static_export_size_budget():
    """public/data/dayton/ totals ≤ 120 MB (buildings ≤ 70 MB)."""


@pending
def test_d6_owner_batch_uses_dayton_oh():
    """A BatchItem with city=DAYTON, state=OH reaches Tracerfy as Dayton, not Chicago, IL."""
