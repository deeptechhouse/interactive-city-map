/**
 * Free public-record sources for the contact list — called straight from the browser.
 *
 * PURPOSE
 *   Owner names (Cook County Assessor) and businesses (City of Chicago licences) are
 *   public, free, keyless and CORS-enabled (Access-Control-Allow-Origin: *, checked
 *   2026-10-01). Calling them from the browser means the contact list works in static
 *   mode with no backend at all. Only phone numbers need the backend (paid key).
 *
 * ARCHITECTURE
 *   OwnerSource / BusinessSource are the ports; the Socrata classes are adapters. To
 *   support another city, write adapters for its open-data portal and pick them in
 *   ContactResolver's factory — nothing else changes.
 *
 * SECURITY — SoQL injection: addresses come from tile data and are interpolated into a
 *   SoQL ``$where`` string. ``soqlString`` doubles single quotes (SoQL's escape), and
 *   ``normaliseAddress`` strips everything but letters, digits, spaces, '.', '-', '#',
 *   so a crafted address can't break out of the string literal.
 */
import { looksLikeCompany, newOwner, type BusinessContact, type OwnerContact, type PostalAddress } from './types';

/** Fetch function signature — injectable so tests never touch the network. */
export type FetchJson = (url: string) => Promise<unknown>;

export const defaultFetchJson: FetchJson = async (url) => {
  const resp = await fetch(url, { headers: { Accept: 'application/json' } });
  if (!resp.ok) throw new Error(`HTTP ${resp.status} from ${new URL(url).host}`);
  return resp.json();
};

/**
 * Upper-case, single-spaced, safe-character address: "1001  w North Ave" → "1001 W NORTH AVE".
 * Both datasets store addresses this way, so exact matching works after normalising.
 * O(n) — n = address length.
 */
export function normaliseAddress(address: string): string {
  return address
    .toUpperCase()
    .replace(/[^A-Z0-9 .#-]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

/** Quote a value as a SoQL string literal. O(n). */
export function soqlString(value: string): string {
  return `'${value.replace(/'/g, "''")}'`;
}

function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v); // O(p)
  return url.toString();
}

const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : '');

// ---------------------------------------------------------------------------
// Owners — Cook County Assessor "Parcel Addresses" (3723-97qp)
// ---------------------------------------------------------------------------

export interface OwnerSource {
  findOwners(address: string): Promise<OwnerContact[]>;
}

/**
 * One row per PIN per tax year. We take the newest year's rows for the address; several
 * PINs means a condo or a multi-parcel building, and each distinct owner is returned.
 *
 * KNOWN GAP: matching is on the footprint's address. Corner buildings whose footprint
 * address differs from the assessor's (side-street address) won't match — the panel
 * shows "No owner record" and the user can type it in.
 */
