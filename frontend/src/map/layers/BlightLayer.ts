import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { vectorSourceSpec } from '../../utils/layerSourceHelper';

const BLIGHT_SOURCE = 'blight-violations-source';

/**
 * Abandoned & Blight composite layer for Detroit.
 *
 * Combines three data sources into one togglable layer:
 * 1. Blight Tickets (point) — property maintenance violations, colored by status
 * 2. Commercial Demolitions (point) — demolished/pending demolition buildings
 * 3. DLBA properties (polygon) — city-owned vacant land bank parcels
 * 4. OSM Abandoned (point) — community-mapped abandoned buildings/businesses
 *
 * Blight + demolitions + OSM come from the `blight_violations` PostGIS table.
 * DLBA comes from the `dlba_properties` table (already has its own layer — reused here).
 *
 * Color scheme:
 *   - Blight ticket (open/pending): #ef4444 (red)
 *   - Blight ticket (closed/paid): #6b7280 (gray)
 *   - Commercial demolition: #f97316 (orange)
 *   - OSM abandoned: #a855f7 (purple)
 *   - DLBA (auction): #22c55e (green)
 *   - DLBA (side lot): #eab308 (yellow)
 *   - DLBA (demolition): #ef4444 (red)
 * O(1) time, O(1) space — n = 1 source + a fixed set of style layers
 */
export function addBlightLayer(map: maplibregl.Map, config: LayerConfig): void {
  // --- Blight violations source (points from Martin) ---
  if (!map.getSource(BLIGHT_SOURCE)) {
    map.addSource(BLIGHT_SOURCE, {
      type: 'vector',
      ...vectorSourceSpec(config.sourceUrl),
      minzoom: 0,
      maxzoom: 16,
    });
  }

  // Blight violation points — colored by source
  map.addLayer({
    id: `${config.id}-blight-points`,
    type: 'circle',
    source: BLIGHT_SOURCE,
    'source-layer': 'blight_violations',
    minzoom: 12,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'circle-radius': [
        'interpolate', ['linear'], ['zoom'],
        12, 1.5,
        15, 3,
        18, 6,
      ],
      'circle-color': [
        'match', ['get', 'source'],
        'commercial_demolition', '#f97316',  // orange
        'osm_abandoned', '#a855f7',          // purple
        // Default: blight tickets
        '#ef4444',                           // red
      ],
      'circle-opacity': [
        'interpolate', ['linear'], ['zoom'],
        12, 0.3 * config.opacity,
        15, 0.6 * config.opacity,
        18, 0.8 * config.opacity,
      ],
      'circle-stroke-width': 0,
    },
  } as maplibregl.AddLayerObject);

  // Heatmap at lower zoom levels (aggregate density)
  map.addLayer({
    id: `${config.id}-blight-heat`,
    type: 'heatmap',
    source: BLIGHT_SOURCE,
    'source-layer': 'blight_violations',
    maxzoom: 14,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'heatmap-weight': 1,
      'heatmap-intensity': [
        'interpolate', ['linear'], ['zoom'],
        8, 0.3,
        12, 1,
      ],
      'heatmap-radius': [
        'interpolate', ['linear'], ['zoom'],
        8, 4,
        12, 12,
      ],
      'heatmap-color': [
        'interpolate', ['linear'], ['heatmap-density'],
        0, 'rgba(0, 0, 0, 0)',
        0.1, 'rgba(239, 68, 68, 0.15)',
        0.3, 'rgba(239, 68, 68, 0.35)',
        0.5, 'rgba(249, 115, 22, 0.55)',
        0.7, 'rgba(234, 179, 8, 0.7)',
        1.0, 'rgba(255, 255, 255, 0.85)',
      ],
      'heatmap-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, config.opacity * 0.7,
        14, 0,
      ],
    },
  } as maplibregl.AddLayerObject);

  // Labels at high zoom
  map.addLayer({
    id: `${config.id}-blight-labels`,
    type: 'symbol',
    source: BLIGHT_SOURCE,
    'source-layer': 'blight_violations',
    minzoom: 16,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['coalesce', ['get', 'address'], ''],
      'text-size': 9,
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'top',
      'text-offset': [0, 0.8],
      'text-max-width': 8,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#f87171',
      'text-halo-color': '#000000',
      'text-halo-width': 1,
      'text-opacity': config.opacity * 0.8,
    },
  } as maplibregl.AddLayerObject);
}

// O(1) time, O(1) space — n = fixed list of style layer ids
export function getBlightLayerIds(configId: string): string[] {
  return [
    `${configId}-blight-points`,
    `${configId}-blight-heat`,
    `${configId}-blight-labels`,
  ];
}
