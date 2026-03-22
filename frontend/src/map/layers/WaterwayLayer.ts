import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'waterways-source';

export function addWaterwayLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  map.addLayer({
    id: `${config.id}-line`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'waterways',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#3B82F6',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, 2,
        16, 4,
      ],
      'line-opacity': config.opacity,
    },
  });
}

export function getWaterwayLayerIds(configId: string): string[] {
  return [`${configId}-line`];
}
