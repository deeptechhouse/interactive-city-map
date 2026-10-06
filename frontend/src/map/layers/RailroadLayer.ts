import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import {
  RAILROAD_COLORS,
  RAILROAD_DEFAULT_COLOR,
  RAILROAD_STATUS_STYLES,
} from '../../utils/colorSchemes';
import { vectorSourceSpec } from '../../utils/layerSourceHelper';

const SOURCE_ID = 'railroads-source';

/** Build a match expression for railroad owner colors */
// O(k) time, O(k) space — k = entries in the colour table it reads (a constant table in colorSchemes.ts)
function ownerColorExpression(): unknown {
  const pairs: string[] = [];
  // O(k) time, O(k) space — k = entries in RAILROAD_COLORS (a constant table in colorSchemes.ts)
  for (const [owner, color] of Object.entries(RAILROAD_COLORS)) {
    pairs.push(owner, color);
  }
  return ['match', ['get', 'owner'], ...pairs, RAILROAD_DEFAULT_COLOR];
}

// O(s + k) time, O(k) space — s = entries in RAILROAD_STATUS_STYLES; k = entries in RAILROAD_COLORS
export function addRailroadLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    ...vectorSourceSpec(config.sourceUrl),
  });

  const statuses = Object.keys(RAILROAD_STATUS_STYLES);
  // Built once and shared by every status layer and the label layer (was rebuilt per layer).
  const ownerColor = ownerColorExpression();

  // O(s) time, O(s) space — s = entries in RAILROAD_STATUS_STYLES
  for (const status of statuses) {
    const style = RAILROAD_STATUS_STYLES[status];
    const layerId = `${config.id}-${status}`;

    const paint: Record<string, unknown> = {
      'line-color': style.colorOverride ?? ownerColor,
      'line-width': style.width,
      'line-opacity': config.opacity * style.opacity,
    };

    if (style.dasharray) {
      paint['line-dasharray'] = style.dasharray;
    }

    map.addLayer({
      id: layerId,
      type: 'line',
      source: SOURCE_ID,
      'source-layer': 'railroads',
      filter: ['==', ['get', 'status'], status],
      layout: {
        visibility: config.visible ? 'visible' : 'none',
        'line-cap': 'round',
        'line-join': 'round',
      },
      paint,
    } as maplibregl.AddLayerObject);
  }

  // Railroad labels — show name + owner along the line
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'railroads',
    minzoom: 12,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'symbol-placement': 'line',
      'text-field': [
        'concat',
        ['coalesce', ['get', 'name'], ''],
        ['case', ['all', ['has', 'owner'], ['has', 'name']], ' ', ''],
        ['case', ['has', 'owner'], ['concat', '(', ['get', 'owner'], ')'], ''],
      ],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        12, 9,
        16, 12,
      ],
      'text-font': ['Noto Sans Regular'],
      'text-max-angle': 30,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': ownerColor,
      'text-halo-color': '#0d1117',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity * 0.9,
    },
  } as maplibregl.AddLayerObject);
}

// O(s) time, O(s) space — s = entries in RAILROAD_STATUS_STYLES (a constant table)
export function getRailroadLayerIds(configId: string): string[] {
  return [
    // O(s) time, O(s) space — s = entries in RAILROAD_STATUS_STYLES (a constant table)
    ...Object.keys(RAILROAD_STATUS_STYLES).map((s) => `${configId}-${s}`),
    `${configId}-label`,
  ];
}
