import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { addDualModeSource, sourceLayerProp } from '../../utils/layerSourceHelper';
import { STATIC_MAJOR_STREETS } from './data/static_major_streets';

const SOURCE_ID = 'major-streets-source';

export function addMajorStreetsLayer(map: maplibregl.Map, config: LayerConfig): void {
  const { isGeoJson } = addDualModeSource(map, SOURCE_ID, config.sourceUrl, 'major_streets', STATIC_MAJOR_STREETS);
  const slp = sourceLayerProp('major_streets', isGeoJson);

  // Street line
  map.addLayer({
    id: `${config.id}-line`,
    type: 'line',
    source: SOURCE_ID,
    ...slp,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': '#fbbf24',
      'line-width': [
        'interpolate', ['linear'], ['zoom'],
        10, 1,
        14, 2,
        18, 3,
      ],
      'line-opacity': config.opacity * 0.6,
    },
  } as maplibregl.AddLayerObject);

  // Street label along the line
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    ...slp,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'symbol-placement': 'line',
      'text-field': ['get', 'name'],
      'text-size': [
        'interpolate', ['linear'], ['zoom'],
        10, 10,
        14, 13,
        18, 16,
      ],
      'text-font': ['Noto Sans Bold'],
      'text-max-angle': 30,
      'text-allow-overlap': false,
      'text-ignore-placement': false,
      'text-padding': 30,
    },
    paint: {
      'text-color': '#fbbf24',
      'text-halo-color': '#0d1117',
      'text-halo-width': 2,
      'text-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getMajorStreetsLayerIds(configId: string): string[] {
  return [`${configId}-line`, `${configId}-label`];
}
