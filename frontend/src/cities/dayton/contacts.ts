/**
 * Dayton public-record sources for the building contact list.
 *
 * PURPOSE
 *   Chicago uses Cook County Assessor (owner of record) and City of Chicago business
 *   licences, both on Socrata and called from the browser. Dayton's equivalents:
 *     owners     → Montgomery County Auditor parcels on ArcGIS Online (free, keyless).
 *                  This is the same FeatureServer named in dayton.yaml's parcels.county_url.
 *     businesses → Dayton has NO general business-licence dataset (Ohio does not license
 *                  most businesses at city level). The fallback is OSM POIs whose point
 *                  falls inside the building footprint, read from the already-bundled
 *                  static POI data, so no network call is needed. This gives less coverage than
 *                  Chicago's licences, and the panel says so.
 *   Both implement the existing ports in contacts/publicRecords.ts, so ContactResolver
 *   only needs its factory changed (Detroit plan P6), not new logic.
 *
 * STATUS — SKELETON.
 *
 * UNPROVEN (check before plan D6, and record the date and result here):
 *   - CORS: ArcGIS Online normally sends Access-Control-Allow-Origin: *, which is what makes
 *     a static (no-backend) contact list possible. This is unchecked for this service. If it
 *     refuses, proxy the call through phone_app.py.
 *   - Field names: unknown. Read `?f=json` on the layer. The fork's enrichment used DBF
 *     names (owner_addr, owner_ad_2, mailing_ad, mailing__3), which came from a shapefile
 *     export and may not match the FeatureServer.
 *   - Ohio SOS business search deep-link format: confirm it accepts a name query
 *     parameter. If it doesn't, link to the search page without one.
 *
 * SECURITY: ArcGIS `where` injection. The address is interpolated into a SQL-92 `where`
 *   clause. Reuse publicRecords.normaliseAddress (it strips everything except
 *   [A-Z0-9 .#-]) and double single quotes exactly as soqlString does. Never pass a raw
 *   tile property.
 */
import type { BusinessSource, FetchJson, OwnerSource } from '../../contacts/publicRecords';
import type { BusinessContact, OwnerContact } from '../../contacts/types';
import type { ContactSources } from '../CityProfile';
import { notImplemented } from '../CityProfile';

export const MONTGOMERY_PARCELS_QUERY_URL =
  'https://services6.arcgis.com/EbVsqZ18sv1kVJ3k/ArcGIS/rest/services/Montgomery_County_Parcels/FeatureServer/0/query';

/** Owner of record from Montgomery County Auditor parcels. */
export class MontgomeryCountyOwnerSource implements OwnerSource {
  // O(1) time, O(1) space — n = 1 injected fetcher (tests pass a fake; default = network).
  constructor(private readonly fetchJson?: FetchJson) {}

  /**
   * One ArcGIS query by normalised address; one OwnerContact per distinct owner.
   * O(r) time, O(r) space — r = parcel rows at the address (usually 1, more for condos).
   */
  async findOwners(address: string): Promise<OwnerContact[]> {
    return notImplemented('MontgomeryCountyOwnerSource.findOwners', address, this.fetchJson);
  }
}

/** Businesses at a building, from OSM POIs inside the footprint (no licence data exists). */
export class DaytonPoiBusinessSource implements BusinessSource {
  // O(1) time, O(1) space — n = 1 lazy POI loader (dynamic import of the bundled data).
  constructor(private readonly loadPois?: () => Promise<GeoJSON.FeatureCollection>) {}

  /**
   * POIs within ~30 m of `lngLat`, plus any whose addr:street + housenumber match `address`.
   * O(p) time, O(k) space — p = Dayton POIs (~400, a linear scan is fine); k = matches.
   */
  async findBusinesses(address: string, lngLat: [number, number]): Promise<BusinessContact[]> {
    return notImplemented('DaytonPoiBusinessSource.findBusinesses', address, lngLat, this.loadPois);
  }
}

/**
 * Ohio Secretary of State business search (replaces Chicago's Illinois SOS link).
 * O(n) time, O(n) space — n = entity name length (URL encoding).
 */
export function ohioCorporationSearchUrl(entityName: string): string {
  return notImplemented('ohioCorporationSearchUrl', entityName);
}

/**
 * Assemble Dayton's contact sources (postal defaults "DAYTON", "OH").
 * O(1) time, O(1) space — n = 1 bundle of adapters.
 */
export function daytonContactSources(fetchJson?: FetchJson): ContactSources {
  return notImplemented('daytonContactSources', fetchJson);
}
