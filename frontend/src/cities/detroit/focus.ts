/**
 * Detroit focus areas — zip codes, DPD precincts, council districts.
 *
 * DESIGN DECISION (TDD §5.4): Detroit reuses the three existing FocusKind slots instead of
 *   widening the union type:
 *     'zip'    → Detroit ZCTAs (Census TIGER, kept where ≥ 1% lies in the city — 33)
 *     'police' → DPD precincts (12)
 *     'ward'   → City Council districts (7, effective 2026-01-01) — labelled "Council
 *                districts" via kindLabels, so the user never sees the word "ward".
 *   focusGeometry.ts (pure, tested, shared with Chicago) stays untouched.
 *
 * DATA: boundarySource.ts picks the URL — public/data/detroit/<layer>.geojson in static
 *   mode (the static build's geojson_copy), the backend's /cities/detroit/boundaries/<layer>
 *   in database mode. Fetched lazily, only when Detroit is selected, so Chicago users never
 *   download Detroit polygons. Property keys: zip_code / precinct / district_number (strings).
 *
 * FAILURE MODE: if a file is missing the promise rejects; the shared focus hook reports
 *   it. Nothing here falls back to another city's boundaries.
 */
import { indexBoundaries, type BoundaryIndex, type FocusKind } from '../../focus/focusGeometry';
import type { AreaOption } from '../../focus/focusAreas';
import type { FocusConfig } from '../CityProfile';
import { boundaryUrl } from '../boundarySource';

export const DETROIT_KIND_LABELS: Readonly<Record<FocusKind, string>> = {
  zip: 'Zip codes',
  police: 'Police precincts',
  ward: 'Council districts',
};

/** Fetch function signature — injectable so tests never touch the network. */
export type FetchGeoJson = (url: string) => Promise<GeoJSON.FeatureCollection>;

/**
 * Browser fetch of one FeatureCollection.
 * O(b) time, O(b) space — b = bytes of the file.
 */
const defaultFetchGeoJson: FetchGeoJson = async (url) => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
  return (await resp.json()) as GeoJSON.FeatureCollection;
};

/**
 * Fetch the three boundary files in parallel and index them by area id.
 * O(n) time, O(n) space — n = boundary features (33 zips + 12 precincts + 7 districts).
 */
export async function loadDetroitBoundaries(
  fetchGeoJson: FetchGeoJson = defaultFetchGeoJson,
): Promise<BoundaryIndex> {
  const [zips, precincts, districts] = await Promise.all([
    fetchGeoJson(boundaryUrl('detroit', 'zip_codes')),
    fetchGeoJson(boundaryUrl('detroit', 'police_precincts')),
    fetchGeoJson(boundaryUrl('detroit', 'council_districts')),
  ]);
  return {
    zip: indexBoundaries(zips, 'zip_code'),
    police: indexBoundaries(precincts, 'precinct'),
    ward: indexBoundaries(districts, 'district_number'),
  };
}

/** Numeric-aware sort so "Precinct 2" comes before "Precinct 10". O(n log n) time, O(n) space — n = ids. */
function sortedIds(index: ReadonlyMap<string, unknown>): string[] {
  // O(n log n) time, O(n) space — n = ids (comparison sort)
  return [...index.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Option lists for the panel, numeric-aware sorted ("Precinct 2" before "Precinct 10").
 * O(n log n) time, O(n) space — n = boundary features (comparison sort is the floor).
 */
export function detroitAreaOptions(index: BoundaryIndex): Record<FocusKind, readonly AreaOption[]> {
  return {
    // O(n) time, O(n) space — n = zips
    zip: sortedIds(index.zip).map((id) => ({ id, label: id })),
    // O(n) time, O(n) space — n = precincts
    police: sortedIds(index.police).map((id) => ({ id, label: `Precinct ${id}` })),
    // O(n) time, O(n) space — n = districts
    ward: sortedIds(index.ward).map((id) => ({ id, label: `District ${id}` })),
  };
}

export const DETROIT_FOCUS: FocusConfig = {
  loadBoundaries: () => loadDetroitBoundaries(),
  optionsFor: detroitAreaOptions,
  kindLabels: DETROIT_KIND_LABELS,
};
