import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import {
  RAILROAD_COLORS,
  RAILROAD_DEFAULT_COLOR,
  RAILROAD_STATUS_STYLES,
} from '../../utils/colorSchemes';

const SOURCE_ID = 'railroads-source';

/** Build a match expression for railroad owner colors */
function ownerColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [owner, color] of Object.entries(RAILROAD_COLORS)) {
    pairs.push(owner, color);
  }
  return ['match', ['get', 'owner'], ...pairs, RAILROAD_DEFAULT_COLOR];
}

export function addRailroadLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  const statuses = Object.keys(RAILROAD_STATUS_STYLES);

  for (const status of statuses) {
    const style = RAILROAD_STATUS_STYLES[status];
    const layerId = `${config.id}-${status}`;

    const paint: Record<string, unknown> = {
      'line-color': ownerColorExpression(),
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
      },
      paint,
    } as maplibregl.AddLayerObject);
  }
}

export function getRailroadLayerIds(configId: string): string[] {
  return Object.keys(RAILROAD_STATUS_STYLES).map((s) => `${configId}-${s}`);
}
