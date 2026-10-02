/**
 * Type for the `virtual:city-profiles` module that vite/cityPackPlugin.ts generates.
 *
 * The plugin emits `export const CITY_PROFILES = [CHICAGO_PROFILE, DAYTON_PROFILE, …]`
 * holding only the cities in VITE_CITIES. registry.ts builds its slug → profile map from
 * this list, so a single-city build never bundles the other profiles.
 *
 * STATUS — SKELETON. Nothing imports the virtual module until plan D7.
 */
declare module 'virtual:city-profiles' {
  import type { CityProfile } from './CityProfile';

  /** Enabled profiles, in KNOWN_CITY_SLUGS order. */
  export const CITY_PROFILES: readonly CityProfile[];
}
