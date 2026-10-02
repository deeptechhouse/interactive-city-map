/**
 * Dayton layer list + tile sources.
 *
 * PURPOSE
 *   Decides which layers Dayton offers and, per layer, where the data comes from in dev
 *   mode (Martin over PostGIS) and static mode (PMTiles under public/data/dayton/, or
 *   GeoJSON bundled from src/cities/dayton/data/ by the static exporter).
 *
 * STATUS — SKELETON. Bodies are stubs.
 *
 * TRAPS (from the 2026-10-02 audit of the Dayton fork)
 *   - Parks: the fork's ParkLayer read the whole `parcels` source-layer unfiltered. With
 *     ~272K Montgomery County parcels loaded, that paints the county green. Dayton parks
 *     MUST come from the dedicated `parks` table (draft migration 005).
 *   - Neighborhoods: the fork wrote Dayton's 97 neighborhoods into a table called `wards`
 *     via raw CREATE TABLE in the importer. Dayton has no wards (its City Commission is
 *     elected at-large). Use the `neighborhoods` table (migration 003) and the layer id
 *     `neighborhoods`, never `wards`, or Chicago's ward styling and focus label leak in.
 *   - Police: Dayton PD's areas go in the generic `police_precincts` table (migration 005)
 *     with layer id `police_precincts`. The shared `police_districts` layer is embedded
 *     Chicago CPD GeoJSON. The fork's import log says 4 areas while its comment says 7.
 *     Trust a COUNT(*) after import, not either note.
 *   - Federal properties: the fork still shipped Chicago's 117-site GSA list under a
 *     Dayton label. Offer `federal_properties` only once a Dayton list exists (plan D8).
 *   - Static mode: leave out any layer with no static asset. Do not give it ''. MapContainer
 *     adds a broken vector source for '' (MapContainer.tsx:196).
 *
 * LAYER PARITY TARGET (Chicago → Dayton):
 *   buildings, parcels-backed popups, zoning, railroads, transit (GDRTA GTFS), waterways,
 *   pois, major_streets, zip_codes, parks         → same ids, Dayton data
 *   police_districts   → police_precincts (DPD areas)
 *   wards              → neighborhoods (97, City of Dayton MapLayers_Citywide/310)
 *   railroad_row       → railroad_row (port of the fork's generate_railroad_row.py)
 *   sanborn            → sanborn (LoC Dayton sheets, plan D8)
 *   federal_properties → optional, plan D8
 *   gang_territory     → NOT OFFERED (no official public dataset)
 */
import type { LayerState } from '../../types/layer';
import { notImplemented } from '../CityProfile';

/** Layer ids Dayton offers, in LayerPanel order. Single source for the three maps below. */
export const DAYTON_LAYER_IDS = [
  'buildings',
  'zoning',
  'railroads',
  'railroad_row',
  'transit',
  'waterways',
  'parks',
  'pois',
  'major_streets',
  'zip_codes',
  'police_precincts',
  'neighborhoods',
] as const;

export type DaytonLayerId = (typeof DAYTON_LAYER_IDS)[number];

/**
 * Ordered layer states for the LayerPanel. `isStatic` drops layers with no static asset.
 * O(l) time, O(l) space — l = Dayton layers (12).
 */
export function daytonLayerStates(isStatic: boolean): LayerState[] {
  return notImplemented('daytonLayerStates', isStatic);
}

/**
 * Dev-mode Martin URLs by layer id. `parks` → martinTileUrl('parks') (NOT 'parcels');
 * `neighborhoods` → martinTileUrl('neighborhoods') (NOT 'wards').
 * O(l) time, O(l) space — l = Dayton layers.
 */
export function daytonDevSources(): Record<string, string> {
  return notImplemented('daytonDevSources');
}

/**
 * Static-mode PMTiles URLs by layer id, all under `./data/dayton/`.
 * O(l) time, O(l) space — l = Dayton layers.
 */
export function daytonStaticSources(): Record<string, string> {
  return notImplemented('daytonStaticSources');
}
