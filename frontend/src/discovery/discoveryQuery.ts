/**
 * Business discovery — the FREE half of "find buildings worth paying to look up".
 *
 * PURPOSE (asked for 2026-10-02): list every business ACTIVITY inside the current search
 * area, let the user tick some, highlight the buildings where they operate, prune by
 * clicking, then send only the curated buildings to the paid lookups. Everything in this
 * file talks to the City of Chicago business-licence dataset (uupf-x98q), which is free,
 * keyless and CORS-enabled — no paid API is ever called from here.
 *
 * This file is PURE (query strings + grouping, no fetch, no React) so it's easy to test.
 *
 * AREA → SoQL
 *   The licence rows carry ward, police_district and zip_code columns, so focus areas
 *   filter exactly with no geometry: union = OR across kinds, intersection = AND.
 *   No focus area selected → the current map view, via within_box(location, …).
 *
 * TYPES
 *   business_activity is the specific activity ("Preparation and Sale of Coffee"); a row
 *   can hold several joined with " | ". ~2,500 distinct citywide. (license_description
 *   has only 58 broad types like "Limited Business License" — too vague to curate with.)
 */
import { normaliseAddress, soqlString } from '../contacts/publicRecords';
import type { FocusSelection } from '../focus/focusGeometry';

export const LICENSE_URL = 'https://data.cityofchicago.org/resource/uupf-x98q.json';

/** [west, south, east, north] in degrees. */
export type Bounds = [number, number, number, number];

export type SearchArea = { kind: 'focus'; selection: FocusSelection } | { kind: 'view'; bounds: Bounds };

// Licence-table column for each focus-area kind.
const COLUMN = {
  zip: 'zip_code',
  police: 'police_district',
  ward: 'ward',
} as const;

/** Only digits survive — area ids are numbers; anything else can't reach the query.
 * O(k) time, O(k) space — k = ids. */
// O(k) time, O(k) space — k = ids.
const digitsOnly = (ids: readonly string[]) => ids.map((id) => id.replace(/\D/g, '')).filter(Boolean);

/**
 * SoQL WHERE for an area. O(k) time, O(k) space — k = selected area ids.
 */
export function areaWhere(area: SearchArea): string {
  if (area.kind === 'view') {
    // O(1) time, O(1) space — n = 4 coordinates.
    const [w, s, e, n] = area.bounds.map(Number);
    // within_box(location, north-west lat, north-west lon, south-east lat, south-east lon)
    return `within_box(location, ${n}, ${w}, ${s}, ${e})`;
  }
  const sel = area.selection;
  // One "column in(...)" clause per kind that has ids (3 kinds).
  // O(k) time, O(k) space — k = selected ids.
  const clauses = (['zip', 'police', 'ward'] as const)
    .map((kind) => [COLUMN[kind], digitsOnly(sel[kind])] as const)
    .filter(([, ids]) => ids.length > 0)
    // O(k) time, O(k) space — k = selected ids.
    .map(([col, ids]) => `${col} in(${ids.map((i) => `'${i}'`).join(',')})`);
  if (clauses.length === 0) return '1 = 0';
  const joiner = sel.mode === 'intersection' ? ' AND ' : ' OR ';
  // O(c) time, O(c) space — c = clauses (≤ 3).
  return clauses.map((c) => `(${c})`).join(joiner);
}

/** Free query: count of licence rows per activity combination in the area.
 * O(k) time, O(k) space — k = selected area ids. */
export function typeCountsParams(area: SearchArea): Record<string, string> {
  return {
    $select: 'business_activity, count(*) AS n',
    $where: `(${areaWhere(area)}) AND business_activity IS NOT NULL`,
    $group: 'business_activity',
    $limit: '5000',
  };
}

export interface ActivityCount {
  activity: string;
  count: number;
}

/**
 * Rows of "A | B" combos → one count per single activity, biggest first.
 * bigo-allow: a (activities per row) is bounded by ~5, so r·a is linear in rows.
 * O(r + t log t) time, O(t) space — r = rows, t = distinct activities.
 */
export function parseTypeCounts(rows: unknown): ActivityCount[] {
  if (!Array.isArray(rows)) return [];
  const counts = new Map<string, number>();
  // Split each combo and add its count to every activity in it.
  // O(r) time, O(t) space — r = rows, t = distinct activities.
  for (const raw of rows) {
    const row = raw as Record<string, unknown>;
    const n = Number(row.n) || 0;
    // O(a) time, O(a) space — a = activities in this combo.
    for (const activity of String(row.business_activity ?? '')
      .split('|')
      .map((x) => x.trim())
      .filter(Boolean)) {
      counts.set(activity, (counts.get(activity) ?? 0) + n);
    }
  }
  // O(t log t) time, O(t) space — t = distinct activities.
  return [...counts]
    .map(([activity, count]) => ({ activity, count }))
    .sort((x, y) => y.count - x.count || x.activity.localeCompare(y.activity));
}

