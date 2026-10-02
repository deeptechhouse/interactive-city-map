import type maplibregl from 'maplibre-gl';
import { IS_STATIC } from './staticMode';

/**
 * Add a source that works in both dev mode (vector tiles) and static mode (GeoJSON).
 * In dev mode, uses the Martin tile URL. In static mode, falls back to embedded GeoJSON.
 * O(1) time, O(1) space — n = 1 source added (the GeoJSON object is passed by reference).
 */
export function addDualModeSource(
  map: maplibregl.Map,
  sourceId: string,
  tileUrl: string,
  sourceLayer: string,
  staticGeoJson?: GeoJSON.FeatureCollection,
): { isGeoJson: boolean } {
  if (map.getSource(sourceId)) return { isGeoJson: IS_STATIC && !tileUrl };

  if (IS_STATIC && !tileUrl && staticGeoJson) {
    map.addSource(sourceId, { type: 'geojson', data: staticGeoJson });
    return { isGeoJson: true };
  }

  map.addSource(sourceId, {
    type: 'vector',
    ...vectorSourceSpec(tileUrl),
  });
  return { isGeoJson: false };
}

/**
 * Vector source spec for a tile URL: PMTiles archives are opened by `url` (the pmtiles://
 * protocol reads the archive header); Martin XYZ templates go in `tiles`. Using `tiles`
 * for a pmtiles:// URL silently loads nothing — every per-city static layer is PMTiles.
 * O(1) time, O(1) space — n = 1 spec object.
 */
export function vectorSourceSpec(
  tileUrl: string,
): { url: string } | { tiles: string[]; minzoom: number; maxzoom: number } {
  // PMTiles: NO explicit zooms — the archive header sets them. TRAP (2026-10-02): a
  // hard-coded maxzoom 16 made MapLibre request z15/z16 tiles from archives that stop at
  // z14/z15 (most Detroit/Dayton layers), so those layers vanished when zoomed in instead
  // of overzooming. Chicago's archives all stop at z16, so Chicago is unchanged.
  return tileUrl.startsWith('pmtiles://')
    ? { url: tileUrl }
    : { tiles: [tileUrl], minzoom: 0, maxzoom: 16 }; // Martin serves z0–16
}

/**
 * Returns the source-layer property for vector tile sources, or empty object for GeoJSON.
 * O(1) time, O(1) space — n = 1 property.
 */
export function sourceLayerProp(sourceLayer: string, isGeoJson: boolean): Record<string, string> {
  return isGeoJson ? {} : { 'source-layer': sourceLayer };
}
