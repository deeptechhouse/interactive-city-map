/**
 * Railroad legend vocabularies (owners, ownership types) — Chicago's lists.
 *
 * Moved out of RailroadFilter.tsx (2026-10-02) so the Chicago CityProfile can expose them
 * without importing a component. RailroadFilter still uses exactly these lists, so
 * Chicago's filter is unchanged. Other cities' lists live in src/cities/<slug>/taxonomies.ts.
 *
 * Keys must match what the railroad importer writes: `owner` (reporting mark) and
 * `ownership_type`. '_other' collects every owner not listed.
 */
import type { TaxonomyEntry } from '../cities/CityProfile';
import { RAILROAD_COLORS } from './colorSchemes';

export const CHICAGO_RAILROAD_OWNERS: readonly TaxonomyEntry[] = [
  { key: 'BNSF', label: 'BNSF', color: RAILROAD_COLORS.BNSF },
  { key: 'CP', label: 'CP/CPKC', color: RAILROAD_COLORS.CP },
  { key: 'NS', label: 'Norfolk Southern', color: RAILROAD_COLORS.NS },
  { key: 'CSX', label: 'CSX', color: RAILROAD_COLORS.CSX },
  { key: 'CN', label: 'Canadian National', color: RAILROAD_COLORS.CN },
  { key: 'CTA', label: 'CTA', color: RAILROAD_COLORS.CTA },
  { key: '_other', label: 'Other', color: '#888888' },
];

export const CHICAGO_OWNERSHIP_TYPES: readonly TaxonomyEntry[] = [
  { key: 'government_transit', label: 'Public Transit (CTA/Metra/NICTD)', color: '#06b6d4' },
  { key: 'government_passenger', label: 'Amtrak (Federal)', color: '#8b5cf6' },
  { key: 'city_owned', label: 'City of Chicago', color: '#ec4899' },
  { key: 'county_owned', label: 'Cook County', color: '#14b8a6' },
  { key: 'private_class1', label: 'Private — Class I', color: '#ef4444' },
  { key: 'private_terminal', label: 'Private — Terminal/Switching', color: '#f97316' },
  { key: 'private_shortline', label: 'Private — Short Line', color: '#eab308' },
  { key: 'private_industrial', label: 'Private — Industrial', color: '#78716c' },
  { key: 'unknown', label: 'Unknown Ownership', color: '#6b7280' },
];
