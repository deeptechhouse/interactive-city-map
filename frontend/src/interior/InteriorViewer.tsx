import React, { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { centroid } from '@turf/turf';
import type maplibregl from 'maplibre-gl';
import { THEME } from '../utils/colorSchemes';
import type { InteriorRoom, InteriorSource, InteriorWall, InteriorFeature } from '../api/interior';
import { useInteriorData } from './hooks/useInteriorData';
import { useFloorLevel } from './hooks/useFloorLevel';
import { FloorSelector } from './FloorSelector';
import { SourceSelector } from './SourceSelector';
import { SourceAttribution } from './SourceAttribution';
import { RoomInfoPopup } from './RoomInfoPopup';
import {
  addInteriorVectorLayers,
  removeInteriorVectorLayers,
} from './layers/InteriorVectorLayer';
import {
  addInteriorRasterOverlay,
  removeInteriorRasterOverlay,
} from './layers/InteriorRasterLayer';
import {
  addInteriorLabelLayer,
  removeInteriorLabelLayer,
} from './layers/InteriorLabelLayer';

interface InteriorViewerProps {
  buildingId: string;
  mapInstance: maplibregl.Map | null;
  onClose: () => void;
}

const VECTOR_LAYER_ID = 'interior-main';
const LABEL_LAYER_ID = 'interior-labels';
const RASTER_LAYER_ID = 'interior-raster';
const ROOMS_FILL_CLICK_LAYER = 'interior-vector-rooms-fill-interior-main';

function toRoomsGeoJson(rooms: InteriorRoom[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: rooms
      .filter((r) => r.geom != null)
      .map((r) => ({
        type: 'Feature' as const,
        geometry: r.geom!,
        properties: {
          id: r.id,
          room_type: r.room_type ?? 'unknown',
          name: r.name,
          area_sqm: r.area_sqm,
          capacity: r.capacity,
          level: r.level,
        },
      })),
  };
}

function toWallsGeoJson(walls: InteriorWall[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: walls
      .filter((w) => w.geom != null)
      .map((w) => ({
        type: 'Feature' as const,
        geometry: w.geom!,
        properties: {
          id: w.id,
          wall_type: w.wall_type,
          material: w.material,
          thickness_m: w.thickness_m,
        },
      })),
  };
}

function toFeaturesGeoJson(features: InteriorFeature[]): GeoJSON.FeatureCollection {
  return {
    type: 'FeatureCollection',
    features: features
      .filter((f) => f.geom != null)
      .map((f) => ({
        type: 'Feature' as const,
        geometry: f.geom!,
        properties: {
          id: f.id,
          feature_type: f.feature_type,
          name: f.name,
        },
      })),
  };
}

function toLabelsGeoJson(rooms: InteriorRoom[]): GeoJSON.FeatureCollection {
  const labelFeatures: GeoJSON.Feature[] = [];

  for (const room of rooms) {
    if (!room.geom) continue;
    try {
      const center = centroid({
        type: 'Feature',
        geometry: room.geom,
        properties: {},
      });
      center.properties = {
        name: room.name,
        room_type: room.room_type,
      };
      labelFeatures.push(center);
    } catch {
      // Skip rooms where centroid computation fails
    }
  }

  return {
    type: 'FeatureCollection',
    features: labelFeatures,
  };
}

export const InteriorViewer: React.FC<InteriorViewerProps> = ({
  buildingId,
  mapInstance,
  onClose,
}) => {
  const { sources, rooms, walls, features, summary, loading, error, refetch } =
    useInteriorData(buildingId);
  const { currentLevel, availableLevels, levelName, setLevel } =
    useFloorLevel(rooms);

  const [selectedSourceId, setSelectedSourceId] = useState<string | null>(null);
  const [clickedRoom, setClickedRoom] = useState<{
    room: InteriorRoom;
    position: { x: number; y: number };
  } | null>(null);

  const vectorLayerAdded = useRef(false);
  const labelLayerAdded = useRef(false);
  const rasterLayerAdded = useRef(false);

  // Auto-select first source when sources load
  useEffect(() => {
    if (sources.length > 0 && selectedSourceId === null) {
      setSelectedSourceId(sources[0].id);
    }
  }, [sources, selectedSourceId]);

  // Zoom to building when rooms load
  useEffect(() => {
    if (!mapInstance || rooms.length === 0) return;

    // Compute bounding box of all room geometries
    let minLng = Infinity, minLat = Infinity, maxLng = -Infinity, maxLat = -Infinity;
    for (const room of rooms) {
      if (!room.geom || room.geom.type !== 'Polygon') continue;
      for (const ring of (room.geom as GeoJSON.Polygon).coordinates) {
        for (const [lng, lat] of ring) {
          if (lng < minLng) minLng = lng;
          if (lat < minLat) minLat = lat;
          if (lng > maxLng) maxLng = lng;
          if (lat > maxLat) maxLat = lat;
        }
      }
    }

    if (minLng === Infinity) return;

    // Add padding and fly to the building
    const padding = 0.0003; // ~30m
    mapInstance.fitBounds(
      [[minLng - padding, minLat - padding], [maxLng + padding, maxLat + padding]],
      { duration: 1000, maxZoom: 19, padding: { top: 80, bottom: 40, left: 40, right: 40 } },
    );
  }, [mapInstance, rooms.length > 0 ? buildingId : null]); // Only trigger once per building

  // Filter by current level
  const levelRooms = useMemo(
    () => rooms.filter((r) => r.level === currentLevel),
    [rooms, currentLevel],
  );
  const levelWalls = useMemo(
    () => walls.filter((w) => w.level === currentLevel),
    [walls, currentLevel],
  );
  const levelFeatures = useMemo(
    () => features.filter((f) => f.level === currentLevel),
    [features, currentLevel],
  );

  // Convert to GeoJSON
  const roomsGeoJson = useMemo(() => toRoomsGeoJson(levelRooms), [levelRooms]);
  const wallsGeoJson = useMemo(() => toWallsGeoJson(levelWalls), [levelWalls]);
  const featuresGeoJson = useMemo(
    () => toFeaturesGeoJson(levelFeatures),
    [levelFeatures],
  );
  const labelsGeoJson = useMemo(
    () => toLabelsGeoJson(levelRooms),
    [levelRooms],
  );

  // Add/update vector layers
  useEffect(() => {
    if (!mapInstance) return;

    // Remove existing layers first to update data
    if (vectorLayerAdded.current) {
      removeInteriorVectorLayers(mapInstance, VECTOR_LAYER_ID);
      vectorLayerAdded.current = false;
    }

    if (roomsGeoJson.features.length === 0 && wallsGeoJson.features.length === 0) {
      return;
    }

    addInteriorVectorLayers(mapInstance, {
      id: VECTOR_LAYER_ID,
      roomsGeoJson,
      wallsGeoJson,
      featuresGeoJson,
      opacity: 0.75,
    });
    vectorLayerAdded.current = true;
  }, [mapInstance, roomsGeoJson, wallsGeoJson, featuresGeoJson]);

  // Add/update label layers
  useEffect(() => {
    if (!mapInstance) return;

    if (labelLayerAdded.current) {
      removeInteriorLabelLayer(mapInstance, LABEL_LAYER_ID);
      labelLayerAdded.current = false;
    }

    if (labelsGeoJson.features.length === 0) return;

    addInteriorLabelLayer(mapInstance, {
      id: LABEL_LAYER_ID,
      labelsGeoJson,
      minZoom: 15,
    });
    labelLayerAdded.current = true;
  }, [mapInstance, labelsGeoJson]);

  // Selected source for raster overlay
  const selectedSource = useMemo<InteriorSource | null>(
    () => sources.find((s) => s.id === selectedSourceId) ?? null,
    [sources, selectedSourceId],
  );

  // Raster overlay for selected source
  useEffect(() => {
    if (!mapInstance) return;

    if (rasterLayerAdded.current) {
      removeInteriorRasterOverlay(mapInstance, RASTER_LAYER_ID);
      rasterLayerAdded.current = false;
    }

    if (!selectedSource?.raster_url) return;

    // Extract coordinates from the source raw_data if available
    const rawCoords = selectedSource.raw_data?.coordinates as
      | [[number, number], [number, number], [number, number], [number, number]]
      | undefined;

    if (!rawCoords) return;

    addInteriorRasterOverlay(mapInstance, {
      id: RASTER_LAYER_ID,
      imageUrl: selectedSource.raster_url,
      coordinates: rawCoords,
      opacity: 0.6,
    });
    rasterLayerAdded.current = true;
  }, [mapInstance, selectedSource]);

  // Room click handler
  useEffect(() => {
    if (!mapInstance) return;

    const handleRoomClick = (e: maplibregl.MapMouseEvent & { features?: maplibregl.MapGeoJSONFeature[] }) => {
      if (!e.features || e.features.length === 0) return;

      const feature = e.features[0];
      const props = feature.properties;
      const roomId = props?.id as string;
      const matchedRoom = levelRooms.find((r) => r.id === roomId);

      if (!matchedRoom) return;

      setClickedRoom({
        room: matchedRoom,
        position: { x: e.point.x, y: e.point.y },
      });
    };

    const layerId = ROOMS_FILL_CLICK_LAYER;

    // Only attach handler if the layer exists
    if (mapInstance.getLayer(layerId)) {
      mapInstance.on('click', layerId, handleRoomClick);

      // Change cursor to pointer on hover
      mapInstance.on('mouseenter', layerId, () => {
        mapInstance.getCanvas().style.cursor = 'pointer';
      });
      mapInstance.on('mouseleave', layerId, () => {
        mapInstance.getCanvas().style.cursor = '';
      });
    }

    return () => {
      if (mapInstance.getLayer(layerId)) {
        mapInstance.off('click', layerId, handleRoomClick);
        mapInstance.on('mouseenter', layerId, () => {
          mapInstance.getCanvas().style.cursor = '';
        });
      }
    };
  }, [mapInstance, levelRooms]);

  // Cleanup all layers on unmount
  useEffect(() => {
    return () => {
      if (!mapInstance) return;
      if (vectorLayerAdded.current) {
        removeInteriorVectorLayers(mapInstance, VECTOR_LAYER_ID);
        vectorLayerAdded.current = false;
      }
      if (labelLayerAdded.current) {
        removeInteriorLabelLayer(mapInstance, LABEL_LAYER_ID);
        labelLayerAdded.current = false;
      }
      if (rasterLayerAdded.current) {
        removeInteriorRasterOverlay(mapInstance, RASTER_LAYER_ID);
        rasterLayerAdded.current = false;
      }
    };
  }, [mapInstance]);

  return (
    <div style={styles.container}>
      {/* Header bar */}
      <div style={styles.header}>
        <button style={styles.backBtn} onClick={onClose}>
          &larr; Back to Map
        </button>
        <span style={styles.title}>Interior View</span>
        {summary && (
          <span style={styles.stats}>
            {summary.room_count} rooms &middot; {summary.source_count} sources
          </span>
        )}
      </div>

      {/* Source selector bar */}
      {sources.length > 0 && (
        <SourceSelector
          sources={sources}
          selectedSourceId={selectedSourceId}
          onSourceChange={setSelectedSourceId}
        />
      )}

      {/* Source attribution */}
      {selectedSource && (
        <div style={styles.attributionBar}>
          <SourceAttribution
            sourceType={selectedSource.source_type}
            sourceDate={selectedSource.source_date}
            confidence={selectedSource.confidence}
            sourceUrl={selectedSource.source_url}
          />
        </div>
      )}

      {/* Floor selector (absolute positioned on left) */}
      {availableLevels.length > 1 && (
        <FloorSelector
          levels={availableLevels}
          selectedLevel={currentLevel}
          onLevelChange={setLevel}
        />
      )}

      {/* Room info popup */}
      {clickedRoom && (
        <RoomInfoPopup
          room={clickedRoom.room}
          position={clickedRoom.position}
          onClose={() => setClickedRoom(null)}
        />
      )}

      {/* Interior photos panel */}
      {selectedSource?.raw_data && (selectedSource.raw_data as Record<string, unknown>)?.interior_photos && (
        <div style={styles.photosPanel}>
          <div style={{ fontSize: '12px', fontWeight: 600, color: THEME.text, marginBottom: '8px' }}>
            Interior Photos
          </div>
          <div style={{ display: 'flex', gap: '6px', overflowX: 'auto', paddingBottom: '4px' }}>
            {((selectedSource.raw_data as Record<string, unknown>).interior_photos as Array<{url: string; alt: string}>).slice(0, 8).map((photo, i) => (
              <a key={i} href={photo.url} target="_blank" rel="noopener noreferrer" title={photo.alt || 'Interior photo'}>
                <img
                  src={photo.url}
                  alt={photo.alt || 'Interior photo'}
                  style={{
                    width: '100px',
                    height: '75px',
                    objectFit: 'cover',
                    borderRadius: '4px',
                    border: `1px solid ${THEME.border}`,
                    cursor: 'pointer',
                  }}
                  onError={(e) => { (e.target as HTMLImageElement).style.display = 'none'; }}
                />
              </a>
            ))}
          </div>
        </div>
      )}

      {/* Loading state */}
      {loading && <div style={styles.loadingOverlay}>Loading interior data...</div>}

      {/* Error state */}
      {error && <div style={styles.errorOverlay}>{error}</div>}
    </div>
  );
};

const styles = {
  container: {
    position: 'absolute' as const,
    top: 0,
    left: 0,
    right: 0,
    bottom: 0,
    pointerEvents: 'none' as const,
    zIndex: 40,
  },
  header: {
    pointerEvents: 'auto' as const,
    position: 'absolute' as const,
    top: '12px',
    left: '50%',
    transform: 'translateX(-50%)',
    display: 'flex',
    alignItems: 'center',
    gap: '12px',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '8px 16px',
    boxShadow: '0 4px 12px rgba(0,0,0,0.4)',
    zIndex: 50,
  },
  backBtn: {
    background: 'none',
    border: `1px solid ${THEME.border}`,
    borderRadius: '4px',
    color: THEME.textMuted,
    fontSize: '13px',
    cursor: 'pointer',
    padding: '4px 10px',
    transition: 'color 0.15s',
  },
  title: {
    fontSize: '14px',
    fontWeight: 600 as const,
    color: THEME.text,
  },
  stats: {
    fontSize: '12px',
    color: THEME.textMuted,
  },
  attributionBar: {
    pointerEvents: 'auto' as const,
    position: 'absolute' as const,
    top: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '6px',
    padding: '0 12px',
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    zIndex: 50,
  },
  photosPanel: {
    pointerEvents: 'auto' as const,
    position: 'absolute' as const,
    bottom: '60px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '8px',
    padding: '10px 14px',
    boxShadow: '0 2px 12px rgba(0,0,0,0.4)',
    zIndex: 50,
    maxWidth: '90vw',
  },
  loadingOverlay: {
    pointerEvents: 'auto' as const,
    position: 'absolute' as const,
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.border}`,
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    color: THEME.textMuted,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    zIndex: 50,
  },
  errorOverlay: {
    pointerEvents: 'auto' as const,
    position: 'absolute' as const,
    bottom: '24px',
    left: '50%',
    transform: 'translateX(-50%)',
    background: THEME.bgSecondary,
    border: `1px solid ${THEME.danger}`,
    borderRadius: '6px',
    padding: '8px 16px',
    fontSize: '13px',
    color: THEME.danger,
    boxShadow: '0 2px 8px rgba(0,0,0,0.3)',
    zIndex: 50,
  },
} as const;
