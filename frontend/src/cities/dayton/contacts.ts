/**
 * Dayton public-record sources for the building contact list (browser-side, free, keyless).
 *
 * PURPOSE
 *   Chicago uses Cook County Assessor (owner of record) and City of Chicago business
 *   licences. Dayton's equivalents:
 *     owners     → Montgomery County (OH) Auditor CAMA, via the City of Dayton's parcel
 *                  layer (MapLayers_Citywide/MapServer/9, which joins parcel polygons to
 *                  the Auditor's WEB_CAMA table).
 *     businesses → Dayton has NO general business-licence dataset (Ohio doesn't license
 *                  most businesses at city level). Fallback: named OSM shops/amenities/
 *                  offices within 40 m of the clicked point, from the Overpass API. Much
 *                  thinner coverage than Chicago's licences.
 *   Both implement the ports in contacts/publicRecords.ts, so ContactResolver only picks
 *   the profile's sources.
 *
 * VERIFIED 2026-10-02
 *   - WRONG COUNTY TRAP: the services6.arcgis.com "Montgomery_County_Parcels" FeatureServer
 *     the fork named is Montgomery County, NEW YORK. Not used.
 *   - CORS: maps.daytonohio.gov echoes the request Origin (Access-Control-Allow-Origin:
 *     http://localhost:5180, allow-credentials true). Overpass sends `*`.
 *   - Matching: building addresses come from the same field (PARLOC, e.g. "100 SAMPLE
 *     AVE") through the backend parcel join, so an exact match works.
 *   - Overpass returns HTTP 406 to requests WITHOUT a Referer and a generic UA (curl,
 *     python-httpx). Browsers send a Referer, which passes; but the public server is
 *     often busy (504). A failure surfaces as an error note in the panel, never as fake data.
 *   - Ohio SOS: businesssearch.ohiosos.gov is a single-page app with no documented
 *     name parameter (it was in maintenance during the check). The link opens the search
 *     page; the user types the name. UNPROVEN whether a deep link exists.
 *
 * SECURITY: ArcGIS `where` injection. The address is interpolated into a SQL-92 `where`
 *   clause: normaliseAddress (keeps only [A-Z0-9 .#-]) and then soqlString (doubles single
 *   quotes — SQL-92 uses the same escape as SoQL). Overpass coordinates are forced to finite
 *   numbers before they enter the query text.
 */
import {
  defaultFetchJson,
  normaliseAddress,
  soqlString,
  type BusinessSource,
  type FetchJson,
  type OwnerSource,
} from '../../contacts/publicRecords';
import {
  looksLikeCompany,
  newOwner,
  type BusinessContact,
  type OwnerContact,
  type PostalAddress,
} from '../../contacts/types';
import type { ContactSources } from '../CityProfile';

export const DAYTON_PARCELS_QUERY_URL =
  'https://maps.daytonohio.gov/gisservices/rest/services/Viewer/MapLayers_Citywide/MapServer/9/query';

export const OVERPASS_URL = 'https://overpass-api.de/api/interpreter';

const CAMA = 'GISADMIN.WEB_CAMA.';
const POLY = 'GISADMIN.mc_parcel_polygon_e.';

/** Fields read from the parcel layer (qualified names, as the join layer requires). */
const OWNER_FIELDS = [
  `${CAMA}PARID`, `${CAMA}PARLOC`, `${POLY}LOC_ZIP`,
  `${CAMA}OWNER_NAME`, `${CAMA}OWNER_NA_1`, `${CAMA}OWNER_ADDR`, `${CAMA}OWNER_AD_1`, `${CAMA}OWNER_AD_2`,
  `${CAMA}MAILING_AD`, `${CAMA}MAILING__2`, `${CAMA}MAILING__3`,
  `${CAMA}MCITYNAME`, `${CAMA}MSTATECODE`, `${CAMA}MZIP1`,
] as const;

/** Trimmed string value or '' (CAMA pads blanks with a single space). O(n) time, O(n) space — n = value length. */
const str = (v: unknown): string => (typeof v === 'string' ? v.trim() : typeof v === 'number' ? String(v) : '');

/**
 * Split "DAYTON, OH  45402" / "DAYTON OH 45402" into city/state/zip. Unparseable text
 * becomes the city so nothing is lost.
 * O(n) time, O(n) space — n = line length (one regex match).
 */
