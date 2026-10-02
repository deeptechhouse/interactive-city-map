/**
 * Detroit legend/filter vocabularies: transit line colours, railroad owners, railroad
 * ownership types, POI category counts.
 *
 * SOURCE: values come from vocab.generated.ts, written from the 2026-10-02 static build by
 *   backend/app/data_import/detroit/frontend_vocab.py. Only the human parts — labels and
 *   legend colours for railroad marks/types — are written here, and the tests check they
 *   cover every key the data contains.
 *
 * KEY SEMANTICS (same as the shared RailroadFilter / utils/railroadTaxonomy.ts):
 *   railroad `owner` = reporting mark written by the backend (static_plan.RAILROAD_OWNER_RULES),
 *   `owner_type` = ownership type, '_other' = every owner not listed (995 untagged OSM ways).
 *
 * TRANSIT: DETROIT_TRANSIT_COLORS maps GTFS line_name → route_color for every line name
 *   that is unambiguous. DDOT and SMART both run "Greenfield", "Grand River", "Jefferson"
 *   and "Southfield" in DIFFERENT colours, so those four are left out on purpose: the shared
 *   TransitLayer falls back to each feature's own `color` (the same GTFS value). All four
 *   feeds publish route_color, so no line uses the grey fallback.
 */
import type { TaxonomyEntry } from '../CityProfile';
import { RAILROAD_COLORS, RAILROAD_DEFAULT_COLOR } from '../../utils/colorSchemes';
import {
  DETROIT_GTFS_LINE_COLORS,
  DETROIT_POI_COUNTS,
} from './vocab.generated';

/** `line_name` → hex colour, from GTFS routes.txt route_color (see header). */
export const DETROIT_TRANSIT_COLORS: Readonly<Record<string, string>> = DETROIT_GTFS_LINE_COLORS;

// Way counts (2026-10-02) in comments so a reviewer can see what each entry covers.
export const DETROIT_RAILROAD_OWNERS: readonly TaxonomyEntry[] = [
  { key: 'CN', label: 'Canadian National', color: RAILROAD_COLORS.CN }, // 459
  { key: 'CP', label: 'CPKC', color: RAILROAD_COLORS.CP }, // 134
  { key: 'CSX', label: 'CSX', color: RAILROAD_COLORS.CSX }, // 258
  { key: 'NS', label: 'Norfolk Southern', color: RAILROAD_COLORS.NS }, // 171
  { key: 'CRSH', label: 'Conrail Shared Assets', color: '#1E3A8A' }, // 917
  { key: 'DC', label: 'Delray / Detroit Connecting', color: '#F97316' }, // 166
  { key: 'ETR', label: 'Essex Terminal', color: '#A16207' }, // 74
  { key: 'AMTK', label: 'Amtrak', color: '#8B5CF6' }, // 42
  { key: 'VIA', label: 'VIA Rail', color: '#FACC15' }, // 55
  { key: 'DPM', label: 'People Mover', color: '#92278F' }, // 7
  { key: 'IND', label: 'Industrial (Ford, US Steel…)', color: '#78716C' }, // 104
  { key: '_other', label: 'Other / untagged', color: RAILROAD_DEFAULT_COLOR }, // 995
];

export const DETROIT_RAILROAD_OWNERSHIP_TYPES: readonly TaxonomyEntry[] = [
  { key: 'government_transit', label: 'Public Transit (People Mover/QLine)', color: '#06b6d4' },
  { key: 'government_passenger', label: 'Amtrak / VIA (passenger)', color: '#8b5cf6' },
  { key: 'private_class1', label: 'Private — Class I', color: '#ef4444' },
  { key: 'private_terminal', label: 'Private — Terminal/Switching', color: '#f97316' },
  { key: 'private_industrial', label: 'Private — Industrial', color: '#78716c' },
  { key: 'unknown', label: 'Unknown Ownership', color: '#6b7280' },
];

/** POI category → count in the static export (shown as filter badges). */
export const DETROIT_POI_CATEGORY_COUNTS: Readonly<Record<string, number>> = DETROIT_POI_COUNTS;
