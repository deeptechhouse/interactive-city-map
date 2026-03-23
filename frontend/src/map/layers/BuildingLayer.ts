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

  // Building labels — show name or address at high zoom
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'buildings',
    minzoom: 16,
    filter: ['all',
      ['==', ['get', 'is_hidden'], false],
      ['any',
        ['has', 'name'],
        ['has', 'address'],
      ],
    ],
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['coalesce', ['get', 'name'], ['get', 'address']],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        16, 9,
        18, 12,
      ],
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#e2e8f0',
      'text-halo-color': '#0d1117',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  });
}

export function getBuildingLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-interior-stroke`,
    `${configId}-highlight`,
    `${configId}-label`,
  ];
}
