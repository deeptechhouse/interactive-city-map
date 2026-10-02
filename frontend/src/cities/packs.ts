/**
 * City packs: choosing which cities a build contains.
 *
 * PURPOSE
 *   There is one app for every city. On your server, a build holds all of them and shares
 *   one bundle, one basemap strategy and one backend. On a tablet, a build holds only the
 *   cities you name, so it carries one city's code and data (~120 MB budget per city,
 *   Detroit TDD §9) instead of everything (~235 MB+ today, Chicago alone).
 *
 *   A "city pack" = src/cities/<slug>/ (profile code) + public/data/<slug>/ (PMTiles)
 *                 + src/cities/<slug>/data/ (bundled GeoJSON, dynamic-imported).
 *   Shared assets that every pack may use live in public/data/shared/.
 *
 * FLOW
 *   VITE_CITIES="dayton" (or "chicago,dayton", or unset = all)
 *     → parseEnabledCities() at build time (vite/cityPackPlugin.ts)
 *       → `virtual:city-profiles` imports only those profiles; the registry reads it
 *       → only public/data/<enabled>/ and public/data/shared/ are copied to dist
 *
 * WHY BUILD-TIME AND NOT ONLY RUNTIME: lazy import() keeps unused cities off the wire,
 *   but they would still be on the tablet's disk. Removing them at build time is the only
 *   way to shrink the install.
 *
 * STATUS — SKELETON (2026-10-02). Nothing imports this file yet. Pure functions only (no
 *   fs, no import.meta.env), so the Vite plugin (Node) and the app (browser) can share it.
 *
 * TO ADD A CITY: add its slug to KNOWN_CITY_SLUGS and create src/cities/<slug>/index.ts.
 */
import { notImplemented } from './CityProfile';

/** Every city the codebase knows. Order = CitySelector order. */
export const KNOWN_CITY_SLUGS = ['chicago', 'detroit', 'dayton'] as const;

export type CitySlug = (typeof KNOWN_CITY_SLUGS)[number];

/** Folder under the public/ root that holds assets every pack may use (fonts, sprites). */
export const SHARED_DATA_DIR = 'data/shared/';

/**
 * Parse the VITE_CITIES build variable.
 *   undefined | '' | 'all' → every known city.
 *   'dayton' / 'chicago, dayton' → those cities, in KNOWN_CITY_SLUGS order, de-duplicated.
 *   Any unknown slug → throws. FAIL CLOSED: a typo must break the build instead of shipping
 *   an empty map.
 * O(k + s) time, O(k) space — k = known cities (3); s = length of `raw`.
 */
export function parseEnabledCities(raw: string | undefined, known: readonly string[]): readonly string[] {
  return notImplemented('parseEnabledCities', raw, known);
}

/**
 * Public-root folder that holds one city's static assets, e.g. `data/dayton/`.
 * O(1) time, O(1) space.
 */
export function packDataDir(slug: string): string {
  return notImplemented('packDataDir', slug);
}

/**
 * Should this file under public/ go into a build with these cities?
 *   data/shared/** → always. data/<slug>/** → only if slug is enabled.
 *   data/<file> (legacy flat Chicago files, until Detroit plan P3 moves them) → only if
 *   'chicago' is enabled.
 *   Anything outside data/ (favicon, vite.svg) → always.
 * O(1) time, O(1) space — enabled = Set of slugs (hash lookup).
 */
export function isPathInBuild(publicRelativePath: string, enabled: ReadonlySet<string>): boolean {
  return notImplemented('isPathInBuild', publicRelativePath, enabled);
}