export function splitCityLine(line: string): Omit<PostalAddress, 'street'> {
  const m = /^\s*(.*?)[,\s]+([A-Z]{2})\s+(\d{5})(?:-?\d{4})?\s*$/.exec(line.trim().toUpperCase());
  if (!m) return { city: line.trim(), state: '', zip: '' };
  return { city: m[1].trim(), state: m[2], zip: m[3] };
}

/** Build a query URL. O(p) time, O(p) space — p = parameters. */
function buildUrl(base: string, params: Record<string, string>): string {
  const url = new URL(base);
  // O(p) time, O(1) space — p = parameters
  for (const [k, v] of Object.entries(params)) url.searchParams.set(k, v);
  return url.toString();
}

/** Owner of record from the Montgomery County Auditor (via City of Dayton MapServer/9). */
export class MontgomeryCountyOwnerSource implements OwnerSource {
  // ADJUSTABLE: max owners per building (condo buildings have many parcels at one address).
  static readonly MAX_OWNERS = 25;

  // O(1) time, O(1) space — n = 1 injected fetcher (tests pass a fake; default = network).
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /**
   * One ArcGIS query by normalised address; one OwnerContact per distinct owner.
   * O(r) time, O(r) space — r = parcel rows at the address (usually 1, more for condos).
   */
  async findOwners(address: string): Promise<OwnerContact[]> {
    const addr = normaliseAddress(address);
    if (!addr) return [];
    const data = (await this.fetchJson(
      buildUrl(DAYTON_PARCELS_QUERY_URL, {
        where: `${CAMA}PARLOC = ${soqlString(addr)}`,
        outFields: OWNER_FIELDS.join(','),
        returnGeometry: 'false',
        resultRecordCount: '200',
        f: 'json',
      }),
    )) as { features?: Array<{ attributes?: Record<string, unknown> }>; error?: unknown } | null;
    if (!data || data.error || !Array.isArray(data.features)) return [];

    const seen = new Set<string>();
    const owners: OwnerContact[] = [];
    // O(r) time, O(r) space — r = parcel rows
    for (const feature of data.features) {
      const owner = ownerFromAttributes(feature.attributes ?? {});
      if (!owner) continue;
      const key = `${owner.name}|${owner.ownerAddress.street}|${owner.taxBillAddress.street}`;
      if (seen.has(key)) continue;
      seen.add(key);
      owners.push(owner);
      if (owners.length >= MontgomeryCountyOwnerSource.MAX_OWNERS) break;
    }
    return owners;
  }
}

/**
 * One CAMA row → OwnerContact, or null when it names no owner.
 * O(1) time, O(1) space — f = fixed field set.
 */
export function ownerFromAttributes(row: Readonly<Record<string, unknown>>): OwnerContact | null {
  // OWNER_NA_1 continues a long name: "OLDIGES PATRICIA D TR AND" + "GLEN E TR".
  // O(1) time, O(1) space — p = 2 name parts
  const name = [str(row[`${CAMA}OWNER_NAME`]), str(row[`${CAMA}OWNER_NA_1`])].filter(Boolean).join(' ');
  if (!name) return null;
  const ownerAddress: PostalAddress = {
    street: str(row[`${CAMA}OWNER_ADDR`]) || str(row[`${CAMA}OWNER_AD_1`]),
    ...splitCityLine(str(row[`${CAMA}OWNER_AD_2`])),
  };
  // Mailing: prefer the structured MCITYNAME/MSTATECODE/MZIP1; fall back to parsing MAILING__3.
  const structured = str(row[`${CAMA}MCITYNAME`]);
  const taxBillAddress: PostalAddress = {
    street: str(row[`${CAMA}MAILING_AD`]) || str(row[`${CAMA}MAILING__2`]),
    ...(structured
      ? { city: structured, state: str(row[`${CAMA}MSTATECODE`]), zip: str(row[`${CAMA}MZIP1`]) }
      : splitCityLine(str(row[`${CAMA}MAILING__3`]))),
  };
  return newOwner({
    name,
    pin: str(row[`${CAMA}PARID`]),
    propertyZip: str(row[`${POLY}LOC_ZIP`]),
    ownerAddress,
    taxBillAddress,
    letterTo: ownerAddress.street ? 'owner' : 'taxBill',
    isCompany: looksLikeCompany(name),
  });
}

