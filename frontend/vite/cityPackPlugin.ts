/**
 * Vite plugin that builds one app with only the chosen cities.
 *
 * PURPOSE
 *   Turns VITE_CITIES into two effects:
 *     1. `virtual:city-profiles`: a generated module importing only the enabled
 *        src/cities/<slug>/index.ts profiles. Disabled cities are never in the bundle.
 *     2. Filtered public copy: Vite normally copies all of public/ into dist. The plugin
 *        turns that off for builds (`publicDir: false` via the config hook) and copies
 *        only the paths that src/cities/packs.ts isPathInBuild() accepts.
 *   Dev server (`vite`): it serves all of public/ unfiltered, so switching cities works locally.
 *
 * FLOW
 *   vite.config.ts: plugins: [react(), cityPackPlugin({ cities: process.env.VITE_CITIES })]
 *     config()      → resolve enabled slugs (fail on unknown) and disable publicDir for build
 *     resolveId()   → claim 'virtual:city-profiles'
 *     load()        → emit the import list
 *     writeBundle() → copy filtered public/ and print a per-city size report
 *
 * STATUS — SKELETON (2026-10-02). It is not registered in vite.config.ts, which is a plan
 *   D7 change. This file is outside tsconfig.node.json's `include`. Add it there when wiring
 *   it up, so `tsc -b` checks it.
 *
 * WHY A PLUGIN AND NOT SEPARATE ENTRY FILES PER CITY: one config and one code path. A
 *   per-city entry (main.dayton.tsx) duplicates the bootstrapping for every city.
 */
import type { Plugin } from 'vite';

export interface CityPackOptions {
  /** Raw VITE_CITIES value: undefined / '' / 'all' = every city. */
  readonly cities: string | undefined;
  /** Absolute path of frontend/public (default: Vite's resolved publicDir). */
  readonly publicDir?: string;
}

export const VIRTUAL_ID = 'virtual:city-profiles';

/**
 * Factory for the plugin.
 * O(1) time, O(1) space — n = 1 plugin object (hook costs noted on each helper).
 */
export function cityPackPlugin(options: CityPackOptions): Plugin {
  throw new Error(`[skeleton] cityPackPlugin(${JSON.stringify(options)}) is not implemented — see docs/dayton_parity/`);
}

/**
 * Source text of `virtual:city-profiles` for the enabled slugs.
 * O(c) time, O(c) space — c = enabled cities.
 */
export function renderProfilesModule(enabled: readonly string[]): string {
  throw new Error(`[skeleton] renderProfilesModule(${enabled.length}) is not implemented`);
}
