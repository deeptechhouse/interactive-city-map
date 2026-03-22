/**
 * Custom hook for progressive layer loading based on zoom level.
 *
 * Listens to map zoom changes and shows/hides layers according to the
 * thresholds defined in `performance.ts`.  Also surfaces a performance
 * warning when the estimated visible feature count exceeds a safe limit.
 */

import { useCallback, useEffect, useRef, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import {
  ZOOM_THRESHOLDS,
  estimateFeatureCount,
  shouldSimplifyLayer,
  throttle,
} from '../../utils/performance';
import { boundsToArray } from '../../utils/geoUtils';

/* ------------------------------------------------------------------ */
/*  Types                                                              */
/* ------------------------------------------------------------------ */

export interface ProgressiveLoadingState {
  /** Current rounded zoom level */
  currentZoom: number;
  /** Number of threshold-gated layers currently visible */
  visibleLayerCount: number;
  /** Non-null when estimated feature count suggests the map may lag */
  performanceWarning: string | null;
}

/* ------------------------------------------------------------------ */
/*  Internal helpers                                                   */
/* ------------------------------------------------------------------ */

/** Map from threshold key to the MapLibre layer IDs it governs. */
const THRESHOLD_LAYER_MAP: Record<
  keyof typeof ZOOM_THRESHOLDS,
  string[]
> = {
  pois: ['pois'],
  buildings: ['buildings-fill', 'buildings-outline', 'buildings-highlight'],
  parcels: ['parks-fill', 'parks-outline'],
  buildingLabels: ['buildings-label'],
  stationNames: ['transit-stations-label'],
};

/** Feature-count above which the warning fires */
const WARNING_THRESHOLD = 80_000;

/* ------------------------------------------------------------------ */
/*  Hook                                                               */
/* ------------------------------------------------------------------ */

export function useProgressiveLoading(
  map: maplibregl.Map | null,
): ProgressiveLoadingState {
  const [state, setState] = useState<ProgressiveLoadingState>({
    currentZoom: 0,
    visibleLayerCount: 0,
    performanceWarning: null,
  });

  const mapRef = useRef(map);
  mapRef.current = map;

  /** Re-evaluate which threshold-gated layers should be visible. */
  const evaluate = useCallback(() => {
    const currentMap = mapRef.current;
    if (!currentMap) return;

    const zoom = currentMap.getZoom();
    const roundedZoom = Math.round(zoom * 10) / 10;

    let visibleCount = 0;

    // Show / hide layers according to thresholds
    for (const [key, minZoom] of Object.entries(ZOOM_THRESHOLDS)) {
      const layerIds =
        THRESHOLD_LAYER_MAP[key as keyof typeof ZOOM_THRESHOLDS] ?? [];
      const shouldBeVisible = zoom >= minZoom;

      for (const layerId of layerIds) {
        try {
          if (!currentMap.getLayer(layerId)) continue;
          currentMap.setLayoutProperty(
            layerId,
            'visibility',
            shouldBeVisible ? 'visible' : 'none',
          );
        } catch {
          // Layer not yet added — ignore
        }
      }

      if (shouldBeVisible) {
        visibleCount += layerIds.length;
      }
    }

    // Estimate feature count for performance warning
    let warning: string | null = null;
    try {
      const bounds = boundsToArray(currentMap.getBounds());
      const estimate = estimateFeatureCount(bounds, zoom);
      if (shouldSimplifyLayer(zoom, estimate) || estimate > WARNING_THRESHOLD) {
        warning = `High feature density (~${Math.round(estimate / 1000)}k features). Consider zooming in for better performance.`;
      }
    } catch {
      // getBounds can throw if the map is not fully initialised
    }

    setState({
      currentZoom: roundedZoom,
      visibleLayerCount: visibleCount,
      performanceWarning: warning,
    });
  }, []);

  useEffect(() => {
    if (!map) return;

    // Throttle to at most once per 150 ms during continuous zoom
    const throttledEvaluate = throttle(evaluate, 150);

    map.on('zoomend', evaluate);
    map.on('zoom', throttledEvaluate);

    // Run once immediately so initial state is correct
    evaluate();

    return () => {
      map.off('zoomend', evaluate);
      map.off('zoom', throttledEvaluate);
    };
  }, [map, evaluate]);

  return state;
}
