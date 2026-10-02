/**
 * Detroit public-record sources for the building contact list.
 *
 * PURPOSE
 *   Chicago uses Cook County Assessor (owner of record) + City of Chicago business
 *   licences, both Socrata, called from the browser. Detroit's equivalents live on the
 *   City's ArcGIS Hub (org qvkbeam7Wirps6zC), also free and keyless:
 *     owners     → `parcel_file_current` FeatureServer (Office of the Assessor; taxpayer
 *                  name + mailing address per parcel)
 *     businesses → `bseed_active_business_licenses` FeatureServer
 *   Both implement the existing ports in contacts/publicRecords.ts, so ContactResolver
 *   needs only a factory change (Phase 6), not new logic.
 *
 * STATUS — SKELETON.
 *
 * UNPROVEN (check before Phase 6 — record the date and result here):
 *   - CORS: ArcGIS Online normally sends Access-Control-Allow-Origin: *, which is what
 *     makes the static (no-backend) contact list possible. Not yet checked for these two
 *     services. If either refuses, proxy it through phone_app.py instead.
 *   - Field names: expected `taxpayer_1`, `taxpayer_2`, `taxpayer_street`,
 *     `taxpayer_city`, `taxpayer_state`, `taxpayer_zip`, `address` — read
 *     `?f=json` on the layer and correct this list before writing the adapter.
 *
 * SECURITY — ArcGIS `where` injection: the address is interpolated into a SQL-92 `where`
 *   clause. Reuse publicRecords.normaliseAddress (strips everything but [A-Z0-9 .#-]) and
 *   double single quotes exactly as soqlString does. Never pass a raw tile property.
 */
import type { BusinessSource, FetchJson, OwnerSource } from '../../contacts/publicRecords';
import type { BusinessContact, OwnerContact } from '../../contacts/types';
import type { ContactSources } from '../CityProfile';
import { notImplemented } from '../CityProfile';

export const DETROIT_PARCELS_QUERY_URL =
  'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0/query';
export const DETROIT_LICENSES_QUERY_URL =
  'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_active_business_licenses/FeatureServer/0/query';

/** Owner of record from Detroit Assessor parcels. */
export class DetroitParcelOwnerSource implements OwnerSource {
  // O(1) time, O(1) space — n = 1 injected fetcher (tests pass a fake; default = network).
  constructor(private readonly fetchJson?: FetchJson) {}

  /**
   * One ArcGIS query by normalised address; one OwnerContact per distinct taxpayer.
   * O(r) time, O(r) space — r = parcel rows at the address (usually 1, more for condos).
   */
  async findOwners(address: string): Promise<OwnerContact[]> {
    return notImplemented('DetroitParcelOwnerSource.findOwners', address, this.fetchJson);
  }
}

/** Businesses at a building from BSEED active business licences. */
export class DetroitBusinessLicenseSource implements BusinessSource {
  // O(1) time, O(1) space — n = 1 injected fetcher.
  constructor(private readonly fetchJson?: FetchJson) {}

  /**
   * Address match first; if the footprint has no address, a 30 m point-buffer query.
   * O(r) time, O(r) space — r = licence rows returned.
   */
  async findBusinesses(address: string, lngLat: [number, number]): Promise<BusinessContact[]> {
    return notImplemented('DetroitBusinessLicenseSource.findBusinesses', address, lngLat, this.fetchJson);
  }
}

/**
 * Michigan LARA corporation search (replaces the Illinois SOS link for Detroit owners).
 * O(n) time, O(n) space — n = entity name length (URL encoding).
 */
export function michiganCorporationSearchUrl(entityName: string): string {
  return notImplemented('michiganCorporationSearchUrl', entityName);
}

/**
 * Assemble Detroit's contact sources.
 * O(1) time, O(1) space — n = 1 bundle of adapters.
 */
export function detroitContactSources(fetchJson?: FetchJson): ContactSources {
  return notImplemented('detroitContactSources', fetchJson);
}
