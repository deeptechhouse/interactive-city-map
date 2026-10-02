/**
 * Where a city's boundary polygons (zip codes, precincts, districts, neighborhoods) come
 * from — the Focus-areas panel needs whole polygons, not tiles.
 *
 *   static mode   → ./data/<city>/<layer>.geojson  (the static build's geojson_copy)
 *   database mode → <api>/api/v1/cities/<city>/boundaries/<layer>
 *                   (backend/app/routes/cities.py, same FeatureCollection shape)
 *
 * WHY (2026-10-02): the Detroit/Dayton focus panels always fetched the static files, which
 * are git-ignored and absent from a checkout that only runs the database — so the panel
 * failed in database mode. Both cities' focus.ts now ask this module for the URL.
 */
import { apiBaseUrl } from '../utils/geoUtils';
import { IS_STATIC } from '../utils/staticMode';

/** Boundary layers the backend serves (BOUNDARY_LAYERS in routes/cities.py). */
export type BoundaryLayer = 'zip_codes' | 'police_precincts' | 'council_districts' | 'neighborhoods';

/** O(1) time, O(1) space — n = 1 URL. `isStatic` is injectable for tests. */
export function boundaryUrl(city: string, layer: BoundaryLayer, isStatic: boolean = IS_STATIC): string {
  return isStatic
    ? `./data/${city}/${layer}.geojson`
    : `${apiBaseUrl()}/api/v1/cities/${encodeURIComponent(city)}/boundaries/${layer}`;
}