/** SoQL LIKE pattern for "contains this activity"; quotes escaped.
 * O(n) time, O(n) space — n = activity length. */
function containsActivity(activity: string): string {
  // % and _ are LIKE wildcards — strip them so a name can't widen the match.
  return `business_activity like ${soqlString(`%${activity.replace(/[%_]/g, ' ')}%`)}`;
}

/** Free query: the licences for the chosen activities in the area.
 * O(t) time, O(t) space — t = activities chosen. */
export function businessesParams(area: SearchArea, activities: readonly string[]): Record<string, string> {
  // O(t) time, O(t) space — t = chosen activities.
  const anyActivity = activities.map(containsActivity).join(' OR ');
  return {
    $select:
      'account_number,site_number,legal_name,doing_business_as_name,address,zip_code,latitude,longitude,business_activity',
    $where: `(${areaWhere(area)}) AND (${anyActivity || '1 = 0'}) AND latitude IS NOT NULL`,
    $limit: '5000',
  };
}

// ---------------------------------------------------------------------------
// Licence rows → candidate buildings
// ---------------------------------------------------------------------------

export interface DiscoveredBusiness {
  name: string;
  legalName: string;
  activity: string;
  address: string;
}

/** One building the user may send to the paid lookups. */
export interface Candidate {
  /** Normalised building street address — the grouping and removal key. */
  key: string;
  address: string;
  zip: string;
  lngLat: [number, number];
  businesses: DiscoveredBusiness[];
}

// Words that end a street name; anything after them is a unit/suite ("4030", "5 FLOORS").
const STREET_SUFFIX = /\b(ST|AVE|AV|DR|BLVD|RD|PL|CT|PKWY|HWY|TER|LN|WAY|SQ|PLZ|PLAZA|ROW|CIR|EXPY|BROADWAY)\b/;
// Unit markers that start the unit part even before a suffix.
const UNIT_MARKER = /\s+(UNIT|STE|SUITE|APT|#|FL|FLOOR|RM|ROOM|BLDG|SPACE|SP)\b.*$/;

/**
 * Licence address → the BUILDING's street address, so several suites group together and
 * the county owner lookup (which uses building addresses) matches.
 *   "1001 W NORTH AVE  UNIT E"   → "1001 W NORTH AVE"
 *   "233 S WACKER DR 4030"       → "233 S WACKER DR"
 *   "4840 N MARINE DR 5 FLOORS"  → "4840 N MARINE DR"
 * O(n) time, O(n) space — n = address length.
 */
export function buildingAddress(licenseAddress: string): string {
  const a = normaliseAddress(licenseAddress).replace(UNIT_MARKER, '');
  const m = a.match(STREET_SUFFIX);
  return m && m.index !== undefined ? a.slice(0, m.index + m[0].length) : a;
}

/**
 * Licence rows → one candidate per building, businesses deduped by account+site.
 * Location = the first licence's point (they're geocoded to the same building).
 * O(r) time, O(r) space — r = licence rows.
 */
export function groupCandidates(rows: unknown): Candidate[] {
  if (!Array.isArray(rows)) return [];
  const byKey = new Map<string, Candidate>();
  const seen = new Set<string>(); // "<building>|<licence>" already added
  // One pass; Map/Set lookups are constant time.
  // O(r) time, O(r) space — r = licence rows.
  for (const raw of rows) {
    const r = raw as Record<string, unknown>;
    const lat = Number(r.latitude);
    const lon = Number(r.longitude);
    const address = buildingAddress(String(r.address ?? ''));
    if (!address || !Number.isFinite(lat) || !Number.isFinite(lon)) continue;
    let c = byKey.get(address);
    if (!c) {
      c = {
        key: address,
        address,
        zip: String(r.zip_code ?? ''),
        lngLat: [lon, lat],
        businesses: [],
      };
      byKey.set(address, c);
    }
    const id = `${address}|${r.account_number ?? ''}-${r.site_number ?? ''}-${r.doing_business_as_name ?? ''}`;
    if (seen.has(id)) continue;
    seen.add(id);
    const legalName = String(r.legal_name ?? '').trim();
    c.businesses.push({
      name: String(r.doing_business_as_name ?? '').trim() || legalName,
      legalName,
      activity: String(r.business_activity ?? ''),
      address: String(r.address ?? '')
        .replace(/\s+/g, ' ')
        .trim(),
    });
  }
  return [...byKey.values()];
}
