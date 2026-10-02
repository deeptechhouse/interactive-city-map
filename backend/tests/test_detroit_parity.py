"""Detroit parity acceptance tests — skipped until each phase lands.

Each test names its plan phase. A phase is done only when its tests are un-skipped and
passing (docs/detroit_parity/detroit_parity_plan.html, acceptance gates).
"""

import pytest

pending = pytest.mark.skip(reason="Detroit parity skeleton — implement in the named phase")


@pending
def test_phase2_chicago_importer_plan_unchanged():
    """importers_for('chicago') == today's order, minus blight/dlba/neighborhoods."""


@pending
def test_phase2_blight_never_runs_for_chicago():
    """Regression for the 2026-10-02 audit: Detroit blight rows under Chicago's city_id."""


@pending
def test_phase2_semcog_multipart_buildings_split():
    """A 2-part SEMCOG feature becomes 2 building rows, not 1 polygon with a false hole."""


@pending
def test_phase2_detroit_zoning_classes_match_frontend_keys():
    """Every zone_class the Detroit importer emits exists in DETROIT_ZONE_CLASSES."""


@pending
def test_phase2_nhd_upper_case_fields_map_to_name():
    """GNIS_NAME → name; no Detroit waterway imports with a null name when NHD has one."""


@pending
def test_phase2_enrichment_updates_only_detroit_rows():
    """Every enrich.* UPDATE leaves Chicago rows untouched (city_id filter)."""


@pending
def test_phase6_owner_batch_uses_item_city_state():
    """BatchItem with city=DETROIT, state=MI reaches Tracerfy as Detroit, not Chicago, IL."""


@pending
def test_phase6_phone_lookup_detroit_provider_order():
    """PHONE_LOOKUP_PROVIDERS_BY_CITY includes detroit=google,foursquare."""
