/**
 * City profile registry — slug → CityProfile. The one place shared code asks "which city?".
 *
 * FAIL-SAFE: an unknown slug returns null, never Chicago. The old getCityDefaults silently
 *   fell back to Chicago, which is how a mistyped `?city=` showed Chicago data under
 *   another city's name.
 *
 * ORDER: CITY_PROFILES order is CitySelector order.
 *
 * NEXT (combined plan W7): read the generated `virtual:city-profiles` module instead of
 *   these static imports, so a VITE_CITIES=dayton build bundles only Dayton. The default
 *   build (all cities) must stay identical to this list.
 */
import type { CityProfile } from './CityProfile';
import { CHICAGO_PROFILE } from './chicago';
import { DETROIT_PROFILE } from './detroit';
import { DAYTON_PROFILE } from './dayton';

const CITY_PROFILES: readonly CityProfile[] = [CHICAGO_PROFILE, DETROIT_PROFILE, DAYTON_PROFILE];

// O(c) time, O(c) space — c = registered cities (3)
const BY_SLUG: ReadonlyMap<string, CityProfile> = new Map(CITY_PROFILES.map((p) => [p.slug, p]));

/**
 * Look up a profile by slug (case-sensitive, as used in `?city=`).
 * O(1) time, O(1) space — c = registered cities, looked up by key (hash map).
 */
export function getCityProfile(slug: string): CityProfile | null {
  return BY_SLUG.get(slug) ?? null;
}

/**
 * All registered profiles, for CitySelector's built-in list.
 * O(1) time, O(1) space — c = registered cities (the frozen array itself is returned).
 */
export function listCityProfiles(): readonly CityProfile[] {
  return CITY_PROFILES;
}
