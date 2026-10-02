import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { vectorSourceSpec } from '../../utils/layerSourceHelper';

const SOURCE_ID = 'dlba-source';

// Color DLBA properties by status
// auction = green (opportunity), demolition = red (condemned),
// side lot = yellow, other = gray
const STATUS_COLORS: Record<string, string> = {
  auction: '#22c55e',
  'side lot': '#eab308',
  demolition: '#ef4444',
  'own it now': '#3b82f6',
  sold: '#8b949e',
};

// O(k) time, O(k) space — k = entries in the colour table
function statusColorExpression(): unknown {
  const pairs: (string | string)[] = [];
  // O(k) time, O(k) space — k = entries in the colour table
  for (const [status, color] of Object.entries(STATUS_COLORS)) {
    pairs.push(status.toLowerCase(), color);
  }
  return ['match', ['downcase', ['coalesce', ['get', 'status'], '']], ...pairs, '#6b7280'];
}

/**
 * Detroit Land Bank Authority (DLBA) properties layer.
 * Uses Martin vector tiles from PostGIS `dlba_properties` table.
 * Points/polygons colored by property status.
 * O(1) time, O(1) space — n = 1 source + a fixed set of style layers
 */
export function addDLBALayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  map.addSource(SOURCE_ID, {
    type: 'vector',
    ...vectorSourceSpec(config.sourceUrl),
    minzoom: 0,
    maxzoom: 16,
  });

  // Fill layer for polygonal parcels. The 2026 Detroit export is POINTS (one per Land Bank
  // property, verified 2026-10-02), so fills/outlines only draw for polygon features and
  // the circle layer below carries the points.
  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    'source-layer': 'dlba_properties',
    filter: ['==', ['geometry-type'], 'Polygon'],
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': statusColorExpression(),
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        12, 0.2 * config.opacity,
        16, 0.5 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  // Outline
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    'source-layer': 'dlba_properties',
    filter: ['==', ['geometry-type'], 'Polygon'],
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'line-color': statusColorExpression(),
      'line-width': 1,
      'line-opacity': config.opacity * 0.6,
    },
  } as maplibregl.AddLayerObject);

  // Point properties (clickable — Detroit's popup is keyed to `<id>-points`)
  map.addLayer({
    id: `${config.id}-points`,
    type: 'circle',
    source: SOURCE_ID,
    'source-layer': 'dlba_properties',
    filter: ['==', ['geometry-type'], 'Point'],
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'circle-color': statusColorExpression(),
      'circle-radius': ['interpolate', ['linear'], ['zoom'], 11, 1.5, 16, 5],
      'circle-opacity': config.opacity * 0.85,
      'circle-stroke-color': '#000000',
      'circle-stroke-width': 0.5,
    },
  } as maplibregl.AddLayerObject);

  // Labels at high zoom
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    'source-layer': 'dlba_properties',
    minzoom: 15,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['get', 'address'],
      'text-size': 9,
      'text-font': ['Noto Sans Regular'],
      'text-anchor': 'center',
      'text-allow-overlap': false,
      'text-max-width': 8,
    },
    paint: {
      'text-color': '#c9d1d9',
      'text-halo-color': '#000000',
      'text-halo-width': 1,
      'text-opacity': config.opacity * 0.8,
    },
  } as maplibregl.AddLayerObject);
}

// O(1) time, O(1) space — n = fixed list of style layer ids
export function getDLBALayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`, `${configId}-points`, `${configId}-label`];
}
