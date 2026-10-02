/**
 * Detroit-specific MapLibre layer adders (the ones that cannot reuse a shared layer file).
 *
 * WHY SEPARATE FILES ARE NOT NEEDED FOR THE REST: buildings, zoning, railroads, transit,
 *   waterways, pois, zip_codes, major_streets reuse the shared add*Layer functions with
 *   Detroit source URLs; only their colour/filter vocabularies differ (taxonomies.ts).
 *
 * STATUS — SKELETON.
 */
import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { notImplemented } from '../CityProfile';

/**
 * Parks from the dedicated `parks` source-layer. Shared ParkLayer hard-codes
 * `'source-layer': 'parcels'`, which for Detroit would paint every parcel green.
 * O(1) time, O(1) space — n = 1 source + 3 style layers.
 */
export function addDetroitParkLayer(map: maplibregl.Map, config: LayerConfig): void {
  notImplemented('addDetroitParkLayer', map, config);
}

/**
 * DPD precinct outlines + labels (replaces the embedded CPD police_districts layer).
 * O(1) time, O(1) space — n = 1 source + 2 style layers.
 */
export function addPolicePrecinctLayer(map: maplibregl.Map, config: LayerConfig): void {
  notImplemented('addPolicePrecinctLayer', map, config);
}

/**
 * Removes every style layer + source this city added — called on city switch.
 * Fixes the audit bug where Chicago-only layers stayed on the map after switching.
 * O(k) time, O(1) space — k = style layers owned by the city.
 */
export function removeCityLayers(map: maplibregl.Map, layerIds: readonly string[]): void {
  notImplemented('removeCityLayers', map, layerIds);
}
