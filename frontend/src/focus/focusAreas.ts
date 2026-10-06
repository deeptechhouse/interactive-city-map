/**
 * The Chicago areas the user can focus on: boundary index + the option lists the panel
 * shows. Built once at module load from the boundary data the map layers already bundle,
 * so no extra download and it works in static mode.
 *
 * TO ADD A KIND (e.g. community areas): add it to FocusKind in focusGeometry.ts, index its
 * boundaries here, and add an option list + label below.
 */
import { STATIC_ZIP_CODES } from '../map/layers/data/static_zip_codes';
import { DISTRICT_BOUNDARIES, DISTRICT_INFO } from '../map/layers/data/policeDistrictsData';
import { WARD_BOUNDARIES, WARD_INFO } from '../map/layers/data/wardsData';
import { indexBoundaries, type BoundaryIndex, type FocusKind } from './focusGeometry';

export interface AreaOption {
  readonly id: string;
  readonly label: string;
}

// O(n) each — n = boundary features (59 zips, 22 districts, 50 wards).
export const CHICAGO_BOUNDARIES: BoundaryIndex = {
  zip: indexBoundaries(STATIC_ZIP_CODES, 'zip_code'),
  police: indexBoundaries(DISTRICT_BOUNDARIES, 'dist_num'),
  ward: indexBoundaries(WARD_BOUNDARIES, 'ward'),
};

/** Numeric-aware sort so "Ward 2" comes before "Ward 10". O(n log n) time, O(n) space — n = boundary ids. */
function sortedIds(index: ReadonlyMap<string, unknown>): string[] {
  return [...index.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

export const AREA_OPTIONS: Record<FocusKind, readonly AreaOption[]> = {
  // sortedIds sorts, then map is linear.
  // O(n log n) time, O(n) space — n = zip boundary ids
  zip: sortedIds(CHICAGO_BOUNDARIES.zip).map((id) => ({ id, label: id })),
  // O(n log n) time, O(n) space — n = police-district boundary ids
  police: sortedIds(CHICAGO_BOUNDARIES.police).map((id) => {
    const info = DISTRICT_INFO[Number(id)];
    return { id, label: info ? `District ${id} — ${info.name}` : `District ${id}` };
  }),
  // O(n log n) time, O(n) space — n = ward boundary ids
  ward: sortedIds(CHICAGO_BOUNDARIES.ward).map((id) => {
    const info = WARD_INFO[Number(id)];
    return { id, label: info ? `Ward ${id} — ${info.alderman}` : `Ward ${id}` };
  }),
};

export const KIND_LABELS: Record<FocusKind, string> = {
  zip: 'Zip codes',
  police: 'Police districts',
  ward: 'City wards',
};
