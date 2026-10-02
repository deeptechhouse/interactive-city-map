import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { vectorSourceSpec } from '../../utils/layerSourceHelper';

const SOURCE_ID = 'neighborhoods-source';

/**
 * Detroit neighborhoods layer — 205 neighborhoods from Dept. of Neighborhoods.
 * Uses Martin vector tiles from the PostGIS `neighborhoods` table.
 * Renders as fill polygons with name labels.
 * O(1) time, O(1) space — n = 1 source + a fixed set of style layers
 */
export function addNeighborhoodLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    ...vectorSourceSpec(config.sourceUrl),
  });

  // Semi-transparent fill colored by a hash of neighborhood name
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'neighborhoods',
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': [
        'interpolate', ['linear'],
        ['%', ['id'], 12],
        0, '#4ade80',
        2, '#38bdf8',
        4, '#a78bfa',
        6, '#fb923c',
        8, '#f472b6',
        10, '#facc15',
      ],
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.08 * config.opacity,
        14, 0.18 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  // Boundary stroke
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'neighborhoods',
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'line-color': '#8b949e',
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 0.5, 14, 1.5],
      'line-opacity': config.opacity * 0.6,
    },
  } as maplibregl.AddLayerObject);

  // Neighborhood name labels
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'neighborhoods',
    minzoom: 12,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 15, 13],
      'text-font': ['Noto Sans Bold'],
      'text-anchor': 'center',
      'text-allow-overlap': false,
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#e6edf3',
      'text-halo-color': '#000000',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

// O(1) time, O(1) space — n = fixed list of style layer ids
export function getNeighborhoodLayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`, `${configId}-label`];
}
