import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { CTA_LINE_COLORS } from '../../utils/colorSchemes';
import { IS_STATIC } from '../../utils/staticMode';
import { martinTileUrl } from '../../utils/geoUtils';
import { STATIC_TRANSIT_LINES } from './data/static_transit_lines';
import { STATIC_TRANSIT_STATIONS } from './data/static_transit_stations';
import { vectorSourceSpec } from '../../utils/layerSourceHelper';

const LINES_SOURCE_ID = 'transit-lines-source';
const STATIONS_SOURCE_ID = 'transit-stations-source';

/**
 * CTA lines keep their fixed colours (Chicago unchanged). Any other line uses the feature's
 * own GTFS `color` ('#RRGGBB', written by the static exporter for Detroit/Dayton), then grey.
 * O(k) time, O(k) space — k = CTA lines in the colour table.
 */
function lineColorExpression(): unknown {
  const pairs: string[] = [];
  // O(k) time, O(k) space — k = CTA lines
  for (const [line, color] of Object.entries(CTA_LINE_COLORS)) {
    pairs.push(line, color);
  }
  return ['match', ['get', 'line_name'], ...pairs, ['coalesce', ['get', 'color'], '#888888']];
}

/**
 * Lines + stations. Three source modes: Chicago static (bundled GeoJSON), per-city static
 * (one transit.pmtiles holding both `transit_lines` and `transit_stations`), dev (Martin).
 * O(1) time, O(1) space — n = 2 sources + a fixed set of style layers.
 */
export function addTransitLayer(map: maplibregl.Map, config: LayerConfig): void {
  const isPmtiles = config.sourceUrl.startsWith('pmtiles://');
  const useGeoJson = IS_STATIC && !isPmtiles;
  if (useGeoJson) {
    // Static mode: use embedded GeoJSON
    if (!map.getSource(LINES_SOURCE_ID)) {
      map.addSource(LINES_SOURCE_ID, { type: 'geojson', data: STATIC_TRANSIT_LINES as GeoJSON.FeatureCollection });
    }
    if (!map.getSource(STATIONS_SOURCE_ID)) {
      map.addSource(STATIONS_SOURCE_ID, { type: 'geojson', data: STATIC_TRANSIT_STATIONS as GeoJSON.FeatureCollection });
    }
  } else {
    // Dev mode (Martin) or a per-city transit.pmtiles holding both tile layers
    const linesUrl = config.sourceUrl || martinTileUrl('transit_lines');
    const stationsUrl = isPmtiles ? config.sourceUrl : martinTileUrl('transit_stations');

    if (!map.getSource(LINES_SOURCE_ID)) {
      map.addSource(LINES_SOURCE_ID, {
        type: 'vector',
        ...vectorSourceSpec(linesUrl),
        minzoom: 0,
        maxzoom: 16,
      });
    }

    if (!map.getSource(STATIONS_SOURCE_ID)) {
      map.addSource(STATIONS_SOURCE_ID, {
        type: 'vector',
        ...vectorSourceSpec(stationsUrl),
        minzoom: 0,
        maxzoom: 16,
      });
    }
  }

  const sourceLayerProp = useGeoJson ? {} : { 'source-layer': 'transit_lines' };
  const stationSourceLayerProp = useGeoJson ? {} : { 'source-layer': 'transit_stations' };

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

// O(1) time, O(1) space — n = fixed list of style layer ids
export function getTransitLayerIds(configId: string): string[] {
  return [`${configId}-lines`, `${configId}-stations`];
}
