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
    minzoom: 0,
    maxzoom: 16,
  });
  return { isGeoJson: false };
}

/**
 * Vector source spec for a tile URL: PMTiles archives are opened by `url` (the pmtiles://
 * protocol reads the archive header); Martin XYZ templates go in `tiles`. Using `tiles`
 * for a pmtiles:// URL silently loads nothing — every per-city static layer is PMTiles.
 * O(1) time, O(1) space — n = 1 spec object.
 */
export function vectorSourceSpec(tileUrl: string): { url: string } | { tiles: string[] } {
  return tileUrl.startsWith('pmtiles://') ? { url: tileUrl } : { tiles: [tileUrl] };
}

/**
 * Returns the source-layer property for vector tile sources, or empty object for GeoJSON.
 * O(1) time, O(1) space — n = 1 property.
 */
export function sourceLayerProp(sourceLayer: string, isGeoJson: boolean): Record<string, string> {
  return isGeoJson ? {} : { 'source-layer': sourceLayer };
}
