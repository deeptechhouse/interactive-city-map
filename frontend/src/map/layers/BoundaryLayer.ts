/**
 * Generic boundary-outline layer: translucent fill + outline + centred label.
 *
 * PURPOSE
 *   One renderer for every "areas of a city" layer that has no Chicago-specific styling —
 *   today police_precincts (Detroit DPD precincts, Dayton police areas). Chicago's police
 *   districts / wards keep their own layer files (embedded data, custom popups).
 *
 * DATA CONTRACT: vector source-layer named after the layer id (config.sourceLayer
 *   overrides), each feature with a `name` (label) — falls back to `precinct`.
 *
 * Style layer ids: `<id>-fill` (clickable), `<id>-stroke`, `<id>-label`.
 */
import type maplibregl from 'maplibre-gl';
import type { LayerConfig } from '../../types/layer';
import { addDualModeSource, sourceLayerProp } from '../../utils/layerSourceHelper';

// ADJUSTABLE: outline colour for generic boundaries (amber reads well on the dark basemap).
const BOUNDARY_COLOR = '#f59e0b';

/**
 * Add the three style layers for one boundary layer id.
 * O(1) time, O(1) space — n = 1 source + 3 style layers.
 */
export function addBoundaryLayer(map: maplibregl.Map, config: LayerConfig): void {
  const sourceId = `${config.id}-source`;
  const sourceLayer = config.sourceLayer ?? config.id;
  const { isGeoJson } = addDualModeSource(map, sourceId, config.sourceUrl, sourceLayer);
  const layerProp = sourceLayerProp(sourceLayer, isGeoJson);
  const visibility = config.visible ? 'visible' : 'none';

  map.addLayer({
    id: `${config.id}-fill`,
    type: 'fill',
    source: sourceId,
    ...layerProp,
    layout: { visibility },
    paint: { 'fill-color': BOUNDARY_COLOR, 'fill-opacity': 0.06 * config.opacity },
  });
  map.addLayer({
    id: `${config.id}-stroke`,
    type: 'line',
    source: sourceId,
    ...layerProp,
    layout: { visibility },
    paint: { 'line-color': BOUNDARY_COLOR, 'line-width': 1.5, 'line-opacity': config.opacity },
  });
  map.addLayer({
    id: `${config.id}-label`,
    type: 'symbol',
    source: sourceId,
    ...layerProp,
    layout: {
      visibility,
      'text-field': ['coalesce', ['get', 'name'], ['get', 'precinct']],
      'text-size': 12,
      'text-font': ['Noto Sans Bold'],
    },
    paint: { 'text-color': '#fde68a', 'text-halo-color': '#000', 'text-halo-width': 1.5 },
  });
}

/**
 * Style layer ids owned by one boundary layer.
 * O(1) time, O(1) space — n = 3 ids.
 */
export function getBoundaryLayerIds(configId: string): string[] {
  return [`${configId}-fill`, `${configId}-stroke`, `${configId}-label`];
}
