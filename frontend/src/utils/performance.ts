/**
 * Performance utilities for the interactive city map.
 *
 * Provides debounce/throttle helpers, tile-load tracking, progressive
 * layer-loading zoom thresholds, and heuristics for deciding when to
 * simplify heavy layers.
 */

/* ------------------------------------------------------------------ */
/*  Debounce / Throttle                                               */
/* ------------------------------------------------------------------ */

/**
 * Returns a debounced version of `fn` that delays invocation until
 * `ms` milliseconds have elapsed since the last call.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function debounce<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): T {
  let timer: ReturnType<typeof setTimeout> | null = null;

  const debounced = (...args: Parameters<T>) => {
    if (timer !== null) {
      clearTimeout(timer);
    }
    timer = setTimeout(() => {
      fn(...args);
      timer = null;
    }, ms);
  };

  return debounced as unknown as T;
}

/**
 * Returns a throttled version of `fn` that invokes at most once
 * every `ms` milliseconds.  The first call fires immediately;
 * subsequent calls within the window are dropped.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any
export function throttle<T extends (...args: any[]) => void>(
  fn: T,
  ms: number,
): T {
  let lastCall = 0;
  let timer: ReturnType<typeof setTimeout> | null = null;

  const throttled = (...args: Parameters<T>) => {
    const now = Date.now();
    const remaining = ms - (now - lastCall);

    if (remaining <= 0) {
      if (timer !== null) {
        clearTimeout(timer);
        timer = null;
      }
      lastCall = now;
      fn(...args);
    } else if (timer === null) {
      timer = setTimeout(() => {
        lastCall = Date.now();
        timer = null;
        fn(...args);
      }, remaining);
    }
  };

  return throttled as unknown as T;
}

/* ------------------------------------------------------------------ */
/*  Tile Load Tracker                                                  */
/* ------------------------------------------------------------------ */

export interface TileLoadState {
  /** Number of tiles currently being fetched */
  pending: number;
  /** Whether any tiles are still loading */
  isLoading: boolean;
}

export interface TileLoadTracker {
  /** Call when a tile request starts */
  tileLoadStart: () => void;
  /** Call when a tile request finishes (success or error) */
  tileLoadEnd: () => void;
  /** Subscribe to state changes; returns an unsubscribe function */
  subscribe: (listener: (state: TileLoadState) => void) => () => void;
  /** Get current state snapshot */
  getState: () => TileLoadState;
}

/**
 * Creates a tracker that counts in-flight tile loads so the UI can
 * show a loading indicator.
 */
export function createTileLoadTracker(): TileLoadTracker {
  let pending = 0;
  const listeners = new Set<(state: TileLoadState) => void>();

  function snapshot(): TileLoadState {
    return { pending, isLoading: pending > 0 };
  }

  function notify() {
    const state = snapshot();
    for (const listener of listeners) {
      listener(state);
    }
  }

  return {
    tileLoadStart() {
      pending += 1;
      notify();
    },
    tileLoadEnd() {
      pending = Math.max(0, pending - 1);
      notify();
    },
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getState: snapshot,
  };
}

/* ------------------------------------------------------------------ */
/*  Progressive Layer Loading — Zoom Thresholds                        */
/* ------------------------------------------------------------------ */

/**
 * Minimum zoom levels at which various heavy layers should become
 * visible.  Below these thresholds the layer is hidden to avoid
 * rendering tens of thousands of features at once.
 */
export const ZOOM_THRESHOLDS = {
  /** Points of interest (markers / circles) */
  pois: 14,
  /** Building footprints (fill + outline) */
  buildings: 13,
  /** Parcel boundaries */
  parcels: 15,
  /** Per-building text labels */
  buildingLabels: 16,
  /** CTA station name labels */
  stationNames: 13,
} as const;

export type ZoomThresholdLayer = keyof typeof ZOOM_THRESHOLDS;

/* ------------------------------------------------------------------ */
/*  Feature-Count Estimation & Simplification Heuristic                */
/* ------------------------------------------------------------------ */

/**
 * Very rough estimate of the number of features that might be visible
 * in the given bounding box at the given zoom level.
 *
 * The model assumes an exponential increase in visible features as
 * zoom increases (each zoom level roughly doubles the area detail).
 * The constants are calibrated for a dense urban area like Chicago.
 *
 * @param bounds  [west, south, east, north]
 * @param zoom    Current map zoom level
 */
export function estimateFeatureCount(
  bounds: [number, number, number, number],
  zoom: number,
): number {
  const [west, south, east, north] = bounds;
  // Approximate area in square degrees
  const areaDeg2 = Math.abs((east - west) * (north - south));

  // Base density: ~500 features per square degree at zoom 10
  const baseDensity = 500;
  const zoomFactor = Math.pow(2, zoom - 10);

  return Math.round(areaDeg2 * baseDensity * zoomFactor);
}

/** Threshold above which simplification / clustering is recommended */
const SIMPLIFY_FEATURE_THRESHOLD = 50_000;

/**
 * Returns `true` when the combination of zoom level and estimated
 * feature count suggests the renderer would benefit from simplification
 * (e.g. clustering POIs, reducing building detail, hiding labels).
 */
export function shouldSimplifyLayer(
  zoom: number,
  featureCount: number,
): boolean {
  // At high zooms the viewport is small — even many features render fine
  if (zoom >= 16) return false;
  return featureCount > SIMPLIFY_FEATURE_THRESHOLD;
}
