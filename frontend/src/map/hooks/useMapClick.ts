import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';

export interface ClickedFeatureInfo {
  clickedFeature: GeoJSON.Feature | null;
  featureType: 'building' | 'poi' | 'zoning' | 'railroad' | 'police_district' | 'ward' | 'gang_territory' | 'federal_property' | 'railroad_row' | null;
  position: { x: number; y: number } | null;
}

/** Layers to query on click, ordered by priority */
const INTERACTIVE_LAYERS = [
  'pois',
  'buildings-fill',
  'buildings-highlight',
  'railroads-active',
  'railroads-abandoned',
  'railroads-disused',
  'railroads-spur',
  'railroads-razed',
  'zoning-fill',
  'police_districts-fill',
  'police_districts-stations',
  'wards-fill',
  'wards-offices',
  'gang_territory-fill',
  'federal_properties-markers',
  'railroad_row-fill',
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
      let featureType: 'building' | 'poi' | 'zoning' | 'railroad' | 'police_district' | 'ward' | 'gang_territory' | 'federal_property' | 'railroad_row' | null = null;

      if (layerId.startsWith('buildings')) {
        featureType = 'building';
      } else if (layerId.startsWith('pois')) {
        featureType = 'poi';
      } else if (layerId.startsWith('railroads')) {
        featureType = 'railroad';
      } else if (layerId.startsWith('zoning')) {
        featureType = 'zoning';
      } else if (layerId.startsWith('police_districts')) {
        featureType = 'police_district';
      } else if (layerId.startsWith('wards')) {
        featureType = 'ward';
      } else if (layerId.startsWith('gang_territory')) {
        featureType = 'gang_territory';
      } else if (layerId.startsWith('federal_properties')) {
        featureType = 'federal_property';
      } else if (layerId.startsWith('railroad_row')) {
        featureType = 'railroad_row';
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
