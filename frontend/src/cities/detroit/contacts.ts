/**
 * Detroit public-record sources for the building contact list.
 *
 * PURPOSE
 *   Chicago uses Cook County Assessor (owner of record) + City of Chicago business licences,
 *   both Socrata. Detroit's equivalents live on the City's ArcGIS Hub (org
 *   qvkbeam7Wirps6zC), also free and keyless, and both implement the ports in
 *   contacts/publicRecords.ts so ContactResolver needs no Detroit branch:
 *     owners     → parcel_file_current  (Office of the Assessor; taxpayer + mailing address)
 *     businesses → bseed_active_business_licenses
 *
 * VERIFIED 2026-10-02
 *   - CORS: both query endpoints answer `Access-Control-Allow-Origin: *` to
 *     Origin http://localhost:5180, so the contact list works in static mode, no backend.
 *   - Parcel fields: parcel_id, address, zip_code, taxpayer_1, taxpayer_2, taxpayer_address,
 *     taxpayer_city, taxpayer_state, taxpayer_zip_code. (Old guesses taxpayer_street /
 *     taxpayer_zip do not exist.)
 *   - Licence fields: record_id, business_name, address, license_type, zip_code.
 *
 * TRAPS
 *   - The Assessor stores addresses WITHOUT the street type: SEMCOG footprint
 *     "19451 SHERWOOD ST" is parcel "19451 SHERWOOD". Matching only the full string finds
 *     nothing for most buildings, so both spellings are queried (addressCandidates).
 *   - Licence addresses are mixed case ("200 W Columbia St") — matched with UPPER(address).
 *   - The Assessor has ONE taxpayer address per parcel; it fills both ownerAddress and
 *     taxBillAddress so the letter target works either way.
 *
 * SECURITY — ArcGIS `where` injection: the address comes from tile data and is interpolated
 *   into a SQL-92 `where`. normaliseAddress strips everything but [A-Z0-9 .#-], and
 *   sqlString doubles single quotes on top (defence in depth). Coordinates go through
 *   Number() and are sent as separate parameters, never inside the where clause.
 */
import { defaultFetchJson, normaliseAddress, type BusinessSource, type FetchJson, type OwnerSource } from '../../contacts/publicRecords';
import { looksLikeCompany, newOwner, type BusinessContact, type OwnerContact, type PostalAddress } from '../../contacts/types';
import type { ContactSources } from '../CityProfile';

export const DETROIT_PARCELS_QUERY_URL =
  'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/parcel_file_current/FeatureServer/0/query';
export const DETROIT_LICENSES_QUERY_URL =
  'https://services2.arcgis.com/qvkbeam7Wirps6zC/arcgis/rest/services/bseed_active_business_licenses/FeatureServer/0/query';

/**
 * Michigan LARA business registry (MiBusiness Registry). It blocks scripted requests
 * (HTTP 403 to curl, 2026-10-02), so like Illinois SOS it is a link the user opens.
 * UNPROVEN: whether the page accepts a query parameter to pre-fill the name.
 */
export const MI_LARA_SEARCH_URL = 'https://mibusinessregistry.lara.state.mi.us/search/business';

// Street types the Assessor leaves off. ADJUSTABLE: add a type if a footprint address
// with it never matches its parcel.
const STREET_TYPES: ReadonlySet<string> = new Set([
  'ST', 'AVE', 'AV', 'BLVD', 'RD', 'DR', 'CT', 'PL', 'HWY', 'PKWY', 'LN', 'WAY', 'TER', 'CIR', 'FWY', 'SQ',
]);

/** Quote a value as an ArcGIS SQL-92 string literal (double single quotes). O(n) time, O(n) space — n = length. */
export function sqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

/**
 * Normalised address plus the same address without a trailing street type.
 * "19451 Sherwood St" → ["19451 SHERWOOD ST", "19451 SHERWOOD"]. Empty input → [].
 * O(n) time, O(n) space — n = address length.
 */
export function addressCandidates(address: string): string[] {
  const full = normaliseAddress(address);
  if (!full) return [];
  const words = full.split(' ');
  const last = words[words.length - 1];
  if (words.length > 2 && STREET_TYPES.has(last)) return [full, words.slice(0, -1).join(' ')];
  return [full];
}

/** Build a query URL from params. O(p) time, O(p) space — p = parameters. */
function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  // O(p) time, O(1) space — p = parameters
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** ArcGIS JSON `features[].attributes`, or [] for any other shape. O(r) time, O(r) space — r = rows. */
function attributesOf(json: unknown): Record<string, unknown>[] {
  const features = (json as { features?: unknown } | null)?.features;
  if (!Array.isArray(features)) return [];
  // O(r) time, O(r) space — r = features
  return features.map((f) => ((f as { attributes?: Record<string, unknown> }).attributes ?? {}));
}

/** Trimmed string or ''. O(n) time, O(n) space — n = length. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : v == null ? '' : String(v).trim());

/** Owner of record from Detroit Assessor parcels. */
export class DetroitParcelOwnerSource implements OwnerSource {
  // ADJUSTABLE: max owners per building (condo towers have many parcels at one address).
  static readonly MAX_OWNERS = 25;

