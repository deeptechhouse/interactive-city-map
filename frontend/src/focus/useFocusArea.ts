/**
 * React state for the focus area: what's selected, the computed shape, and keeping the
 * map mask in sync. The panel (FocusAreaPanel) is pure UI on top of this hook.
 *
 * FLOW
 *   panel click → toggle()/setMode()/clear() → selection state (+ localStorage)
 *     → useMemo: buildFocusShape → buildMask       (focusGeometry.ts, pure)
 *     → useEffect: setFocusMask(map, mask, shape)  (FocusMaskLayer.ts)
 */
import { useCallback, useEffect, useMemo, useState } from 'react';
import type maplibregl from 'maplibre-gl';
import { bbox } from '@turf/turf';
import {
  EMPTY_SELECTION,
  buildFocusShape,
  buildMask,
  coerceMode,
  isEmptySelection,
  type AreaFeature,
  type FocusKind,
  type FocusMode,
  type FocusSelection,
} from './focusGeometry';
import type { AreaOption } from './focusAreas';
import type { BoundaryIndex } from './focusGeometry';
import type { FocusConfig } from '../cities/CityProfile';
import { setFocusMask } from './FocusMaskLayer';
import { loadJson, saveJson } from '../utils/safeStorage';

const STORAGE_KEY = 'citymap.focusSelection.v1';

/**
 * Saved selection per city. Chicago keeps the original key so selections saved before
 * multi-city still load; other cities get their own key (a Detroit precinct id must
 * never be applied to Chicago's districts).
 * O(1) time, O(1) space — n = 1 key.
 */
export function focusStorageKey(citySlug: string): string {
  return citySlug === 'chicago' ? STORAGE_KEY : `${STORAGE_KEY}.${citySlug}`;
}

const NO_OPTIONS: Record<FocusKind, readonly AreaOption[]> = { zip: [], police: [], ward: [] };
const DEFAULT_LABELS: Record<FocusKind, string> = { zip: 'Zip codes', police: 'Police', ward: 'Wards' };

/** Validate untrusted saved state; anything malformed becomes the empty selection. */
// O(n) time, O(n) space — n = saved ids across all kinds
export function parseSavedSelection(raw: unknown): FocusSelection {
  if (!raw || typeof raw !== 'object') return EMPTY_SELECTION;
  const obj = raw as Record<string, unknown>;
  // O(k) time, O(k) space — k = saved ids for one kind
  const ids = (v: unknown): string[] =>
    // O(k) time, O(k) space — k = saved ids for one kind
    Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : [];
  return { zip: ids(obj.zip), police: ids(obj.police), ward: ids(obj.ward), mode: coerceMode(obj.mode) };
}

export interface UseFocusAreaReturn {
  selection: FocusSelection;
  shape: AreaFeature | null;
  /** True when areas are selected but they don't overlap (intersection mode). */
  isEmptyResult: boolean;
  toggle: (kind: FocusKind, id: string) => void;
  setKindIds: (kind: FocusKind, ids: readonly string[]) => void;
  setMode: (mode: FocusMode) => void;
  /** Replace the whole selection (saved-search presets). Input is validated. */
  replace: (raw: unknown) => void;
  clear: () => void;
  zoomToFocus: () => void;
  /** Checklist options per kind for the current city (empty until boundaries load). */
  options: Record<FocusKind, readonly AreaOption[]>;
  /** What each kind is called in this city ("Council districts", "Police areas"…). */
  kindLabels: Readonly<Record<FocusKind, string>>;
}

/**
 * Focus-area state for the current city. `config` null = the city offers no focus areas
 * (the panel is hidden and the mask is cleared).
 * O(1) time, O(1) space — n = 1 render (geometry work is memoised on selection/boundary changes).
 */
export function useFocusArea(
  map: maplibregl.Map | null,
  config: FocusConfig | null,
  citySlug: string = 'chicago',
): UseFocusAreaReturn {
  const storageKey = focusStorageKey(citySlug);
  const [selection, setSelection] = useState<FocusSelection>(() =>
    parseSavedSelection(loadJson(storageKey)),
  );
  const [boundaries, setBoundaries] = useState<BoundaryIndex | null>(null);

  // City switch: load that city's saved selection and boundaries (lazy — another city's
  // polygons are only fetched when the user picks that city).
  useEffect(() => {
    setSelection(parseSavedSelection(loadJson(storageKey)));
    setBoundaries(null);
    if (!config) return;
    let cancelled = false;
    config
      .loadBoundaries()
      .then((index) => { if (!cancelled) setBoundaries(index); })
      .catch(() => { if (!cancelled) setBoundaries(null); });
    return () => { cancelled = true; };
  }, [config, storageKey]);

  useEffect(() => saveJson(storageKey, selection), [storageKey, selection]);

  // Geometry is the expensive part (polygon clipping) — only recompute on selection change.
  const shape = useMemo(
    () => (isEmptySelection(selection) || !boundaries ? null : buildFocusShape(selection, boundaries)),
    [selection, boundaries],
  );
  const options = useMemo(
    () => (config && boundaries ? config.optionsFor(boundaries) : NO_OPTIONS),
    [config, boundaries],
  );
  const active = config !== null && boundaries !== null && !isEmptySelection(selection);
  const mask = useMemo(() => (active ? buildMask(shape) : null), [active, shape]);

  useEffect(() => {
    if (!map) return;
    setFocusMask(map, mask, active ? shape : null);
  }, [map, mask, shape, active]);

  // O(s) time, O(s) space — s = ids selected for that kind
  const toggle = useCallback((kind: FocusKind, id: string) => {
    setSelection((prev) => {
      // O(s) time, O(s) space — s = ids selected for that kind (includes + filter/copy)
      const ids = prev[kind].includes(id) ? prev[kind].filter((x) => x !== id) : [...prev[kind], id];
      return { ...prev, [kind]: ids };
    });
  }, []);

  const setKindIds = useCallback((kind: FocusKind, ids: readonly string[]) => {
    setSelection((prev) => ({ ...prev, [kind]: [...ids] }));
  }, []);

  const setMode = useCallback((mode: FocusMode) => {
    setSelection((prev) => ({ ...prev, mode }));
  }, []);

  const replace = useCallback((raw: unknown) => setSelection(parseSavedSelection(raw)), []);

  const clear = useCallback(() => setSelection(EMPTY_SELECTION), []);

  const zoomToFocus = useCallback(() => {
    if (!map || !shape) return;
    const [minX, minY, maxX, maxY] = bbox(shape); // O(v)
    map.fitBounds([[minX, minY], [maxX, maxY]], { padding: 40, duration: 800 });
  }, [map, shape]);

  return {
    selection,
    shape,
    isEmptyResult: active && shape === null,
    toggle,
    setKindIds,
    setMode,
    replace,
    clear,
    zoomToFocus,
    options,
    kindLabels: config?.kindLabels ?? DEFAULT_LABELS,
  };
}

