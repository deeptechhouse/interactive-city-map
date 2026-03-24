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

  // Water fill (for wider rivers/canals shown as polygons if available)
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
      'line-color': '#0ea5e9',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, 2,
        12, 4,
        16, 8,
      ],
      'line-opacity': config.opacity * 0.8,
    },
  });

  // Glow/casing for depth effect
  map.addLayer({
    id: `${config.id}-glow`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'waterways',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#0284c7',
      'line-width': [
        'interpolate',
        ['linear'],
        ['zoom'],
        8, 4,
        12, 8,
        16, 14,
      ],
      'line-opacity': config.opacity * 0.3,
    },
  });

  // Waterway labels
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'waterways',
    minzoom: 11,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'symbol-placement': 'line',
      'text-field': ['get', 'name'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        11, 10,
        16, 14,
      ],
      'text-font': ['Noto Sans Italic'],
      'text-max-angle': 30,
      'text-allow-overlap': false,
      'text-padding': 40,
    },
    paint: {
      'text-color': '#38bdf8',
      'text-halo-color': '#0c4a6e',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getWaterwayLayerIds(configId: string): string[] {
  return [`${configId}-glow`, `${configId}-line`, `${configId}-label`];
}
