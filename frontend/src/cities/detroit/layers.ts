/**
 * Detroit layer list + tile sources.
 *
 * PURPOSE
 *   Replaces the `citySlug === 'detroit'` branch of useMapLayers.createDefaultLayers and
 *   decides, per layer, where Detroit's data comes from in dev mode (Martin) and static
 *   mode (per-city PMTiles under public/data/detroit/ or bundled GeoJSON).
 *
 * STATUS — SKELETON. Bodies are stubs.
 *
 * TRAPS
 *   - Parks: Chicago's ParkLayer paints the *whole* `parcels` source-layer green, because
 *     Chicago's parcels table only holds parks. Detroit's parcels table will hold ~378K
 *     real parcels, so Detroit parks MUST come from the dedicated `parks` table
 *     (migration 005) via DetroitParkLayer — never from `parcels`.
 *   - Police districts: the shared list offers `police_districts`, which is embedded CPD
 *     (Chicago) GeoJSON. Detroit must offer `police_precincts` (DPD, 12 precincts)
 *     instead, or Chicago polygons are drawn off-screen under a Detroit label.
 *   - Static mode: a layer with no static asset must be *left out* of the list, not given
 *     '' — MapContainer adds a broken vector source for '' (MapContainer.tsx:196).
 *
 * LAYER PARITY TARGET (Chicago → Detroit):
 *   railroads, transit, waterways, zoning, buildings, pois, major_streets, zip_codes,
 *   parks                         → same ids, Detroit data
 *   police_districts              → police_precincts (DPD)
 *   wards                         → council_districts (7 districts, 2026 map)
 *   railroad_row                  → railroad_row (derived from Detroit parcels owned by
 *                                   railroads — see import_railroad_row in the backend)
 *   sanborn                       → sanborn (Detroit LoC sheets, Phase 7)
 *   gang_territory                → NOT OFFERED — no official public dataset for Detroit
 *   federal_properties            → federal_properties (GSA inventory, optional Phase 8)
 *   Detroit-only: neighborhoods, dlba_properties, abandoned_blight
 */
import type { LayerState } from '../../types/layer';
import { notImplemented } from '../CityProfile';

/**
 * Ordered layer states for the LayerPanel. `isStatic` drops layers with no static asset.
 * O(l) time, O(l) space — l = Detroit layers (~19).
 */
export function detroitLayerStates(isStatic: boolean): LayerState[] {
  return notImplemented('detroitLayerStates', isStatic);
}

/**
 * Dev-mode Martin URLs by layer id. `parks` → martinTileUrl('parks') (NOT 'parcels').
 * O(l) time, O(l) space — l = Detroit layers.
 */
export function detroitDevSources(): Record<string, string> {
  return notImplemented('detroitDevSources');
}

/**
 * Static-mode PMTiles URLs by layer id, all under `./data/detroit/`.
 * O(l) time, O(l) space — l = Detroit layers.
 */
export function detroitStaticSources(): Record<string, string> {
  return notImplemented('detroitStaticSources');
}
