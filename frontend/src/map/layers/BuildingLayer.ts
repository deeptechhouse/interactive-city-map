import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { BUILDING_CLASS_COLORS, BUILDING_DEFAULT_COLOR } from '../../utils/colorSchemes';

const SOURCE_ID = 'buildings-source';

function buildingFillColorExpression(): unknown {
  // Data-driven color by property_class, with special cases for has_interior and owner_type
  const pairs: string[] = [];
  for (const [cls, color] of Object.entries(BUILDING_CLASS_COLORS)) {
    pairs.push(cls, color);
  }
  return [
    'case',
    // Buildings with interior maps get a distinct teal tint
    ['==', ['get', 'has_interior'], true],
    '#0d9488',
    // Government-owned buildings get cyan
    ['==', ['get', 'owner_type'], 'government'],
    '#06b6d4',
    // Color by property_class if available
    ['has', 'property_class'],
    ['match', ['get', 'property_class'], ...pairs, BUILDING_DEFAULT_COLOR],
    // Fallback: color by zoning_code prefix if available
    ['has', 'zoning_code'],
    [
      'match',
      // Extract first letter of zoning code: R=residential, C/B=commercial, M=manufacturing, etc.
      ['slice', ['get', 'zoning_code'], 0, 1],
      'R', '#22c55e',  // residential green
      'C', '#ef4444',  // commercial red
      'B', '#ef4444',  // business/commercial red
      'M', '#f59e0b',  // manufacturing amber
      'D', '#a855f7',  // downtown/mixed purple
      'P', '#3b82f6',  // planned/institutional blue
      'T', '#06b6d4',  // transportation cyan
      BUILDING_DEFAULT_COLOR,
    ],
    // Default gray
    BUILDING_DEFAULT_COLOR,
  ];
}

export function addBuildingLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  // Main building fill — colored by type
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
      'fill-color': buildingFillColorExpression(),
      'fill-opacity': [
        'interpolate',
        ['linear'],
        ['zoom'],
        10, 0.2 * config.opacity,
        14, 0.35 * config.opacity,
        16, 0.5 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  // Building stroke — colored to match fill but darker
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
      'line-color': buildingFillColorExpression(),
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        12, 0.3,
        16, 1,
      ],
      'line-opacity': config.opacity * 0.8,
    },
  } as maplibregl.AddLayerObject);

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
