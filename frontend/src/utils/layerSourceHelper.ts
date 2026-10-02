import type maplibregl from 'maplibre-gl';
import { IS_STATIC } from './staticMode';

/**
 * Add a source that works in both dev mode (vector tiles) and static mode (GeoJSON).
 * In dev mode, uses the Martin tile URL. In static mode, falls back to embedded GeoJSON.
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
    type: tileUrl.startsWith('pmtiles://') ? 'vector' : 'vector',
    ...(tileUrl.startsWith('pmtiles://') ? { url: tileUrl } : { tiles: [tileUrl] }),
    minzoom: 0,
    maxzoom: 16,
  });
  return { isGeoJson: false };
}

/**
 * Returns the source-layer property for vector tile sources, or empty object for GeoJSON.
 */
export function sourceLayerProp(sourceLayer: string, isGeoJson: boolean): Record<string, string> {
  return isGeoJson ? {} : { 'source-layer': sourceLayer };
}
