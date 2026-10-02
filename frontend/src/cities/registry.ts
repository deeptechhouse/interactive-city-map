/**
 * City profile registry — slug → CityProfile.
 *
 * STATUS — SKELETON. Not imported by App/useMapLayers yet. Phase 4 adds
 *   `chicago/index.ts` (a profile that reproduces today's behaviour byte-for-byte, proven
 *   by a snapshot of createDefaultLayers('chicago')) and then swaps the `=== 'chicago'`
 *   branches for `getCityProfile(slug)` calls.
 *
 * FAIL-SAFE: an unknown slug returns null (not Chicago). The old getCityDefaults
 *   silently fell back to Chicago, which is how a mistyped `?city=` showed Chicago data
 *   under another city's name.
 */
import type { CityProfile } from './CityProfile';
import { notImplemented } from './CityProfile';

/**
 * Look up a profile by slug.
 * O(1) time, O(1) space — c = registered cities, looked up by key (hash map).
 */
export function getCityProfile(slug: string): CityProfile | null {
  return notImplemented('getCityProfile', slug);
}

/**
 * All registered profiles, for CitySelector's built-in list.
 * O(c) time, O(c) space — c = registered cities (2 today).
 */
export function listCityProfiles(): readonly CityProfile[] {
  return notImplemented('listCityProfiles');
}
