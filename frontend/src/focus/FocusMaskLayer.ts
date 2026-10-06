/**
 * MapLibre wiring for the focus mask — draws what focusGeometry.ts computes.
 *
 * Two layers on one GeoJSON source pair:
 *   focus-mask     gray fill over everything OUTSIDE the focus area
 *   focus-outline  bright line around the focus area so its edge is obvious
 *
 * Both are kept at the top of the layer stack (moveLayer on every update) so they cover
 * data layers no matter when those were added. The selected-buildings outline is moved
 * above the mask afterwards so chosen buildings always stay visible.
 */
import type maplibregl from 'maplibre-gl';
import type { AreaFeature } from './focusGeometry';

const MASK_SOURCE = 'focus-mask-source';
const OUTLINE_SOURCE = 'focus-outline-source';
export const FOCUS_MASK_LAYER = 'focus-mask';
export const FOCUS_OUTLINE_LAYER = 'focus-outline';

// ADJUSTABLE: how strongly out-of-focus areas are grayed. 0.6 leaves streets readable;
// above ~0.9 the outside goes almost black and you lose orientation.
const MASK_OPACITY = 0.78;
// Matches the app background (THEME.bg) so masked areas read as "turned off", not as data.
const MASK_COLOR = '#161b22';
const OUTLINE_COLOR = '#58a6ff';

const EMPTY_FC: GeoJSON.FeatureCollection = { type: 'FeatureCollection', features: [] };

/** Add sources/layers once. Idempotent. O(1) time, O(1) space. */
function ensureLayers(map: maplibregl.Map): void {
  if (!map.getSource(MASK_SOURCE)) {
    map.addSource(MASK_SOURCE, { type: 'geojson', data: EMPTY_FC });
  }
  if (!map.getSource(OUTLINE_SOURCE)) {
    map.addSource(OUTLINE_SOURCE, { type: 'geojson', data: EMPTY_FC });
  }
  if (!map.getLayer(FOCUS_MASK_LAYER)) {
    map.addLayer({
      id: FOCUS_MASK_LAYER,
      type: 'fill',
      source: MASK_SOURCE,
      paint: { 'fill-color': MASK_COLOR, 'fill-opacity': MASK_OPACITY },
    });
  }
  if (!map.getLayer(FOCUS_OUTLINE_LAYER)) {
    map.addLayer({
      id: FOCUS_OUTLINE_LAYER,
      type: 'line',
      source: OUTLINE_SOURCE,
      paint: {
        'line-color': OUTLINE_COLOR,
        'line-width': ['interpolate', ['linear'], ['zoom'], 10, 1.5, 15, 3],
        'line-opacity': 0.9,
      },
    });
  }
}

/**
 * Show the mask (``mask`` = world minus focus) and outline (``shape``), or hide both
 * when ``mask`` is null.
 * O(v) time, O(v) space — v = vertices handed to MapLibre.
 */
export function setFocusMask(
  map: maplibregl.Map,
  mask: AreaFeature | null,
  shape: AreaFeature | null,
): void {
  ensureLayers(map);
  (map.getSource(MASK_SOURCE) as maplibregl.GeoJSONSource).setData(
    mask ? { type: 'FeatureCollection', features: [mask] } : EMPTY_FC,
  );
  (map.getSource(OUTLINE_SOURCE) as maplibregl.GeoJSONSource).setData(
    shape ? { type: 'FeatureCollection', features: [shape] } : EMPTY_FC,
  );
  // Keep on top of anything added since the last update.
  map.moveLayer(FOCUS_MASK_LAYER);
  map.moveLayer(FOCUS_OUTLINE_LAYER);
}
