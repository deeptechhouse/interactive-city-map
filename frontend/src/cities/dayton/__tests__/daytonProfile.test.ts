/**
 * Dayton parity acceptance tests, written as `it.todo` so the suite stays green while the
 * skeleton is stubbed. Each todo becomes a real test in the plan phase it names. A phase
 * is not done until its todos are real and passing (docs/dayton_parity/dayton_parity_plan.html).
 */
import { describe, it } from 'vitest';

describe('Dayton profile — layers (D4)', () => {
  it.todo('offers police_precincts and neighborhoods, never police_districts or wards');
  it.todo('parks layer reads source-layer "parks", not "parcels"');
  it.todo('never offers federal_properties or gang_territory until a Dayton dataset exists');
  it.todo('static mode omits every layer whose static asset is missing (no "" tile URLs)');
  it.todo('every layer id has a dev source and, when static, a ./data/dayton/ asset');
});

describe('Dayton popups (D4)', () => {
  it.todo('building popup escapes every tile property (no raw HTML from open data)');
  it.todo('railroad_row popup links to the Montgomery County Auditor, never Cook County');
});

describe('Dayton vocabularies (D5)', () => {
  it.todo('every zone_code in the Dayton export matches exactly one ZoneType');
  it.todo('no Chicago manufacturing sub-types (M1/M2/M3/PMD) appear in the Dayton filter');
  it.todo('every GDRTA line_name has a transit colour (no #888 fallbacks)');
  it.todo('focus options: Dayton PD areas, 97 neighborhoods, Dayton ZCTAs, labelled without "ward"');
});

describe('Dayton contacts (D6)', () => {
  it.todo('MontgomeryCountyOwnerSource maps parcel owner fields to OwnerContact');
  it.todo('address is normalised and quote-escaped before it reaches the ArcGIS where clause');
  it.todo('DaytonPoiBusinessSource returns POIs inside the footprint without a network call');
  it.todo('CSV rows use DAYTON, OH — never CHICAGO, IL');
});

describe('City packs (D7)', () => {
  it.todo('a VITE_CITIES=dayton build contains no chicago/ or detroit/ profile chunk');
  it.todo('a VITE_CITIES=dayton build copies only public/data/dayton/ and public/data/shared/');
  it.todo('an unknown slug in VITE_CITIES fails the build (fail closed)');
});
