import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { CTA_LINE_COLORS } from '../../utils/colorSchemes';
import { IS_STATIC } from '../../utils/staticMode';
import { martinTileUrl } from '../../utils/geoUtils';
import { STATIC_TRANSIT_LINES } from './data/static_transit_lines';
import { STATIC_TRANSIT_STATIONS } from './data/static_transit_stations';

const LINES_SOURCE_ID = 'transit-lines-source';
const STATIONS_SOURCE_ID = 'transit-stations-source';

function lineColorExpression(): unknown {
  const pairs: string[] = [];
  for (const [line, color] of Object.entries(CTA_LINE_COLORS)) {
    pairs.push(line, color);
  }
  return ['match', ['get', 'line_name'], ...pairs, '#888888'];
}

export function addTransitLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (IS_STATIC) {
    // Static mode: use embedded GeoJSON
    if (!map.getSource(LINES_SOURCE_ID)) {
      map.addSource(LINES_SOURCE_ID, { type: 'geojson', data: STATIC_TRANSIT_LINES as GeoJSON.FeatureCollection });
    }
    if (!map.getSource(STATIONS_SOURCE_ID)) {
      map.addSource(STATIONS_SOURCE_ID, { type: 'geojson', data: STATIC_TRANSIT_STATIONS as GeoJSON.FeatureCollection });
    }
  } else {
    // Dev mode: use Martin tile server
    const linesUrl = config.sourceUrl || martinTileUrl('transit_lines');
    const stationsUrl = martinTileUrl('transit_stations');

    if (!map.getSource(LINES_SOURCE_ID)) {
      map.addSource(LINES_SOURCE_ID, {
        type: 'vector',
        tiles: [linesUrl],
        minzoom: 0,
        maxzoom: 16,
      });
    }

    if (!map.getSource(STATIONS_SOURCE_ID)) {
      map.addSource(STATIONS_SOURCE_ID, {
        type: 'vector',
        tiles: [stationsUrl],
        minzoom: 0,
        maxzoom: 16,
      });
    }
  }

  const sourceLayerProp = IS_STATIC ? {} : { 'source-layer': 'transit_lines' };
  const stationSourceLayerProp = IS_STATIC ? {} : { 'source-layer': 'transit_stations' };

  map.addLayer({
    id: `${config.id}-lines`,
    type: 'line',
    source: LINES_SOURCE_ID,
    ...sourceLayerProp,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'line-cap': 'round',
      'line-join': 'round',
    },
    paint: {
      'line-color': lineColorExpression(),
      'line-width': 3,
      'line-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-stations`,
    type: 'circle',
    source: STATIONS_SOURCE_ID,
    ...stationSourceLayerProp,
    minzoom: 13,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
    },
    paint: {
      'circle-color': lineColorExpression(),
      'circle-radius': 6,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1.5,
      'circle-opacity': config.opacity,
    },
  } as maplibregl.AddLayerObject);
}

export function getTransitLayerIds(configId: string): string[] {
  return [`${configId}-lines`, `${configId}-stations`];
}
