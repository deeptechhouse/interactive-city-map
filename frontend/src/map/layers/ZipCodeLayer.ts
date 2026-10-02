import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { addDualModeSource, sourceLayerProp } from '../../utils/layerSourceHelper';
import { STATIC_ZIP_CODES } from './data/static_zip_codes';

const SOURCE_ID = 'zipcodes-source';

export function addZipCodeLayer(map: maplibregl.Map, config: LayerConfig): void {
  const { isGeoJson } = addDualModeSource(map, SOURCE_ID, config.sourceUrl, 'zip_codes', STATIC_ZIP_CODES);
  const slp = sourceLayerProp('zip_codes', isGeoJson);

  // Zip code boundary outlines
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    ...slp,
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
    ...slp,
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
