/**
 * Detroit parity acceptance tests — written as `it.todo` so the suite stays green while
 * the skeleton is stubbed. Each todo becomes a real test in the phase noted; a phase is
 * not done until its todos are real and passing (TDD §9 / plan acceptance gates).
 */
import { describe, it } from 'vitest';

describe('Detroit profile — layers (Phase 4)', () => {
  it.todo('offers police_precincts and council_districts, never police_districts or wards');
  it.todo('parks layer reads source-layer "parks", not "parcels"');
  it.todo('static mode omits every layer whose static asset is missing (no "" tile URLs)');
  it.todo('every layer id has a dev source and, when static, a ./data/detroit/ asset');
});

describe('City switch (Phase 4)', () => {
  it.todo('switching chicago → detroit removes wards, gang_territory, federal_properties, railroad_row');
  it.todo('Chicago layer list is byte-identical to the pre-refactor snapshot');
  it.todo('POIBrowsePanel refetches when the city changes');
});

describe('Detroit vocabularies (Phase 5)', () => {
  it.todo('every zone_code in the Detroit export matches exactly one ZoneType');
  it.todo('every GTFS line_name has a transit colour (no #888 fallbacks)');
  it.todo('focus options: 12 precincts, 7 council districts, Detroit ZCTAs');
});

describe('Detroit contacts (Phase 6)', () => {
  it.todo('DetroitParcelOwnerSource maps taxpayer fields to OwnerContact');
  it.todo('address is normalised and quote-escaped before it reaches the ArcGIS where clause');
  it.todo('DetroitBusinessLicenseSource falls back to a point query when address is empty');
  it.todo('CSV rows use DETROIT, MI — never CHICAGO, IL');
});
