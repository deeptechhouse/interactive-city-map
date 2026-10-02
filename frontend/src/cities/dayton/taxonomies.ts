/**
 * Dayton legend/filter vocabularies: transit line colours, railroad owners, railroad
 * ownership types, POI category counts.
 *
 * GENERATED FROM DATA, 2026-10-02 (static export of public/data/dayton/). Rebuild the
 * export → re-read these values; do not hand-tune them to taste.
 *   - Transit: GDRTA GTFS routes.txt (21 routes, every one has route_color). The backend
 *     upper-cases colours; `line_name` = route_long_name ("ROUTE 1", "FLYER", …).
 *     Note: GDRTA reuses colours across routes (#00FF00 on 2, 55, X6, West Connector).
 *   - Railroads: OSM operator text → canonical key by backend static_plan
 *     RAILROAD_OPERATORS. Distinct values in the export: NS (119 ways), CSX (102),
 *     MetroParks (12), none (271 → '_other' bucket).
 *   - Ownership types present: private_class1, county_owned, unknown. (Never Chicago's
 *     "CTA/Metra/NICTD" or "Cook County".)
 *   - POIs: category counts of pois.pmtiles (344 named OSM nodes).
 *
 * TaxonomyEntry semantics follow map/controls/RailroadFilter.tsx: `key` is compared to
 * the tile's `owner` / `ownership_type`; '_other' collects owners not listed.
 */
import type { TaxonomyEntry } from '../CityProfile';
import { RAILROAD_COLORS } from '../../utils/colorSchemes';

/** `line_name` → hex colour, from GDRTA routes.txt route_color. */
export const DAYTON_TRANSIT_COLORS: Readonly<Record<string, string>> = {
  'ROUTE 1': '#FF8080',
  'ROUTE 2': '#00FF00',
  'ROUTE 3': '#FF80FF',
  'ROUTE 4': '#0080FF',
  'ROUTE 6': '#8000FF',
  'ROUTE 7': '#FF0000',
  'ROUTE 8': '#0080C0',
  'ROUTE 9': '#9ACA6A',
  'ROUTE 12': '#008040',
  'ROUTE 16': '#408080',
  'ROUTE 17': '#AEC81E',
  'ROUTE 18': '#B56A6A',
  'ROUTE 19': '#D22506',
  'ROUTE 22': '#FF0000',
  'ROUTE 43': '#0080C0',
  'ROUTE 44': '#0080C0',
  'ROUTE 55': '#00FF00',
  'ROUTE X6': '#00FF00',
  'ROUTE X12': '#4F009D',
  'WEST CONNECTOR': '#00FF00',
  FLYER: '#0000FF',
  // System entry (the CityProfile contract allows `system` keys). The map itself draws each
  // line from the tile's own `color`; this is the backend's fallback colour for a route
  // without route_color, kept here for legends.
  GDRTA: '#0B5394',
};

export const DAYTON_RAILROAD_OWNERS: readonly TaxonomyEntry[] = [
  { key: 'NS', label: 'Norfolk Southern', color: RAILROAD_COLORS.NS },
  { key: 'CSX', label: 'CSX', color: RAILROAD_COLORS.CSX },
  { key: 'MetroParks', label: 'Five Rivers MetroParks', color: '#16a34a' },
  { key: '_other', label: 'Other / unknown', color: '#888888' },
];

export const DAYTON_RAILROAD_OWNERSHIP_TYPES: readonly TaxonomyEntry[] = [
  { key: 'private_class1', label: 'Private — Class I', color: '#ef4444' },
  { key: 'county_owned', label: 'Montgomery County (MetroParks)', color: '#14b8a6' },
  { key: 'unknown', label: 'Unknown Ownership', color: '#6b7280' },
];

/** Category → count in pois.pmtiles (export of 2026-10-02; total 344). */
export const DAYTON_POI_CATEGORY_COUNTS: Readonly<Record<string, number>> = {
  church: 240,
  park: 48,
  gymnasium: 23,
  gallery: 6,
  music_studio: 6,
  theater: 5,
  community_center: 4,
  museum: 4,
  recording_studio: 4,
  dance_studio: 2,
  music_venue: 2,
};
