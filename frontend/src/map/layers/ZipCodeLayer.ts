import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';

const SOURCE_ID = 'zipcodes-source';

export function addZipCodeLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    tiles: [config.sourceUrl],
    minzoom: 0,
    maxzoom: 16,
  });

  // Zip code boundary outlines
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'zip_codes',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'line-color': '#f97316',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        8, 1,
        13, 2,
        16, 3,
      ],
      'line-opacity': config.opacity * 0.7,
      'line-dasharray': [6, 3],
    },
  } as maplibregl.AddLayerObject);

  // Zip code labels
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'zip_codes',
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'zip_code'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        10, 11,
        14, 15,
      ],
      'text-font': ['Noto Sans Bold'],
      'text-anchor': 'center',
      'text-allow-overlap': false,
    },
    paint: {
      'text-color': '#fb923c',
      'text-halo-color': '#0d1117',
      'text-halo-width': 2,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getZipCodeLayerIds(configId: string): string[] {
  return [`${configId}-stroke`, `${configId}-label`];
}
