import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { FEDERAL_PROPERTIES } from './data/federalPropertyData';
import { FEDERAL_CATEGORY_COLORS } from '../../utils/colorSchemes';

const SOURCE_ID = 'federal-properties-source';

function categoryColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [cat, color] of Object.entries(FEDERAL_CATEGORY_COLORS)) {
    pairs.push(cat, color);
  }
  return ['match', ['get', 'category'], ...pairs, '#888888'];
}

export function addFederalPropertyLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: FEDERAL_PROPERTIES as GeoJSON.FeatureCollection,
    });
  }

  // Property markers — color-coded by category
  map.addLayer({
    id: `${config.id}-markers`,
    type: 'circle',
    source: SOURCE_ID,
    minzoom: 10,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'circle-color': categoryColorExpression(),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 10, 3, 14, 7, 18, 10],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);

  // Building/agency name labels
  map.addLayer({
    id: `${config.id}-labels`,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 14,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'top',
      'text-offset': [0, 1],
      'text-max-width': 12,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#e2e8f0',
      'text-halo-color': '#000000',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getFederalPropertyLayerIds(configId: string): string[] {
  return [
    `${configId}-markers`,
    `${configId}-labels`,
  ];
}
