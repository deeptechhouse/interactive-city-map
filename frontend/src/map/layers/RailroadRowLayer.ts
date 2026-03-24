import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { RAILROAD_ROW_PARCELS } from './data/railroadRowData';

const SOURCE_ID = 'railroad-row-source';

export function addRailroadRowLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (!map.getSource(SOURCE_ID)) {
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: RAILROAD_ROW_PARCELS as GeoJSON.FeatureCollection,
    });
  }

  // ROW parcel fill — amber/orange to match railroad theme
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': '#f59e0b',
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.1 * config.opacity,
        14, 0.25 * config.opacity,
        18, 0.35 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  // ROW parcel stroke
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    minzoom: 13,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'line-color': '#d97706',
      'line-width': ['interpolate', ['linear'], ['zoom'], 13, 0.5, 18, 1.5],
      'line-opacity': config.opacity * 0.6,
    },
  } as maplibregl.AddLayerObject);

  // PIN labels at high zoom
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    minzoom: 17,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'pin'],
      'text-size': 9,
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#fbbf24',
      'text-halo-color': '#000000',
      'text-halo-width': 1,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getRailroadRowLayerIds(configId: string): string[] {
  return [
    `${configId}-fill`,
    `${configId}-stroke`,
    `${configId}-label`,
  ];
}
