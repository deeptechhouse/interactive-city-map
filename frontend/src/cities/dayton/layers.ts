/**
 * Dayton layer list + tile sources.
 *
 * PURPOSE
 *   Decides which layers Dayton offers and, per layer, where the data comes from in dev
 *   mode (Martin over PostGIS) and static mode (PMTiles under public/data/dayton/, written
 *   by backend/scripts/export_city_static.py from app/data_import/dayton/static_plan.py).
 *
 * TRAPS (from the 2026-10-02 audit of the Dayton fork)
 *   - Parks: the fork's ParkLayer read the whole `parcels` source-layer unfiltered. With
 *     ~273K Montgomery County parcels that paints the county green. Dayton parks come from
 *     the dedicated `parks` table / tile layer (profile sourceLayers.parks = 'parks').
 *   - Neighborhoods: the fork wrote Dayton's neighborhoods into a table called `wards`.
 *     Dayton has no wards (its City Commission is elected at-large). The layer id is
 *     `neighborhoods`, never `wards`, or Chicago's ward styling and focus label leak in.
 *   - Police: Dayton PD's 4 areas use the generic `police_precincts` id (shared
 *     BoundaryLayer). The shared `police_districts` layer is embedded Chicago CPD GeoJSON.
 *   - Federal properties / gang territory / railroad_row / sanborn: not offered — no Dayton
 *     dataset yet (federal_properties in the fork was Chicago's GSA list under a Dayton
 *     label).
 *   - Static mode: leave out any layer with no static asset. Never give it '' —
 *     MapContainer would add a broken vector source.
 *
 * TO ADD A LAYER: add a StaticLayer in the backend static plan, rebuild, then add one row
 *   to DAYTON_LAYERS and its id to DAYTON_STATIC_LAYER_IDS (and DEV_TABLES if it has one).
 */
import type { LayerState } from '../../types/layer';
import { martinTileUrl } from '../../utils/geoUtils';

/** Layer rows in LayerPanel order, grouped like Chicago's list (map/hooks/useMapLayers.ts). */
const DAYTON_LAYERS: readonly LayerState[] = [
  // Infrastructure
  { id: 'railroads', name: 'Railroads', group: 'infrastructure', visible: true, opacity: 1 },
  { id: 'transit', name: 'RTA Transit (GDRTA)', group: 'infrastructure', visible: true, opacity: 1 },
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
  { id: 'police_precincts', name: 'Police Areas (DPD)', group: 'government', visible: false, opacity: 1 },
  { id: 'neighborhoods', name: 'Neighborhoods', group: 'government', visible: false, opacity: 1 },
];

/** Every layer id Dayton offers, in LayerPanel order. */
// O(l) time, O(l) space — l = Dayton layers (11)
export const DAYTON_LAYER_IDS: readonly string[] = DAYTON_LAYERS.map((l) => l.id);

/**
 * Layer ids with a file under public/data/dayton/ (static export of 2026-10-02 — every
 * layer in the backend STATIC_PLAN was produced). Remove an id here if its file is
 * deleted, or static mode will request a missing archive.
 */
export const DAYTON_STATIC_LAYER_IDS: ReadonlySet<string> = new Set([
  'railroads', 'transit', 'waterways', 'zoning', 'buildings', 'pois',
  'major_streets', 'zip_codes', 'parks', 'police_precincts', 'neighborhoods',
]);

/** Layer id → PostGIS table Martin serves (tile-layer names match in both modes). */
const DEV_TABLES: Readonly<Record<string, string>> = {
  railroads: 'railroads',
  transit: 'transit_lines',
  waterways: 'waterways',
  zoning: 'zoning_districts',
  buildings: 'buildings',
  pois: 'pois',
  major_streets: 'major_streets',
  zip_codes: 'zip_codes',
  parks: 'parks', // NOT 'parcels' — see TRAPS
  police_precincts: 'police_precincts',
  neighborhoods: 'neighborhoods', // NOT 'wards'
};

/**
 * Ordered layer states for the LayerPanel. `isStatic` drops layers with no static asset.
 * Returns fresh copies so a caller toggling visibility never mutates the template rows.
 * O(l) time, O(l) space — l = Dayton layers (11).
 */
export function daytonLayerStates(isStatic: boolean): LayerState[] {
  return DAYTON_LAYERS
    // O(l) time, O(l) space — l = layers
    .filter((l) => !isStatic || DAYTON_STATIC_LAYER_IDS.has(l.id))
    // O(l) time, O(l) space — l = layers
    .map((l) => ({ ...l }));
}

/**
 * Dev-mode Martin URLs by layer id.
 * O(l) time, O(l) space — l = Dayton layers.
 */
export function daytonDevSources(): Record<string, string> {
  const out: Record<string, string> = {};
  // O(l) time, O(l) space — l = layers
  for (const [id, table] of Object.entries(DEV_TABLES)) out[id] = martinTileUrl(table);
  return out;
}

/**
 * Static-mode PMTiles URLs by layer id, all under `./data/dayton/`. Only layers with a
 * produced file appear (no '' entries).
 * O(l) time, O(l) space — l = Dayton layers.
 */
export function daytonStaticSources(): Record<string, string> {
  const out: Record<string, string> = {};
  // O(l) time, O(l) space — l = layers with a static file
  for (const id of DAYTON_STATIC_LAYER_IDS) out[id] = `pmtiles://./data/dayton/${id}.pmtiles`;
  return out;
}
