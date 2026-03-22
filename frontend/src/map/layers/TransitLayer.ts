import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { CTA_LINE_COLORS } from '../../utils/colorSchemes';

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
  const martinBase = import.meta.env.VITE_MARTIN_URL || 'http://localhost:3030';

  if (!map.getSource(LINES_SOURCE_ID)) {
    map.addSource(LINES_SOURCE_ID, {
      type: 'vector',
      tiles: [`${martinBase}/transit_lines/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 16,
    });
  }

  if (!map.getSource(STATIONS_SOURCE_ID)) {
    map.addSource(STATIONS_SOURCE_ID, {
      type: 'vector',
      tiles: [`${martinBase}/transit_stations/{z}/{x}/{y}`],
      minzoom: 0,
      maxzoom: 16,
    });
  }

  map.addLayer({
    id: `${config.id}-lines`,
    type: 'line',
    source: LINES_SOURCE_ID,
    'source-layer': 'transit_lines',
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
    'source-layer': 'transit_stations',
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
