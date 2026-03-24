import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { GANG_BOUNDARIES } from './data/gangTerritoryData';
import { GANG_COLORS } from '../../utils/colorSchemes';

const SOURCE_ID = 'gang-territory-source';

function gangColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [name, color] of Object.entries(GANG_COLORS)) {
    pairs.push(name, color);
  }
  return ['match', ['get', 'gang_name'], ...pairs, '#888888'];
}

export function addGangTerritoryLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: GANG_BOUNDARIES as GeoJSON.FeatureCollection,
    });
  }

  // Territory fill
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': gangColorExpression(),
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.15 * config.opacity,
        14, 0.3 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  // Territory stroke — dashed to distinguish from district/ward borders
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': gangColorExpression(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.5],
      'line-opacity': config.opacity * 0.8,
      'line-dasharray': [4, 2],
    },
  } as maplibregl.AddLayerObject);

  // Gang name labels
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 12,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'gang_name'],
      'text-size': ['interpolate', ['linear'], ['zoom'], 12, 9, 15, 13],
      'text-font': ['Noto Sans Bold'],
      'text-anchor': 'center',
      'text-max-width': 8,
      'text-allow-overlap': false,
      'text-transform': 'uppercase',
    },
    paint: {
      'text-color': '#f87171',
      'text-halo-color': '#000000',
      'text-halo-width': 2,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getGangTerritoryLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-label`,
  ];
}
