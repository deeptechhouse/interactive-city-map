import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { WARD_BOUNDARIES, WARD_OFFICES } from './data/wardsData';
import { WARD_COLORS } from '../../utils/colorSchemes';

const BOUNDARIES_SOURCE = 'wards-source';
const OFFICES_SOURCE = 'ward-offices-source';

function wardColorExpression(): unknown {
  const pairs: (string | number)[] = [];
  for (const [ward, color] of Object.entries(WARD_COLORS)) {
    pairs.push(Number(ward), color);
  }
  return ['match', ['get', 'ward'], ...pairs, '#888888'];
}

export function addWardLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (!map.getSource(BOUNDARIES_SOURCE)) {
    map.addSource(BOUNDARIES_SOURCE, {
      type: 'geojson',
      data: WARD_BOUNDARIES as GeoJSON.FeatureCollection,
    });
  }

  if (!map.getSource(OFFICES_SOURCE)) {
    map.addSource(OFFICES_SOURCE, {
      type: 'geojson',
      data: WARD_OFFICES as GeoJSON.FeatureCollection,
    });
  }

  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: BOUNDARIES_SOURCE,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': wardColorExpression(),
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.12 * config.opacity,
        14, 0.22 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: BOUNDARIES_SOURCE,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'line-color': wardColorExpression(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.5],
      'line-opacity': config.opacity * 0.7,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: BOUNDARIES_SOURCE,
    minzoom: 11,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['concat', 'Ward ', ['to-string', ['get', 'ward']]],
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 10, 14, 14],
      'text-font': ['Noto Sans Bold'],
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#ffffff',
      'text-halo-color': '#000000',
      'text-halo-width': 2,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-offices`,
    type: 'circle',
    source: OFFICES_SOURCE,
    minzoom: 12,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'circle-color': '#a78bfa',
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 12, 4, 16, 8],
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-office-labels`,
    type: 'symbol',
    source: OFFICES_SOURCE,
    minzoom: 14,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['concat', 'Ald. ', ['get', 'alderman']],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'top',
      'text-offset': [0, 1],
      'text-max-width': 10,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#c4b5fd',
      'text-halo-color': '#000000',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getWardLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-label`,
    `${configId}-offices`,
    `${configId}-office-labels`,
  ];
}
