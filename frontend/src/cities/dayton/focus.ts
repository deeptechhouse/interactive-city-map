/**
 * Dayton focus areas: zip codes, Dayton PD areas, neighborhoods.
 *
 * DESIGN DECISION (TDD §5.4), the same approach Detroit takes: reuse the three existing
 *   FocusKind slots instead of widening the union type:
 *     'zip'    → Dayton ZCTAs (Census TIGER, 453xx/454xx, clipped to the city limit)
 *     'police' → Dayton PD areas (count unproven: the fork's import log says 4)
 *     'ward'   → Neighborhoods (97). Dayton has no wards or council districts, because the City
 *                Commission is at-large. kindLabels names this slot "Neighborhoods", so
 *                the user never sees the word "ward".
 *   This leaves focusGeometry.ts (pure, tested, shared with Chicago) untouched.
 *
 * DATA: boundaries come from bundled GeoJSON that backend/scripts/export_city_static.py
 *   writes into src/cities/dayton/data/. It is loaded lazily with dynamic import(), so
 *   Chicago or Detroit users never download Dayton polygons, and a single-city build of another
 *   city never contains them.
 *
 * STATUS — SKELETON.
 */
import type { BoundaryIndex, FocusKind } from '../../focus/focusGeometry';
import type { AreaOption } from '../../focus/focusAreas';
import type { FocusConfig } from '../CityProfile';
import { notImplemented } from '../CityProfile';

export const DAYTON_KIND_LABELS: Readonly<Record<FocusKind, string>> = {
  zip: 'Zip codes',
  police: 'Police areas',
  ward: 'Neighborhoods',
};

/**
 * Dynamic-import the generated boundary files and index them with indexBoundaries.
 * O(n) time, O(n) space — n = boundary features (~20 zips + ~4 areas + 97 neighborhoods).
 */
export async function loadDaytonBoundaries(): Promise<BoundaryIndex> {
  return notImplemented('loadDaytonBoundaries');
}

/**
 * Option lists for the panel, sorted numeric-aware ("Area 2" before "Area 10").
 * O(n log n) time, O(n) space — n = boundary features (a comparison sort is the floor).
 */
export function daytonAreaOptions(index: BoundaryIndex): Record<FocusKind, readonly AreaOption[]> {
  return notImplemented('daytonAreaOptions', index);
}

export const DAYTON_FOCUS: FocusConfig = {
  loadBoundaries: loadDaytonBoundaries,
  optionsFor: daytonAreaOptions,
  kindLabels: DAYTON_KIND_LABELS,
};
