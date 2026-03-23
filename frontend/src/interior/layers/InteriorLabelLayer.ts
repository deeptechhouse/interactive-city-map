import type maplibregl from 'maplibre-gl';

const SOURCE_PREFIX = 'interior-label-source';
const LAYER_PREFIX = 'interior-label';

export interface InteriorLabelConfig {
  /** Unique identifier for this interior label layer */
  id: string;
  /** GeoJSON FeatureCollection of points at room centroids with name/room_type properties */
  labelsGeoJson: GeoJSON.FeatureCollection;
  /** Minimum zoom level at which labels appear. Default 17 */
  minZoom?: number;
}

function sourceId(id: string): string {
  return `${SOURCE_PREFIX}-${id}`;
}

function layerId(id: string): string {
  return `${LAYER_PREFIX}-${id}`;
}

/**
 * Add an interior label layer to the map.
 * Displays room name/type labels at room centroid points using a symbol layer.
 */
export function addInteriorLabelLayer(
  map: maplibregl.Map,
  config: InteriorLabelConfig,
): void {
  const srcId = sourceId(config.id);
  const lyrId = layerId(config.id);

  if (map.getSource(srcId)) return;

  map.addSource(srcId, {
    type: 'geojson',
    data: config.labelsGeoJson,
  });

  map.addLayer({
    id: lyrId,
    type: 'symbol',
    source: srcId,
    minzoom: config.minZoom ?? 17,
    layout: {
      'text-field': ['coalesce', ['get', 'name'], ['get', 'room_type']],
      'text-size': 11,
      'text-anchor': 'center',
      'text-allow-overlap': false,
      'text-ignore-placement': false,
    },
    paint: {
      'text-color': '#c9d1d9',
      'text-halo-color': '#0d1117',
      'text-halo-width': 1,
    },
  });
}

/**
 * Remove an interior label layer from the map.
 */
export function removeInteriorLabelLayer(
  map: maplibregl.Map,
  id: string,
): void {
  const lyrId = layerId(id);
  const srcId = sourceId(id);

  try {
    if (map.getLayer(lyrId)) {
      map.removeLayer(lyrId);
    }
    if (map.getSource(srcId)) {
      map.removeSource(srcId);
    }
  } catch {
    // Layer or source may already be removed
  }
}

/**
 * Get the MapLibre layer IDs for a given interior label layer.
 */
export function getInteriorLabelLayerIds(id: string): string[] {
  return [layerId(id)];
}
