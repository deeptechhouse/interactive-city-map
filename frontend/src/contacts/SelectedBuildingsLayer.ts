/**
 * Outline for buildings in the contact list, drawn on the existing buildings tile
 * source (layers/BuildingLayer.ts) by filtering on building ``id``.
 *
 * Kept above the focus mask (moved to top on every update) so a chosen building is never
 * hidden by the gray-out — even one outside the current focus area.
 */
import type maplibregl from 'maplibre-gl';

const BUILDINGS_SOURCE = 'buildings-source'; // owned by BuildingLayer.ts
const FILL_ID = 'buildings-selected-fill';
const LINE_ID = 'buildings-selected-line';
const SELECTED_COLOR = '#f0b429'; // amber: distinct from the blue hover + focus outline

/** Filter matching the given ids. O(n) time, O(n) space — n = selected ids. */
function idFilter(ids: readonly string[]): maplibregl.FilterSpecification {
  return ['in', ['get', 'id'], ['literal', [...ids]]] as unknown as maplibregl.FilterSpecification;
}

/** Show outlines for ``ids``. No-op until the buildings layer has created its source. */
// Assumes MapLibre's filter compile/validate is linear in the literal (not verified).
// O(n) time, O(n) space — n = selected ids
export function setSelectedBuildings(map: maplibregl.Map, ids: readonly string[]): void {
  if (!map.getSource(BUILDINGS_SOURCE)) return;
  if (!map.getLayer(FILL_ID)) {
    map.addLayer({
      id: FILL_ID,
      type: 'fill',
      source: BUILDINGS_SOURCE,
      'source-layer': 'buildings',
      filter: idFilter(ids),
      paint: { 'fill-color': SELECTED_COLOR, 'fill-opacity': 0.35 },
    });
    map.addLayer({
      id: LINE_ID,
      type: 'line',
      source: BUILDINGS_SOURCE,
      'source-layer': 'buildings',
      filter: idFilter(ids),
      paint: { 'line-color': SELECTED_COLOR, 'line-width': 2.5 },
    });
  } else {
    map.setFilter(FILL_ID, idFilter(ids));
    map.setFilter(LINE_ID, idFilter(ids));
  }
  map.moveLayer(FILL_ID);
  map.moveLayer(LINE_ID);
}
