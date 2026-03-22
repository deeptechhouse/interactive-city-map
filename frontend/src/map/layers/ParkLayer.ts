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

  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'fill-color': '#22C55E',
      'fill-opacity': 0.2 * config.opacity,
    },
  });

  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'parcels',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#16A34A',
      'line-width': 1,
      'line-opacity': config.opacity,
    },
  });
}

export function getParkLayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`];
}
