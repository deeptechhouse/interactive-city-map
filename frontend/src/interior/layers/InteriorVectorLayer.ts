import type maplibregl from 'maplibre-gl';

const SOURCE_PREFIX = 'interior-vector-source';
const LAYER_PREFIX = 'interior-vector';

export interface InteriorVectorConfig {
  /** Unique identifier for this interior vector layer set */
  id: string;
  /** GeoJSON FeatureCollection of room polygons with room_type property */
  roomsGeoJson: GeoJSON.FeatureCollection;
  /** GeoJSON FeatureCollection of wall lines */
  wallsGeoJson: GeoJSON.FeatureCollection;
  /** GeoJSON FeatureCollection of interior feature points (doors, stairs, fixtures) */
  featuresGeoJson: GeoJSON.FeatureCollection;
  /** Initial opacity (0-1). Default 0.75 */
  opacity?: number;
}

function roomsSourceId(id: string): string {
  return `${SOURCE_PREFIX}-rooms-${id}`;
}

function wallsSourceId(id: string): string {
  return `${SOURCE_PREFIX}-walls-${id}`;
}

function featuresSourceId(id: string): string {
  return `${SOURCE_PREFIX}-features-${id}`;
}

function roomsFillLayerId(id: string): string {
  return `${LAYER_PREFIX}-rooms-fill-${id}`;
}

function roomsStrokeLayerId(id: string): string {
  return `${LAYER_PREFIX}-rooms-stroke-${id}`;
}

function wallsLayerId(id: string): string {
  return `${LAYER_PREFIX}-walls-${id}`;
}

function featuresLayerId(id: string): string {
  return `${LAYER_PREFIX}-features-${id}`;
}

/**
 * Data-driven color expression mapping room_type to fill color.
 */
const ROOM_TYPE_COLOR_EXPRESSION: maplibregl.ExpressionSpecification = [
  'match',
  ['get', 'room_type'],
  'bedroom', '#6366f1',
  'bathroom', '#06b6d4',
  'kitchen', '#f59e0b',
  'living', '#10b981',
  'dining', '#8b5cf6',
  'office', '#3b82f6',
  'closet', '#6b7280',
  'hallway', '#9ca3af',
  'lobby', '#14b8a6',
  'ballroom', '#ec4899',
  'conference', '#f97316',
  'storage', '#a3a3a3',
  'restroom', '#22d3ee',
  '#64748b',
];

/**
 * Add interior vector layers (rooms, walls, features) to the map.
 * Creates 3 GeoJSON sources and 4 layers: rooms fill, rooms stroke, walls, features.
 */
export function addInteriorVectorLayers(
  map: maplibregl.Map,
  config: InteriorVectorConfig,
): void {
  const rmSrcId = roomsSourceId(config.id);

  // Idempotent: if rooms source already exists, assume all layers are added
  if (map.getSource(rmSrcId)) return;

  const baseOpacity = config.opacity ?? 0.75;

  // --- Rooms source + layers ---
  map.addSource(rmSrcId, {
    type: 'geojson',
    data: config.roomsGeoJson,
  });

  map.addLayer({
    id: roomsFillLayerId(config.id),
    type: 'fill',
    source: rmSrcId,
    paint: {
      'fill-color': ROOM_TYPE_COLOR_EXPRESSION,
      'fill-opacity': baseOpacity * 0.6,
    },
  });

  map.addLayer({
    id: roomsStrokeLayerId(config.id),
    type: 'line',
    source: rmSrcId,
    paint: {
      'line-color': '#94a3b8',
      'line-width': 1,
      'line-opacity': baseOpacity,
    },
  });

  // --- Walls source + layer ---
  const wlSrcId = wallsSourceId(config.id);

  map.addSource(wlSrcId, {
    type: 'geojson',
    data: config.wallsGeoJson,
  });

  map.addLayer({
    id: wallsLayerId(config.id),
    type: 'line',
    source: wlSrcId,
    paint: {
      'line-color': '#374151',
      'line-width': 2,
      'line-opacity': baseOpacity,
    },
  });

  // --- Features source + layer ---
  const ftSrcId = featuresSourceId(config.id);

  map.addSource(ftSrcId, {
    type: 'geojson',
    data: config.featuresGeoJson,
  });

  map.addLayer({
    id: featuresLayerId(config.id),
    type: 'circle',
    source: ftSrcId,
    paint: {
      'circle-color': '#f59e0b',
      'circle-radius': 6,
      'circle-opacity': baseOpacity,
      'circle-stroke-color': '#ffffff',
      'circle-stroke-width': 1,
    },
  });
}

/**
 * Remove all interior vector layers and sources from the map.
 */
export function removeInteriorVectorLayers(
  map: maplibregl.Map,
  id: string,
): void {
  const layerIds = [
    featuresLayerId(id),
    wallsLayerId(id),
    roomsStrokeLayerId(id),
    roomsFillLayerId(id),
  ];
  const sourceIds = [
    featuresSourceId(id),
    wallsSourceId(id),
    roomsSourceId(id),
  ];

  try {
    for (const lyrId of layerIds) {
      if (map.getLayer(lyrId)) {
        map.removeLayer(lyrId);
      }
    }
    for (const srcId of sourceIds) {
      if (map.getSource(srcId)) {
        map.removeSource(srcId);
      }
    }
  } catch {
    // Layers or sources may already be removed
  }
}

/**
 * Update the opacity of all interior vector layers.
 */
export function setInteriorVectorOpacity(
  map: maplibregl.Map,
  id: string,
  opacity: number,
): void {
  try {
    const rmFill = roomsFillLayerId(id);
    if (map.getLayer(rmFill)) {
      map.setPaintProperty(rmFill, 'fill-opacity', opacity * 0.6);
    }

    const rmStroke = roomsStrokeLayerId(id);
    if (map.getLayer(rmStroke)) {
      map.setPaintProperty(rmStroke, 'line-opacity', opacity);
    }

    const wl = wallsLayerId(id);
    if (map.getLayer(wl)) {
      map.setPaintProperty(wl, 'line-opacity', opacity);
    }

    const ft = featuresLayerId(id);
    if (map.getLayer(ft)) {
      map.setPaintProperty(ft, 'circle-opacity', opacity);
    }
  } catch {
    // Layers may not exist
  }
}

/**
 * Get all MapLibre layer IDs for a given interior vector layer set.
 */
export function getInteriorVectorLayerIds(id: string): string[] {
  return [
    roomsFillLayerId(id),
    roomsStrokeLayerId(id),
    wallsLayerId(id),
    featuresLayerId(id),
  ];
}
