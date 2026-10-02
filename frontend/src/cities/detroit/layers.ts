/**
 * Detroit layer list + tile sources.
 *
 * PURPOSE
 *   Decides which layers Detroit offers and, per layer, where its data comes from in dev
 *   mode (Martin over PostGIS) and static mode (PMTiles under public/data/detroit/, written
 *   by backend/scripts/export_city_static.py from app/data_import/detroit/static_plan.py).
 *
 * TRAPS
 *   - Parks: Chicago's ParkLayer paints the whole `parcels` source-layer green, because
 *     Chicago's parcels table only holds parks. Detroit's parcels are ~378K real parcels,
 *     so Detroit parks come from the dedicated `parks` table / tile layer — the profile
 *     sets sourceLayers.parks = 'parks', and the dev source is martinTileUrl('parks').
 *   - Police: the shared `police_districts` layer is embedded Chicago CPD GeoJSON. Detroit
 *     offers `police_precincts` (DPD, 12) instead; `wards` → `council_districts` (7, 2026).
 *   - Static mode: a layer with no static asset is LEFT OUT of the list, never given '' —
 *     MapContainer adds a broken vector source for ''.
 *   - Blight tiles are named `blight_violations` (the PostGIS table) but the layer id is
 *     `abandoned_blight`; the file is abandoned_blight.pmtiles.
 *
 * NOT OFFERED (no Detroit dataset yet): sanborn, railroad_row, federal_properties,
 *   gang_territory.
 *
 * TO ADD A LAYER: add a StaticLayer in the backend static plan, rebuild, then add a row to
 *   DETROIT_LAYERS, its id to DETROIT_STATIC_LAYER_IDS and its table to DEV_TABLES.
 */
import type { LayerState } from '../../types/layer';
import { martinTileUrl } from '../../utils/geoUtils';

/** Layer rows in LayerPanel order, grouped like Chicago's list. */
const DETROIT_LAYERS: readonly LayerState[] = [
  // Infrastructure
  { id: 'railroads', name: 'Railroads', group: 'infrastructure', visible: true, opacity: 1 },
  { id: 'transit', name: 'Transit (DDOT/SMART/QLine/PM)', group: 'infrastructure', visible: true, opacity: 1 },
  { id: 'waterways', name: 'Waterways', group: 'infrastructure', visible: true, opacity: 1 },
  // Zoning & ownership
  { id: 'zoning', name: 'Zoning Districts', group: 'zoning', visible: false, opacity: 1 },
  { id: 'buildings', name: 'Buildings', group: 'zoning', visible: true, opacity: 1 },
  // Points of interest
  { id: 'pois', name: 'Points of Interest', group: 'poi', visible: true, opacity: 1 },
  // Streets + boundaries
  { id: 'major_streets', name: 'Major Street Labels', group: 'infrastructure', visible: true, opacity: 1 },
  { id: 'zip_codes', name: 'Zip Codes', group: 'zoning', visible: false, opacity: 1 },
  // Parks
  { id: 'parks', name: 'Parks & Green Space', group: 'parks', visible: true, opacity: 1 },
  // Government
  { id: 'police_precincts', name: 'Police Precincts (DPD)', group: 'government', visible: false, opacity: 1 },
  { id: 'council_districts', name: 'Council Districts', group: 'government', visible: false, opacity: 1 },
  { id: 'neighborhoods', name: 'Neighborhoods', group: 'government', visible: false, opacity: 1 },
  { id: 'dlba_properties', name: 'DLBA Land Bank', group: 'government', visible: false, opacity: 1 },
  // Safety
  { id: 'abandoned_blight', name: 'Blight Tickets (2021+)', group: 'safety', visible: false, opacity: 1 },
];

/** Every layer id Detroit offers, in LayerPanel order. */
// O(l) time, O(l) space — l = Detroit layers (14)
export const DETROIT_LAYER_IDS: readonly string[] = DETROIT_LAYERS.map((l) => l.id);

/**
 * Layer ids with a file under public/data/detroit/ (static export of 2026-10-02 — every
 * layer in the backend STATIC_PLAN was produced). Remove an id here if its file is
 * deleted, or static mode will request a missing archive.
 */
export const DETROIT_STATIC_LAYER_IDS: ReadonlySet<string> = new Set([
  'railroads',
  'transit',
  'waterways',
  'zoning',
  'buildings',
  'pois',
  'major_streets',
  'zip_codes',
  'parks',
  'police_precincts',
  'council_districts',
  'neighborhoods',
  'dlba_properties',
  'abandoned_blight',
]);

/** Layer id → PostGIS table Martin serves in dev mode. */
const DEV_TABLES: Readonly<Record<string, string>> = {
  railroads: 'railroads',
  transit: 'transit_lines',
  waterways: 'waterways',
  zoning: 'zoning_districts',
  // Martin FUNCTION source with level of detail (migration 006): the raw table sent every
  // footprint at every zoom — 30 s+ tiles. Its MVT layer is still named 'buildings'.
  buildings: 'buildings_lod',
  pois: 'pois',
  major_streets: 'major_streets',
  zip_codes: 'zip_codes',
  parks: 'parks', // NOT 'parcels' — see TRAPS
  police_precincts: 'police_precincts',
  council_districts: 'council_districts',
  neighborhoods: 'neighborhoods',
  dlba_properties: 'dlba_properties',
  abandoned_blight: 'blight_violations',
};

/**
 * Ordered layer states for the LayerPanel. `isStatic` drops layers with no static asset.
 * Returns fresh objects so callers may mutate their copy.
 * O(l) time, O(l) space — l = Detroit layers (14).
 */
export function detroitLayerStates(isStatic: boolean): LayerState[] {
  return DETROIT_LAYERS
    // O(l) time, O(l) space — l = layers
    .filter((l) => !isStatic || DETROIT_STATIC_LAYER_IDS.has(l.id))
    // O(l) time, O(l) space — l = layers kept
    .map((l) => ({ ...l }));
}

/**
 * Dev-mode Martin URLs by layer id. `parks` → martinTileUrl('parks') (NOT 'parcels').
 * O(l) time, O(l) space — l = Detroit layers.
 */
export function detroitDevSources(): Record<string, string> {
  const out: Record<string, string> = {};
  // O(l) time, O(l) space — l = layers with a dev table
  for (const [id, table] of Object.entries(DEV_TABLES)) out[id] = martinTileUrl(table);
  return out;
}

/**
 * Static-mode PMTiles URLs by layer id, all under `./data/detroit/`. Only produced files.
 * O(l) time, O(l) space — l = Detroit layers.
 */
export function detroitStaticSources(): Record<string, string> {
  const out: Record<string, string> = {};
  // O(l) time, O(l) space — l = layers with a static file
  for (const id of DETROIT_STATIC_LAYER_IDS) out[id] = `pmtiles://./data/detroit/${id}.pmtiles`;
  return out;
}
