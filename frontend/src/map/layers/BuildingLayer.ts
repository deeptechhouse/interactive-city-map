import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { BUILDING_CLASS_COLORS, BUILDING_DEFAULT_COLOR } from '../../utils/colorSchemes';
import { INTERIORS_AVAILABLE } from '../../utils/staticMode';

type Filter = maplibregl.FilterSpecification;
const NOT_HIDDEN = ['==', ['get', 'is_hidden'], false] as unknown as Filter;
// Matches nothing — used to switch the interior-only styling off when interiors can't load.
// is_hidden is a boolean, so it never equals this string. (['==', 1, 0] looks simpler but
// MapLibre reads it as the legacy filter syntax and rejects it — caught by a test.)
const NEVER = ['==', ['get', 'is_hidden'], '__never__'] as unknown as Filter;

export type BuildingSublayer = 'fill' | 'stroke' | 'interior-stroke' | 'highlight' | 'label';

/**
 * Each sublayer's OWN filter — the single source for addLayer below AND for
 * BuildingLegend, which narrows these by building type. (Before 2026-10-02 the legend
 * replaced them with a bare is_hidden filter, so the dashed "interior" outline spread to
 * every building once the legend ran.)
 * O(1) time, O(1) space — n = 1 filter.
 */
export function buildingBaseFilter(sublayer: BuildingSublayer): Filter {
  switch (sublayer) {
    case 'stroke':
      // Interior buildings get their own dashed stroke — unless interiors are off,
      // in which case every building uses this normal stroke.
      return INTERIORS_AVAILABLE
        ? (['all', NOT_HIDDEN, ['==', ['get', 'has_interior'], false]] as unknown as Filter)
        : NOT_HIDDEN;
    case 'interior-stroke':
      return INTERIORS_AVAILABLE
        ? (['all', NOT_HIDDEN, ['==', ['get', 'has_interior'], true]] as unknown as Filter)
        : NEVER;
    case 'label':
      return ['all', NOT_HIDDEN, ['any', ['has', 'name'], ['has', 'address']]] as unknown as Filter;
    default:
      return NOT_HIDDEN;
  }
}

const SOURCE_ID = 'buildings-source';

/** O(c) time, O(c) space — c = building classes in the colour table. */
function buildingFillColorExpression(): unknown {
  // Data-driven color by property_class, with special cases for has_interior and owner_type
  const pairs: string[] = [];
  // O(c) time, O(c) space — c = building classes.
  for (const [cls, color] of Object.entries(BUILDING_CLASS_COLORS)) {
    pairs.push(cls, color);
  }
  return [
    'case',
    // Buildings with interior maps get a distinct teal tint (only when interiors can load)
    ...(INTERIORS_AVAILABLE ? [['==', ['get', 'has_interior'], true], '#0d9488'] : []),
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

/** Add the building sublayers once. O(1) time, O(1) space — n = 5 sublayers. */
export function addBuildingLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  const isPmtiles = config.sourceUrl.startsWith('pmtiles://');
  map.addSource(SOURCE_ID, {
    type: 'vector',
    ...(isPmtiles ? { url: config.sourceUrl } : { tiles: [config.sourceUrl] }),
    minzoom: 0,
    maxzoom: 16,
  });

  // Main building fill — colored by type
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'buildings',
    filter: NOT_HIDDEN,
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
    filter: buildingBaseFilter('stroke'),
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
    filter: buildingBaseFilter('interior-stroke'),
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
    filter: NOT_HIDDEN,
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
    filter: buildingBaseFilter('label'),
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

/** O(1) time, O(1) space — n = 5 ids. */
export function getBuildingLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-interior-stroke`,
    `${configId}-highlight`,
    `${configId}-label`,
  ];
}