  // O(1) time, O(1) space — n = 1 injected fetcher (tests pass a fake; default = network).
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /**
   * One ArcGIS query by normalised address; one OwnerContact per distinct taxpayer.
   * O(r) time, O(r) space — r = parcel rows at the address (usually 1, more for condos).
   */
  async findOwners(address: string): Promise<OwnerContact[]> {
    const candidates = addressCandidates(address);
    if (candidates.length === 0) return [];
    const json = await this.fetchJson(
      buildUrl(DETROIT_PARCELS_QUERY_URL, {
        // O(c) time, O(c) space — c = address candidates (≤ 2)
        where: `address IN (${candidates.map(sqlString).join(',')})`,
        outFields: [
          'parcel_id', 'address', 'zip_code', 'taxpayer_1', 'taxpayer_2',
          'taxpayer_address', 'taxpayer_city', 'taxpayer_state', 'taxpayer_zip_code',
        ].join(','),
        returnGeometry: 'false',
        resultRecordCount: '200',
        f: 'json',
      }),
    );
    const seen = new Set<string>();
    const owners: OwnerContact[] = [];
    // O(r) time, O(r) space — r = rows
    for (const row of attributesOf(json)) {
      const name = str(row.taxpayer_1);
      if (!name) continue;
      const mail: PostalAddress = {
        street: str(row.taxpayer_address),
        city: str(row.taxpayer_city),
        state: str(row.taxpayer_state),
        zip: str(row.taxpayer_zip_code),
      };
      const key = `${name}|${mail.street}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push(
        newOwner({
          name,
          pin: str(row.parcel_id),
          propertyZip: str(row.zip_code),
          ownerAddress: mail,
          taxBillAddress: { ...mail },
          letterTo: 'owner',
          isCompany: looksLikeCompany(name),
        }),
      );
      if (owners.length >= DetroitParcelOwnerSource.MAX_OWNERS) break;
    }
    return owners;
  }
}

/** Businesses at a building from BSEED active business licences. */
export class DetroitBusinessLicenseSource implements BusinessSource {
  // ADJUSTABLE: radius (m) for the no-address fallback. Bigger catches more of a large
  // building but starts pulling in neighbours across the street (~20 m).
  static readonly FALLBACK_RADIUS_M = 30;

  // O(1) time, O(1) space — n = 1 injected fetcher.
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /**
   * Address match first; if the footprint has no address, a 30 m point-buffer query.
   * O(r) time, O(r) space — r = licence rows returned.
   */
  async findBusinesses(address: string, lngLat: [number, number]): Promise<BusinessContact[]> {
    const candidates = addressCandidates(address);
    const params: Record<string, string> = {
      outFields: 'record_id,business_name,address,license_type,zip_code',
      returnGeometry: 'false',
      resultRecordCount: '200',
      f: 'json',
    };
    if (candidates.length > 0) {
      // Exact (either spelling) or the full address followed by a unit ("… ST STE 2").
      // A bare prefix would make "100 W …" match "1001 W …", hence the trailing space.
      // O(c) time, O(c) space — c = candidates (≤ 2)
      const inList = candidates.map(sqlString).join(',');
      params.where = `UPPER(address) IN (${inList}) OR UPPER(address) LIKE ${sqlString(`${candidates[0]} %`)}`;
    } else {
      const [lon, lat] = lngLat;
      params.where = '1=1';
      params.geometry = `${Number(lon)},${Number(lat)}`;
      params.geometryType = 'esriGeometryPoint';
      params.inSR = '4326';
      params.distance = String(DetroitBusinessLicenseSource.FALLBACK_RADIUS_M);
      params.units = 'esriSRUnit_Meter';
      params.spatialRel = 'esriSpatialRelIntersects';
    }
    const json = await this.fetchJson(buildUrl(DETROIT_LICENSES_QUERY_URL, params));

    // One business can hold several licences (one row each) → dedupe by name + address.
    const byKey = new Map<string, BusinessContact>();
    // O(r) time, O(r) space — r = rows
    for (const row of attributesOf(json)) {
      const name = str(row.business_name);
      if (!name) continue;
      const addr = str(row.address).replace(/\s+/g, ' ');
      const id = `${name.toUpperCase()}|${addr.toUpperCase()}`;
      const activity = str(row.license_type);
      const existing = byKey.get(id);
      if (existing) {
        if (activity && !existing.activity.includes(activity)) {
          existing.activity = existing.activity ? `${existing.activity} | ${activity}` : activity;
        }
        continue;
      }
      byKey.set(id, {
        id: str(row.record_id) || id,
        name,
        legalName: name,
        activity,
        address: addr,
        zip: str(row.zip_code),
        phone: '',
        phoneStatus: 'pending',
        phoneSource: '',
        website: '',
      });
    }
    return [...byKey.values()];
  }
}

/**
 * Michigan LARA corporation search (replaces the Illinois SOS link for Detroit owners).
 * The registry takes no reliable query parameter (see MI_LARA_SEARCH_URL), so the name is
 * accepted for the interface and the user pastes it in.
 * O(1) time, O(1) space — n = 1 fixed URL.
 */
export function michiganCorporationSearchUrl(entityName: string): string {
  void entityName;
  return MI_LARA_SEARCH_URL;
}

/**
 * Assemble Detroit's contact sources.
 * O(1) time, O(1) space — n = 1 bundle of adapters.
 */
export function detroitContactSources(fetchJson: FetchJson = defaultFetchJson): ContactSources {
  return {
    owners: new DetroitParcelOwnerSource(fetchJson),
    businesses: new DetroitBusinessLicenseSource(fetchJson),
    postalCity: 'DETROIT',
    postalState: 'MI',
    corporationSearchUrl: michiganCorporationSearchUrl,
  };
}
