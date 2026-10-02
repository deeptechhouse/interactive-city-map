/**
 * Dayton focus areas: zip codes, Dayton PD areas, neighborhoods.
 *
 * DESIGN DECISION (TDD §5.4), same as Detroit: reuse the three existing FocusKind slots
 *   instead of widening the union type:
 *     'zip'    → Dayton ZCTAs (2020 Census, 453xx/454xx, kept where they overlap the city:
 *                16 on 2026-10-02)
 *     'police' → Dayton PD areas (4: Central, East, West, Airport)
 *     'ward'   → Neighborhoods (66 in-city). Dayton has no wards or council districts —
 *                the City Commission is at-large — so kindLabels names this slot
 *                "Neighborhoods" and the user never sees the word "ward".
 *   focusGeometry.ts (pure, tested, shared with Chicago) stays untouched.
 *
 * DATA: real polygons (not tiles). boundarySource.ts picks the URL — the static exporter's
 *   public/data/dayton/{zip_codes,police_precincts,neighborhoods}.geojson in static mode,
 *   the backend's /cities/dayton/boundaries/<layer> in database mode. They are fetched
 *   lazily on first use, so other cities' users never download them. The id
 *   properties are zip_code / precinct / name (backend static_plan keep tuples).
 */
import { indexBoundaries, type BoundaryIndex, type FocusKind } from '../../focus/focusGeometry';
import type { AreaOption } from '../../focus/focusAreas';
import type { FocusConfig } from '../CityProfile';
import { boundaryUrl } from '../boundarySource';

export const DAYTON_KIND_LABELS: Readonly<Record<FocusKind, string>> = {
  zip: 'Zip codes',
  police: 'Police areas',
  ward: 'Neighborhoods',
};

/** Boundary source URL (static file or backend — see boundarySource.ts) + id property per focus kind. */
export const DAYTON_BOUNDARY_FILES: Readonly<Record<FocusKind, { url: string; idProp: string }>> = {
  zip: { url: boundaryUrl('dayton', 'zip_codes'), idProp: 'zip_code' },
  police: { url: boundaryUrl('dayton', 'police_precincts'), idProp: 'precinct' },
  ward: { url: boundaryUrl('dayton', 'neighborhoods'), idProp: 'name' },
};

/** Loads one GeoJSON file — injectable so tests never touch the network. */
export type FetchGeoJson = (url: string) => Promise<GeoJSON.FeatureCollection>;

/** O(f) time, O(f) space — f = bytes of the file (browser fetch + JSON parse). */
const defaultFetchGeoJson: FetchGeoJson = async (url) => {
  const resp = await fetch(url);
  if (!resp.ok) throw new Error(`HTTP ${resp.status} loading ${url}`);
  return (await resp.json()) as GeoJSON.FeatureCollection;
};

/**
 * Fetch the three boundary files in parallel and index them by their id property.
 * O(n) time, O(n) space — n = boundary features (16 zips + 4 areas + 66 neighborhoods).
 */
export async function loadDaytonBoundaries(fetchGeoJson: FetchGeoJson = defaultFetchGeoJson): Promise<BoundaryIndex> {
  const [zip, police, ward] = await Promise.all([
    fetchGeoJson(DAYTON_BOUNDARY_FILES.zip.url),
    fetchGeoJson(DAYTON_BOUNDARY_FILES.police.url),
    fetchGeoJson(DAYTON_BOUNDARY_FILES.ward.url),
  ]);
  return {
    zip: indexBoundaries(zip, DAYTON_BOUNDARY_FILES.zip.idProp),
    police: indexBoundaries(police, DAYTON_BOUNDARY_FILES.police.idProp),
    ward: indexBoundaries(ward, DAYTON_BOUNDARY_FILES.ward.idProp),
  };
}

/** Numeric-aware id sort ("45402" < "45410"; "Area 2" < "Area 10"). O(n log n) time, O(n) space — n = ids. */
function sortedIds(index: ReadonlyMap<string, unknown>): string[] {
  // O(n log n) time, O(n) space — n = ids (comparison sort)
  return [...index.keys()].sort((a, b) => a.localeCompare(b, undefined, { numeric: true }));
}

/**
 * Option lists for the panel, sorted numeric-aware. Police areas show their full name
 * ("Central District"); zips and neighborhoods are their own labels.
 * O(n log n) time, O(n) space — n = boundary features (a comparison sort is the floor).
 */
export function daytonAreaOptions(index: BoundaryIndex): Record<FocusKind, readonly AreaOption[]> {
  /** O(1) time, O(1) space — n = one lookup of the first feature's `name`. */
  const policeLabel = (id: string): string => {
    const name = index.police.get(id)?.[0]?.properties?.name;
    return typeof name === 'string' && name.trim() ? name.trim() : id;
  };
  return {
    // O(n log n) time, O(n) space — n = zips
    zip: sortedIds(index.zip).map((id) => ({ id, label: id })),
    // O(n log n) time, O(n) space — n = police areas
    police: sortedIds(index.police).map((id) => ({ id, label: policeLabel(id) })),
    // O(n log n) time, O(n) space — n = neighborhoods
    ward: sortedIds(index.ward).map((id) => ({ id, label: id })),
  };
}

export const DAYTON_FOCUS: FocusConfig = {
  // O(n) time, O(n) space — n = boundary features (default network loader)
  loadBoundaries: () => loadDaytonBoundaries(),
  optionsFor: daytonAreaOptions,
  kindLabels: DAYTON_KIND_LABELS,
};
