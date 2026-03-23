import type maplibregl from 'maplibre-gl';

const SOURCE_PREFIX = 'sanborn-crop-source';
const LAYER_PREFIX = 'sanborn-crop-layer';

export interface SanbornCropConfig {
  /** Unique identifier for this Sanborn crop overlay */
  id: string;
  /** URL of the cropped Sanborn map image */
  imageUrl: string;
  /**
   * Bounding coordinates for the image overlay.
   * Order: [top-left, top-right, bottom-right, bottom-left]
   * Each coordinate is [longitude, latitude].
   */
  coordinates: [
    [number, number],
    [number, number],
    [number, number],
    [number, number],
  ];
  /** Initial opacity (0-1). Default 0.75 */
  opacity?: number;
}

function sourceId(id: string): string {
  return `${SOURCE_PREFIX}-${id}`;
}

function layerId(id: string): string {
  return `${LAYER_PREFIX}-${id}`;
}

/**
 * Add a Sanborn crop raster overlay to the map.
 * Uses MapLibre's image source type to position a historical Sanborn map crop
 * at specific coordinates.
 */
export function addSanbornCropOverlay(
  map: maplibregl.Map,
  config: SanbornCropConfig,
): void {
  const srcId = sourceId(config.id);
  const lyrId = layerId(config.id);

  if (map.getSource(srcId)) return;

  map.addSource(srcId, {
    type: 'image',
    url: config.imageUrl,
    coordinates: config.coordinates,
  });

  map.addLayer({
    id: lyrId,
    type: 'raster',
    source: srcId,
    paint: {
      'raster-opacity': config.opacity ?? 0.75,
    },
  });
}

/**
 * Remove a Sanborn crop overlay from the map.
 */
export function removeSanbornCropOverlay(
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
 * Update the opacity of an existing Sanborn crop overlay.
 */
export function setSanbornCropOpacity(
  map: maplibregl.Map,
  id: string,
  opacity: number,
): void {
  const lyrId = layerId(id);
  try {
    if (map.getLayer(lyrId)) {
      map.setPaintProperty(lyrId, 'raster-opacity', opacity);
    }
  } catch {
    // Layer may not exist
  }
}

/**
 * Get the MapLibre layer IDs for a given Sanborn crop overlay.
 */
export function getSanbornCropLayerIds(id: string): string[] {
  return [layerId(id)];
}