export class CookCountyOwnerSource implements OwnerSource {
  private static readonly URL = 'https://datacatalog.cookcountyil.gov/resource/3723-97qp.json';
  // ADJUSTABLE: max owners per building. High-rise condos have hundreds of PINs; listing
  // them all floods the panel and the CSV. 25 covers small condo buildings.
  static readonly MAX_OWNERS = 25;

  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /** One HTTP call. O(r) time, O(r) space — r = rows returned (≤ 200). */
  async findOwners(address: string): Promise<OwnerContact[]> {
    const addr = normaliseAddress(address);
    if (!addr) return [];
    const rows = await this.fetchJson(
      buildUrl(CookCountyOwnerSource.URL, {
        $select: [
          'pin', 'year', 'prop_address_zipcode_1',
          'owner_address_name', 'owner_address_full', 'owner_address_city_name', 'owner_address_state', 'owner_address_zipcode_1',
          'mail_address_name', 'mail_address_full', 'mail_address_city_name', 'mail_address_state', 'mail_address_zipcode_1',
        ].join(','),
        $where: `prop_address_full=${soqlString(addr)} AND prop_address_city_name='CHICAGO'`,
        $order: 'year DESC',
        $limit: '200',
      }),
    );
    if (!Array.isArray(rows) || rows.length === 0) return [];

    // Rows are newest-first; keep only the newest year. Note `year` arrives as "2026.0" for
    // the current year and "2025" for older ones, hence parseFloat.
    const newest = parseFloat(str((rows[0] as Record<string, unknown>).year));
    const seen = new Set<string>();
    const owners: OwnerContact[] = [];
    for (const raw of rows) {
      // O(r)
      const row = raw as Record<string, unknown>;
      if (parseFloat(str(row.year)) !== newest) break; // sorted desc → done with newest year
      const name = str(row.owner_address_name) || str(row.mail_address_name);
      if (!name) continue;
      const ownerAddress = addressFrom(row, 'owner_address');
      const taxBillAddress = addressFrom(row, 'mail_address');
      const key = `${name}|${ownerAddress.street}|${taxBillAddress.street}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push(
        newOwner({
          name,
          pin: str(row.pin),
          propertyZip: str(row.prop_address_zipcode_1),
          ownerAddress,
          taxBillAddress,
          // Letters default to the owner's own address; fall back to the tax-bill
          // address when the county has no owner address on file.
          letterTo: ownerAddress.street ? 'owner' : 'taxBill',
          isCompany: looksLikeCompany(name),
        }),
      );
      if (owners.length >= CookCountyOwnerSource.MAX_OWNERS) break;
    }
    return owners;
  }
}

/** Read one of the county's address groups ("owner_address" / "mail_address"). O(1). */
function addressFrom(row: Record<string, unknown>, prefix: 'owner_address' | 'mail_address'): PostalAddress {
  return {
    street: str(row[`${prefix}_full`]),
    city: str(row[`${prefix}_city_name`]),
    state: str(row[`${prefix}_state`]),
    zip: str(row[`${prefix}_zipcode_1`]),
  };
}

// ---------------------------------------------------------------------------
// Businesses — City of Chicago "Business Licenses - Current Active" (uupf-x98q)
// ---------------------------------------------------------------------------

export interface BusinessSource {
  /** By street address (preferred) or, when the footprint has none, near a point. */
  findBusinesses(address: string, lngLat: [number, number]): Promise<BusinessContact[]>;
}

export class ChicagoLicenseSource implements BusinessSource {
  private static readonly URL = 'https://data.cityofchicago.org/resource/uupf-x98q.json';
  // ADJUSTABLE: radius (m) for the no-address fallback. Bigger catches more of a large
  // building but starts pulling in the neighbours across the street (~20 m).
  static readonly FALLBACK_RADIUS_M = 25;

  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /** One HTTP call. O(r) time, O(r) space — r = licence rows (≤ 200). */
  async findBusinesses(address: string, lngLat: [number, number]): Promise<BusinessContact[]> {
    const addr = normaliseAddress(address);
    const [lon, lat] = lngLat;
    // Licence addresses often carry a unit: "1001 W NORTH AVE  UNIT E". Match the bare
    // address or the address followed by a space — NOT a bare prefix, which would make
    // "100 W …" match "1001 W …".
    const where = addr
      ? `address=${soqlString(addr)} OR starts_with(address, ${soqlString(`${addr} `)})`
      : `within_circle(location, ${Number(lat)}, ${Number(lon)}, ${ChicagoLicenseSource.FALLBACK_RADIUS_M})`;
    const rows = await this.fetchJson(
      buildUrl(ChicagoLicenseSource.URL, {
        $select: 'account_number,site_number,legal_name,doing_business_as_name,business_activity,address,zip_code',
        $where: where,
        $limit: '200',
      }),
    );
    if (!Array.isArray(rows)) return [];

    // One business often holds several licences (one row each) → dedupe by account+site.
    const byKey = new Map<string, BusinessContact>();
    for (const raw of rows) {
      // O(r)
      const row = raw as Record<string, unknown>;
      const legalName = str(row.legal_name);
      const name = str(row.doing_business_as_name) || legalName;
      if (!name) continue;
      const account = str(row.account_number);
      const id = account ? `${account}-${str(row.site_number)}` : name.toUpperCase();
      const existing = byKey.get(id);
      const activity = str(row.business_activity);
      if (existing) {
        // Merge activities from extra licences, avoiding repeats.
        if (activity && !existing.activity.includes(activity)) {
          existing.activity = existing.activity ? `${existing.activity} | ${activity}` : activity;
        }
        continue;
      }
      byKey.set(id, {
        id,
        name,
        legalName: legalName || name,
        activity,
        address: str(row.address).replace(/\s+/g, ' '),
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
