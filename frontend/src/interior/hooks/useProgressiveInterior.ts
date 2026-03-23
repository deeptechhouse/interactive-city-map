import { useState, useEffect, useCallback } from 'react';

interface UseProgressiveInteriorResult {
  shouldLoadInterior: boolean;
  interiorZoomThreshold: number;
}

const INTERIOR_ZOOM_THRESHOLD = 17;

export function useProgressiveInterior(
  mapInstance: maplibregl.Map | null,
  buildingSelected: boolean,
): UseProgressiveInteriorResult {
  const [zoomAboveThreshold, setZoomAboveThreshold] = useState(false);

  const checkZoom = useCallback(() => {
    if (!mapInstance) return;
    setZoomAboveThreshold(mapInstance.getZoom() >= INTERIOR_ZOOM_THRESHOLD);
  }, [mapInstance]);

  useEffect(() => {
    if (!mapInstance) return;

    checkZoom();

    mapInstance.on('zoomend', checkZoom);
    return () => {
      mapInstance.off('zoomend', checkZoom);
    };
  }, [mapInstance, checkZoom]);

  return {
    shouldLoadInterior: buildingSelected && zoomAboveThreshold,
    interiorZoomThreshold: INTERIOR_ZOOM_THRESHOLD,
  };
}
