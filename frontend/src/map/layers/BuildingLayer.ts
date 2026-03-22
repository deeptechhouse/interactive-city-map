import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'buildings-source';

export function addBuildingLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  // Main building fill
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'buildings',
    filter: ['==', ['get', 'is_hidden'], false],
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'fill-color': '#334155',
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10, 0.15 * config.opacity,
        16, 0.4 * config.opacity,
      ],
    },
  });

  // Building stroke
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'buildings',
    filter: ['all',
      ['==', ['get', 'is_hidden'], false],
      ['==', ['get', 'has_interior'], false],
    ],
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#475569',
      'line-width': 0.5,
      'line-opacity': config.opacity,
    },
  });

  // Buildings with interior: dashed stroke, different color
  map.addLayer({
    id: `${config.id}-interior-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'buildings',
    filter: ['all',
      ['==', ['get', 'is_hidden'], false],
      ['==', ['get', 'has_interior'], true],
    ],
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#60a5fa',
      'line-width': 1,
      'line-dasharray': [4, 2],
      'line-opacity': config.opacity,
    },
  });

  // Hover highlight layer (invisible by default, driven by feature-state)
  map.addLayer({
    id: `${config.id}-highlight`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'buildings',
    filter: ['==', ['get', 'is_hidden'], false],
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'fill-color': '#58a6ff',
      'fill-opacity': [
        'case',
        ['boolean', ['feature-state', 'hover'], false],
        0.6,
        0,
      ],
    },
  });
}

export function getBuildingLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-interior-stroke`,
    `${configId}-highlight`,
  ];
}
