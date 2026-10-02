/**
 * Removing a city's data layers from the map when the user switches city.
 *
 * WHY (bug found 2026-10-02, Detroit TDD §13 F-2): MapContainer only ever ADDED layers.
 *   After Chicago → Detroit, Chicago-only layers (wards, gang territory…) stayed drawn and
 *   could no longer be toggled. Worse for shared ids: every layer file guards with
 *   "source already exists → skip", so Detroit's buildings would never replace Chicago's.
 *   On a city switch, every style layer the previous city added — and its sources — must go.
 *
 * TRAP: other features draw on top of city sources (the contact list's selected-building
 *   outline uses 'buildings-source'). MapLibre refuses to remove a source that a layer
 *   still uses, so dependent layers are removed first; their owners re-add them when the
 *   source exists again.
 */
import type maplibregl from 'maplibre-gl';

/**
 * Remove the given style layers, every other style layer that uses the same sources,
 * then those sources. Missing ids are ignored.
 * O(L) time, O(k) space — L = style layers on the map; k = sources removed.
 */
export function removeLayersAndSources(map: maplibregl.Map, layerIds: readonly string[]): void {
  const sources = new Set<string>();
  // O(r) time, O(k) space — r = layer ids requested; k = distinct sources they use
  for (const id of layerIds) {
    const layer = map.getLayer(id);
    if (!layer) continue;
    if ('source' in layer && typeof layer.source === 'string') sources.add(layer.source);
    map.removeLayer(id);
  }
  if (sources.size === 0) return;
  // O(L) time, O(1) space — L = style layers still on the map
  for (const layer of map.getStyle().layers ?? []) {
    if ('source' in layer && typeof layer.source === 'string' && sources.has(layer.source)) {
      map.removeLayer(layer.id);
    }
  }
  // O(k) time, O(1) space — k = sources to drop
  for (const sourceId of sources) {
    if (map.getSource(sourceId)) map.removeSource(sourceId);
  }
}
