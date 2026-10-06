import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { POI_COLORS } from '../../utils/colorSchemes';
import { addDualModeSource, sourceLayerProp } from '../../utils/layerSourceHelper';
import { STATIC_POIS } from './data/static_pois';

const SOURCE_ID = 'pois-source';

// O(k) time, O(k) space — k = entries in the colour table it reads (a constant table in colorSchemes.ts)
function poiColorExpression(): unknown {
  const pairs: string[] = [];
  // O(k) time, O(k) space — k = entries in POI_COLORS (a constant table in colorSchemes.ts)
  for (const [cat, color] of Object.entries(POI_COLORS)) {
    pairs.push(cat, color);
  }
  return ['match', ['get', 'category'], ...pairs, '#888888'];
}

// O(k) time, O(k) space — k = entries in POI_COLORS (a constant table in colorSchemes.ts)
export function addPOILayer(map: maplibregl.Map, config: LayerConfig): void {
  const { isGeoJson } = addDualModeSource(map, SOURCE_ID, config.sourceUrl, 'pois', STATIC_POIS);
  const slp = sourceLayerProp('pois', isGeoJson);

  map.addLayer({
    id: config.id,
    type: 'circle',
    source: SOURCE_ID,
    ...slp,
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

// O(1) time, O(1) space
export function getPOILayerIds(configId: string): string[] {
  return [configId];
}
