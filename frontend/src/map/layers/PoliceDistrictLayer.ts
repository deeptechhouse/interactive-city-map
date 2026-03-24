import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { DISTRICT_BOUNDARIES, DISTRICT_STATIONS } from './data/policeDistrictsData';
import { DISTRICT_COLORS } from '../../utils/colorSchemes';

const BOUNDARIES_SOURCE = 'police-districts-source';
const STATIONS_SOURCE = 'police-stations-source';

function districtColorExpression(): unknown {
  const pairs: (string | number)[] = [];
  for (const [dist, color] of Object.entries(DISTRICT_COLORS)) {
    pairs.push(Number(dist), color);
  }
  return ['match', ['get', 'dist_num'], ...pairs, '#888888'];
}

export function addPoliceDistrictLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (!map.getSource(BOUNDARIES_SOURCE)) {
    map.addSource(BOUNDARIES_SOURCE, {
      type: 'geojson',
      data: DISTRICT_BOUNDARIES as GeoJSON.FeatureCollection,
    });
  }

  if (!map.getSource(STATIONS_SOURCE)) {
    map.addSource(STATIONS_SOURCE, {
      type: 'geojson',
      data: DISTRICT_STATIONS as GeoJSON.FeatureCollection,
    });
  }

  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: BOUNDARIES_SOURCE,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': districtColorExpression(),
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.15 * config.opacity,
        14, 0.25 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: BOUNDARIES_SOURCE,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'line-color': districtColorExpression(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 14, 3],
      'line-opacity': config.opacity * 0.8,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: BOUNDARIES_SOURCE,
    minzoom: 10,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['concat', 'Dist ', ['to-string', ['get', 'dist_num']]],
      'text-size': ['interpolate', ['linear'], ['zoom'], 10, 12, 14, 16],
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
    id: `${config.id}-stations`,
    type: 'symbol',
    source: STATIONS_SOURCE,
    minzoom: 11,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': '\u2605',
      'text-size': ['interpolate', ['linear'], ['zoom'], 11, 14, 15, 24],
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'center',
      'text-allow-overlap': true,
    },
    paint: {
      'text-color': '#fbbf24',
      'text-halo-color': '#000000',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-station-labels`,
    type: 'symbol',
    source: STATIONS_SOURCE,
    minzoom: 13,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'name'],
      'text-size': 11,
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'top',
      'text-offset': [0, 1.2],
      'text-max-width': 10,
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#fbbf24',
      'text-halo-color': '#000000',
      'text-halo-width': 1.5,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getPoliceDistrictLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-label`,
    `${configId}-stations`,
    `${configId}-station-labels`,
  ];
}
