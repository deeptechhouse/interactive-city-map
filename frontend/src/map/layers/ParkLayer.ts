import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'parks-source';

export function addParkLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  // Park fill — vivid green
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'fill-color': '#15803d',
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.25 * config.opacity,
        14, 0.35 * config.opacity,
        18, 0.45 * config.opacity,
      ],
    },
  });

  // Park stroke
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#22c55e',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.5,
        16, 1.5,
      ],
      'line-opacity': config.opacity * 0.7,
    },
  });

  // Park labels
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    minzoom: 13,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        13, 10,
        16, 13,
      ],
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#4ade80',
      'text-halo-color': '#052e16',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getParkLayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`, `${configId}-label`];
}
