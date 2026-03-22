import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { ZONING_COLORS, ZONING_STROKE_COLORS } from '../../utils/colorSchemes';

const SOURCE_ID = 'zoning-source';

function zoningFillColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [cls, color] of Object.entries(ZONING_COLORS)) {
    pairs.push(cls, color);
  }
  return ['match', ['get', 'zone_class'], ...pairs, '#888888'];
}

function zoningStrokeColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [cls, color] of Object.entries(ZONING_STROKE_COLORS)) {
    pairs.push(cls, color);
  }
  return ['match', ['get', 'zone_class'], ...pairs, '#666666'];
}

export function addZoningLayer(map: maplibregl.Map, config: LayerConfig): void {
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
    'source-layer': 'zoning_districts',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'fill-color': zoningFillColorExpression(),
      'fill-opacity': 0.3 * config.opacity,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'zoning_districts',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': zoningStrokeColorExpression(),
      'line-width': 1,
      'line-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getZoningLayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`];
}
