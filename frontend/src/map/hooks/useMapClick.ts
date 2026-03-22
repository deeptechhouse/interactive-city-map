import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';

export interface ClickedFeatureInfo {
  clickedFeature: GeoJSON.Feature | null;
  featureType: 'building' | 'poi' | null;
  position: { x: number; y: number } | null;
}

/** Layers to query on click, ordered by priority */
const INTERACTIVE_LAYERS = [
  'pois',
  'buildings-fill',
  'buildings-highlight',
];

export function useMapClick(map: maplibregl.Map | null): ClickedFeatureInfo {
  const [clickInfo, setClickInfo] = useState<ClickedFeatureInfo>({
    clickedFeature: null,
    featureType: null,
    position: null,
  });

  const mapRef = useRef(map);
  mapRef.current = map;

  const handleClick = useCallback((e: maplibregl.MapMouseEvent) => {
    const currentMap = mapRef.current;
    if (!currentMap) return;

    // Query features at the click point
    const existingLayers = INTERACTIVE_LAYERS.filter((id) => {
      try {
        return currentMap.getLayer(id);
      } catch {
        return false;
      }
    });

    if (existingLayers.length === 0) {
      setClickInfo({ clickedFeature: null, featureType: null, position: null });
      return;
    }

    const features = currentMap.queryRenderedFeatures(e.point, {
      layers: existingLayers,
    });

    if (features.length > 0) {
      const feature = features[0];
      const layerId = feature.layer?.id ?? '';
      let featureType: 'building' | 'poi' | null = null;

      if (layerId.startsWith('buildings')) {
        featureType = 'building';
      } else if (layerId.startsWith('pois')) {
        featureType = 'poi';
      }

      setClickInfo({
        clickedFeature: feature as unknown as GeoJSON.Feature,
        featureType,
        position: { x: e.point.x, y: e.point.y },
      });
    } else {
      setClickInfo({ clickedFeature: null, featureType: null, position: null });
    }
  }, []);

  useEffect(() => {
    if (!map) return;

    map.on('click', handleClick);
    return () => {
      map.off('click', handleClick);
    };
  }, [map, handleClick]);

  return clickInfo;
}