// OSM keys that mark a business-like feature. ADJUSTABLE: add 'leisure' to include gyms etc.
const BUSINESS_KEYS = ['shop', 'amenity', 'office', 'craft', 'tourism', 'healthcare'] as const;
// Named amenities that are not businesses you'd contact.
const NOT_BUSINESS = new Set(['parking', 'bench', 'waste_basket', 'bicycle_parking', 'fountain', 'shelter', 'parking_entrance']);

interface OverpassElement {
  type?: string;
  id?: number;
  tags?: Record<string, string>;
}

/** Businesses near a building, from named OpenStreetMap features (no licence data exists). */
export class DaytonOsmBusinessSource implements BusinessSource {
  // ADJUSTABLE: search radius (m) around the click. 40 m covers a mid-size building; above
  // ~60 m it pulls in the neighbours across the street.
  static readonly RADIUS_M = 40;

  // O(1) time, O(1) space — n = 1 injected fetcher.
  constructor(private readonly fetchJson: FetchJson = defaultFetchJson) {}

  /**
   * One Overpass call around the click point. `address` is not used for matching (few OSM
   * features carry addr:* in Dayton); it is accepted to satisfy the port.
   * O(r) time, O(r) space — r = elements returned (≤ 50).
   */
  async findBusinesses(_address: string, lngLat: [number, number]): Promise<BusinessContact[]> {
    const lon = Number(lngLat[0]);
    const lat = Number(lngLat[1]);
    if (!Number.isFinite(lon) || !Number.isFinite(lat)) return [];
    const keys = BUSINESS_KEYS.join('|');
    const query =
      `[out:json][timeout:15];nwr(around:${DaytonOsmBusinessSource.RADIUS_M},${lat},${lon})` +
      `[name][~"^(${keys})$"~"."];out tags 50;`;
    const data = (await this.fetchJson(buildUrl(OVERPASS_URL, { data: query }))) as {
      elements?: OverpassElement[];
    } | null;
    if (!data || !Array.isArray(data.elements)) return [];

    const out = new Map<string, BusinessContact>();
    // O(r) time, O(r) space — r = elements
    for (const el of data.elements) {
      const business = businessFromOsm(el);
      if (business && !out.has(business.id)) out.set(business.id, business);
    }
    return [...out.values()];
  }
}

/**
 * One OSM element → BusinessContact, or null for unnamed / non-business features.
 * O(k) time, O(1) space — k = 6 business keys checked.
 */
export function businessFromOsm(el: OverpassElement): BusinessContact | null {
  const tags = el.tags ?? {};
  const name = (tags.name ?? '').trim();
  if (!name) return null;
  // O(k) time, O(1) space — k = business keys
  const kind = BUSINESS_KEYS.find((k) => tags[k]);
  if (!kind || NOT_BUSINESS.has(tags[kind])) return null;
  const phone = (tags.phone ?? tags['contact:phone'] ?? '').trim();
  return {
    id: `osm-${el.type ?? 'node'}-${el.id ?? name}`,
    name,
    legalName: (tags.operator ?? '').trim() || name,
    activity: `${kind}: ${tags[kind]}`,
    // O(1) time, O(1) space — p = 2 address parts
    address: [tags['addr:housenumber'], tags['addr:street']].filter(Boolean).join(' ').toUpperCase(),
    zip: (tags['addr:postcode'] ?? '').trim(),
    phone,
    // An OSM phone is volunteer-entered: shown as found, labelled with its source.
    phoneStatus: phone ? 'found' : 'pending',
    phoneSource: phone ? 'osm' : '',
    website: (tags.website ?? tags['contact:website'] ?? '').trim(),
  };
}

/**
 * Ohio Secretary of State business search (replaces Chicago's Illinois SOS link). No
 * documented name parameter exists, so this opens the search page; the name is unused.
 * O(1) time, O(1) space — n = constant URL.
 */
export function ohioCorporationSearchUrl(entityName: string): string {
  void entityName; // kept for the ContactSources signature; see UNPROVEN note above
  return 'https://businesssearch.ohiosos.gov/';
}

/**
 * Assemble Dayton's contact sources (postal defaults "DAYTON", "OH").
 * O(1) time, O(1) space — n = 1 bundle of adapters.
 */
export function daytonContactSources(fetchJson: FetchJson = defaultFetchJson): ContactSources {
  return {
    owners: new MontgomeryCountyOwnerSource(fetchJson),
    businesses: new DaytonOsmBusinessSource(fetchJson),
    postalCity: 'DAYTON',
    postalState: 'OH',
    corporationSearchUrl: ohioCorporationSearchUrl,
  };
}
