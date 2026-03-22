import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { POI_COLORS } from '../../utils/colorSchemes';

const SOURCE_ID = 'pois-source';

function poiColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [cat, color] of Object.entries(POI_COLORS)) {
    pairs.push(cat, color);
  }
  return ['match', ['get', 'category'], ...pairs, '#888888'];
}

export function addPOILayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  map.addLayer({
    id: config.id,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'pois',
    minzoom: 14,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'circle-color': poiColorExpression(),
      'circle-radius': [
        'interpolate',
        ['linear'],
        ['zoom'],
        14, 4,
        18, 8,
      ],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
      'circle-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getPOILayerIds(configId: string): string[] {
  return [configId];
}
