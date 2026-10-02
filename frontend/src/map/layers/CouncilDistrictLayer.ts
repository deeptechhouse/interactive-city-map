import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { vectorSourceSpec } from '../../utils/layerSourceHelper';

const SOURCE_ID = 'council-districts-source';

// Detroit has 7 council districts — distinct colors for each
const DISTRICT_COLORS: Record<number, string> = {
  1: '#ef4444',  // red
  2: '#f97316',  // orange
  3: '#eab308',  // yellow
  4: '#22c55e',  // green
  5: '#3b82f6',  // blue
  6: '#8b5cf6',  // purple
  7: '#ec4899',  // pink
};

// O(k) time, O(k) space — k = entries in the colour table
function districtColorExpression(): unknown {
  const pairs: (string | number)[] = [];
  // O(k) time, O(k) space — k = entries in the colour table
  for (const [district, color] of Object.entries(DISTRICT_COLORS)) {
    pairs.push(Number(district), color);
  }
  return ['match', ['get', 'district_number'], ...pairs, '#888888'];
}

/**
 * Detroit council districts layer — 7 single-member districts.
 * Uses embedded GeoJSON (static data, changes rarely).
 * Will be populated when static data file is created;
 * for now falls back to Martin vector tiles if available.
 * O(1) time, O(1) space — n = 1 source + a fixed set of style layers
 */
export function addCouncilDistrictLayer(map: maplibregl.Map, config: LayerConfig): void {
  if (map.getSource(SOURCE_ID)) return;

  // If sourceUrl is provided (Martin tiles), use vector tiles
  if (config.sourceUrl) {
    map.addSource(SOURCE_ID, {
      type: 'vector',
      ...vectorSourceSpec(config.sourceUrl),
      minzoom: 0,
      maxzoom: 16,
    });
  } else {
    // Empty GeoJSON placeholder — will be populated with static data
    map.addSource(SOURCE_ID, {
      type: 'geojson',
      data: { type: 'FeatureCollection', features: [] },
    });
  }

  const sourceLayerProp = config.sourceUrl ? { 'source-layer': 'council_districts' } : {};

  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: SOURCE_ID,
    ...sourceLayerProp,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'fill-color': districtColorExpression(),
      'fill-opacity': [
        'interpolate', ['linear'], ['zoom'],
        10, 0.1 * config.opacity,
        14, 0.2 * config.opacity,
      ],
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: SOURCE_ID,
    ...sourceLayerProp,
    layout: { visibility: config.visible ? 'visible' : 'none' },
    paint: {
      'line-color': districtColorExpression(),
      'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1, 14, 2.5],
      'line-opacity': config.opacity * 0.7,
    },
  } as maplibregl.AddLayerObject);

  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: SOURCE_ID,
    ...sourceLayerProp,
    minzoom: 11,
    layout: {
      visibility: config.visible ? 'visible' : 'none',
      'text-field': ['concat', 'District ', ['to-string', ['get', 'district_number']]],
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
}

// O(1) time, O(1) space — n = fixed list of style layer ids
export function getCouncilDistrictLayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`, `${configId}-label`];
}
